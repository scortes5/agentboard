// The user's shell: which one to use, the PATH it sets up, and running commands in it
// the same way the cards do (so a CLI found in a card is found here too).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { IS_WIN, IS_MAC } = require('./platform');
const { loadConfig } = require('./config');

function resolveShell(cfg) {
  if (cfg.shell && cfg.shell.trim()) {
    const [file, ...args] = cfg.shell.trim().split(/\s+/);
    return { file, args };
  }
  if (IS_WIN) return { file: 'powershell.exe', args: ['-NoLogo'] };
  // -l: login shell, so PATH includes npm/brew even when the app is opened from Finder
  return { file: process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

// An app opened from Finder starts with a minimal PATH, and a non-interactive login shell
// (-lc) skips ~/.zshrc, where nvm, fnm or volta add the folder with npm's global CLIs
// (codex, gemini…). Ask an interactive login shell for its PATH once and add it to ours,
// so detection, headless runs and automation commands find the same CLIs as the cards.
let shellPathReady = null;
function loadShellPath() {
  if (IS_WIN) return Promise.resolve();
  if (!shellPathReady) shellPathReady = new Promise((resolve) => {
    const { file } = resolveShell(loadConfig());
    // markers skip whatever the shell's startup files print; "$PATH" is colon-joined in fish too
    const child = execFile(file, ['-ilc', 'printf "\\n__AB_PATH__%s__AB_PATH__\\n" "$PATH"'], { timeout: 10000 }, (_err, stdout) => {
      const fromShell = [...String(stdout || '').matchAll(/__AB_PATH__(.*?)__AB_PATH__/g)].flatMap((m) => m[1].split(':'));
      const common = [path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
      const dirs = [...(process.env.PATH || '').split(':'), ...fromShell, ...common].filter(Boolean);
      process.env.PATH = [...new Set(dirs)].join(':');
      resolve();
    });
    child.stdin?.end(); // a startup file that asks something gets EOF instead of waiting
  });
  return shellPathReady;
}

const isExecutable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };

async function which(cmd, cfg) {
  if (!cmd) return true;
  const bin = cmd.trim().split(/\s+/)[0];
  if (IS_WIN) {
    return new Promise((resolve) => execFile('where.exe', [bin], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err)));
  }
  await loadShellPath();
  if (bin.includes('/')) return isExecutable(bin.replace(/^~(?=\/)/, os.homedir()));
  if ((process.env.PATH || '').split(':').some((dir) => dir && isExecutable(path.join(dir, bin)))) return true;
  // last resort: whatever the login shell resolves (aliases and functions are not CLIs we can run)
  return new Promise((resolve) => {
    const { file } = resolveShell(cfg);
    execFile(file, ['-lc', 'command -v "$1"', 'sh', bin], { timeout: 8000 }, (err) => resolve(!err));
  });
}

// Run a CLI without a terminal (e.g. `claude -p`), passing the text on stdin.
function runHeadless(cmdline, input, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const cfg = loadConfig();
    const child = IS_WIN
      ? spawn(cmdline, { shell: true, windowsHide: true })
      : spawn(resolveShell(cfg).file, ['-lc', cmdline]);
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

// A command in the user's shell, inside a folder; resolves with its exit code and the end of its output.
function runInShell(cmd, cwd, timeoutMs = 10 * 60_000) {
  return new Promise((resolve) => {
    const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    const child = IS_WIN
      ? spawn(String(cmd), { shell: true, cwd: dir, windowsHide: true })
      : spawn(resolveShell(loadConfig()).file, ['-lc', String(cmd)], { cwd: dir });
    let out = '';
    const keep = (d) => { out = (out + d).slice(-8000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const timer = setTimeout(() => { child.kill(); keep(`\n[AgentBoard: stopped after ${Math.round(timeoutMs / 60000)} minutes]`); }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
  });
}

module.exports = { resolveShell, loadShellPath, which, runHeadless, runInShell };
