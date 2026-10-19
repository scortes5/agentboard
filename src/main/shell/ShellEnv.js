// The user's shell: which one to use, the PATH it sets up, and running commands in it the
// same way the cards do, so a CLI that works in a card is also found here.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { IS_WIN, IS_MAC } = require('../core/platform');

const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };

class ShellEnv {
  // config: a ConfigStore (the shell can be set in Settings → General).
  constructor(config) {
    this.config = config;
    this.pathReady = null;
  }

  resolveShell(cfg = this.config.load()) {
    if (cfg.shell && cfg.shell.trim()) {
      const [file, ...args] = cfg.shell.trim().split(/\s+/);
      return { file, args };
    }
    if (IS_WIN) return { file: 'powershell.exe', args: ['-NoLogo'] };
    // -l: login shell, so PATH includes npm/brew even when the app is opened from Finder
    return { file: process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
  }

  // An app opened from Finder starts with a minimal PATH, and a non-interactive login shell
  // skips ~/.zshrc, where nvm, fnm or volta add npm's global CLIs. Ask an interactive login
  // shell for its PATH once and add it to ours.
  loadPath() {
    if (IS_WIN) return Promise.resolve();
    if (!this.pathReady) this.pathReady = new Promise((resolve) => {
      const { file } = this.resolveShell();
      // markers skip whatever the startup files print; "$PATH" is colon-joined in fish too
      const child = execFile(file, ['-ilc', 'printf "\\n__AB_PATH__%s__AB_PATH__\\n" "$PATH"'], { timeout: 10000 }, (_err, stdout) => {
        const fromShell = [...String(stdout || '').matchAll(/__AB_PATH__(.*?)__AB_PATH__/g)].flatMap((m) => m[1].split(':'));
        const common = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
        process.env.PATH = [...new Set([...(process.env.PATH || '').split(':'), ...fromShell, ...common].filter(Boolean))].join(':');
        resolve();
      });
      child.stdin?.end(); // a startup file that asks something gets EOF instead of waiting
    });
    return this.pathReady;
  }

  // Whether a command (its first word) can be run.
  async which(cmd) {
    if (!cmd) return true;
    const bin = cmd.trim().split(/\s+/)[0];
    if (IS_WIN) return new Promise((resolve) => execFile('where.exe', [bin], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err)));
    await this.loadPath();
    if (bin.includes('/')) return isExecutable(bin.replace(/^~(?=\/)/, os.homedir()));
    if ((process.env.PATH || '').split(':').some((dir) => dir && isExecutable(path.join(dir, bin)))) return true;
    // last resort: whatever the login shell resolves
    return new Promise((resolve) => execFile(this.resolveShell().file, ['-lc', 'command -v "$1"', 'sh', bin], { timeout: 8000 }, (err) => resolve(!err)));
  }

  spawnInShell(cmd, opts = {}) {
    return IS_WIN
      ? spawn(String(cmd), { shell: true, windowsHide: true, ...opts })
      : spawn(this.resolveShell().file, ['-lc', String(cmd)], opts);
  }

  // A CLI without a terminal (e.g. `claude -p`), with the text on stdin; resolves with its output.
  runHeadless(cmdline, input, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
      const child = this.spawnInShell(cmdline);
      let out = '', err = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('Timed out.')); }, timeoutMs);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out); else reject(new Error((err || out).trim().split('\n').slice(-3).join(' ') || `exit code ${code}`));
      });
      child.stdin.end(input);
    });
  }

  // A command inside a folder; resolves with its exit code and the end of its output.
  // env: extra variables for this command only (e.g. secrets).
  runInShell(cmd, cwd, { timeoutMs = 10 * 60_000, env = {} } = {}) {
    return new Promise((resolve) => {
      const child = this.spawnInShell(cmd, { cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env: { ...process.env, ...env } });
      let out = '';
      const keep = (d) => { out = (out + d).slice(-8000); };
      child.stdout.on('data', keep); child.stderr.on('data', keep);
      const timer = setTimeout(() => { child.kill(); keep(`\n[AgentBoard: stopped after ${Math.round(timeoutMs / 60000)} minutes]`); }, timeoutMs);
      child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
    });
  }
}

module.exports = { ShellEnv };
