// The cards' real terminals: one PTY per card running the user's shell, with the agent's
// command typed into it, so when the agent exits the card is left with a usable shell.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { IS_WIN } = require('../core/platform');

// Extra variables per card (e.g. OLLAMA_API_BASE for Aider): only valid names and string values.
function safeEnv(extra) {
  return Object.fromEntries(Object.entries(extra || {}).filter(([k, v]) => /^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === 'string'));
}

// node-pty 1.1.0 ships spawn-helper without the execute bit ("posix_spawnp failed").
function ensureSpawnHelper() {
  if (IS_WIN) return;
  try {
    const base = path.dirname(require.resolve('node-pty/package.json')).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const f = path.join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(f) && !(fs.statSync(f).mode & 0o111)) fs.chmodSync(f, 0o755);
  } catch {}
}

class PtyHost {
  // shellEnv: which shell to start; send: events to the window; getBridge: records each
  // terminal's output so agents can read each other.
  constructor({ shellEnv, send, getBridge }) {
    Object.assign(this, { shellEnv, send, getBridge });
    this.ptys = new Map(); // card id → IPty
    ensureSpawnHelper();
  }

  create({ id, cwd, command, cols, rows, env }) {
    this.kill(id, { quiet: true });
    const { file, args } = this.shellEnv.resolveShell();
    const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    let p;
    try {
      p = pty.spawn(file, args, {
        name: 'xterm-256color', cols: Math.max(cols || 80, 20), rows: Math.max(rows || 24, 5), cwd: workDir,
        env: { ...process.env, ...safeEnv(env), TERM: 'xterm-256color', COLORTERM: 'truecolor', AGENTBOARD: '1', AGENTBOARD_CARD: String(id) },
      });
    } catch (err) {
      return { ok: false, error: `Could not start the shell "${file}": ${err.message}` };
    }
    this.ptys.set(id, p);
    p.onData((data) => { this.send('pty:data', id, data); this.getBridge()?.record(id, data); });
    p.onExit(({ exitCode }) => {
      // killed by us (close/restart): stay quiet, or the notice would cover the new session
      if (this.ptys.get(id) !== p) return;
      this.ptys.delete(id);
      this.send('pty:exit', id, exitCode);
    });
    if (command && command.trim()) setTimeout(() => { try { p.write(command.trim() + '\r'); } catch {} }, IS_WIN ? 400 : 150);
    return { ok: true, pid: p.pid, cwd: workDir };
  }

  kill(id, { quiet = false } = {}) {
    const p = this.ptys.get(id);
    if (p) { this.ptys.delete(id); try { p.kill(); } catch {} }
    if (!quiet) this.getBridge()?.forget(id);
  }

  killAll() {
    for (const p of this.ptys.values()) { try { p.kill(); } catch {} }
    this.ptys.clear();
  }

  register(ipcMain) {
    ipcMain.handle('pty:create', (_e, opts) => this.create(opts));
    ipcMain.on('pty:write', (_e, id, data) => this.ptys.get(id)?.write(data));
    ipcMain.on('pty:resize', (_e, id, cols, rows) => {
      if (cols > 0 && rows > 0) { try { this.ptys.get(id)?.resize(cols, rows); } catch {} }
    });
    ipcMain.on('pty:kill', (_e, id) => this.kill(id));
    // "Send to…": paste a block of text into another agent and submit it.
    ipcMain.handle('pty:paste', (_e, id, text) => this.getBridge()?.paste(id, text) ?? false);
  }
}

module.exports = { PtyHost };
