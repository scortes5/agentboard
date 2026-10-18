// The cards' real terminals: one PTY per card running the user's shell, with the agent's
// command typed into it (when the agent exits, the card is left with a usable shell).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('node-pty');
const { IS_WIN } = require('./platform');
const { loadConfig } = require('./config');
const { resolveShell } = require('./shell-env');

// node-pty 1.1.0 ships spawn-helper without the execute bit ("posix_spawnp failed").
function ensureSpawnHelper() {
  if (IS_WIN) return;
  try {
    const base = path.dirname(require.resolve('node-pty/package.json')).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const f = path.join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(f) && !(fs.statSync(f).mode & 0o111)) fs.chmodSync(f, 0o755);
  } catch {}
}

// Extra variables per card (e.g. OLLAMA_API_BASE for Aider). Only valid names and string values.
function safeEnv(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) {
    if (/^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

// send: deliver an event to the window; getBridge: the agent bridge, which records each
// terminal's output so agents can read each other.
function createPtyHost({ send, getBridge }) {
  ensureSpawnHelper();
  const ptys = new Map(); // card id → IPty

  function create({ id, cwd, command, cols, rows, env }) {
    const existing = ptys.get(id);
    if (existing) { try { existing.kill(); } catch {} ptys.delete(id); }

    const { file, args } = resolveShell(loadConfig());
    const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
    let p;
    try {
      p = pty.spawn(file, args, {
        name: 'xterm-256color',
        cols: Math.max(cols || 80, 20),
        rows: Math.max(rows || 24, 5),
        cwd: workDir,
        env: { ...process.env, ...safeEnv(env), TERM: 'xterm-256color', COLORTERM: 'truecolor', AGENTBOARD: '1', AGENTBOARD_CARD: String(id) },
      });
    } catch (err) {
      return { ok: false, error: `Could not start the shell "${file}": ${err.message}` };
    }

    ptys.set(id, p);
    p.onData((data) => { send('pty:data', id, data); getBridge()?.record(id, data); });
    p.onExit(({ exitCode }) => {
      // if we killed it ourselves (close/restart) it is no longer in the map: stay quiet,
      // or the notice would cover the new session in the same card
      if (ptys.get(id) !== p) return;
      ptys.delete(id);
      send('pty:exit', id, exitCode);
    });
    if (command && command.trim()) {
      setTimeout(() => { try { p.write(command.trim() + '\r'); } catch {} }, IS_WIN ? 400 : 150);
    }
    return { ok: true, pid: p.pid, cwd: workDir };
  }

  function kill(id) {
    const p = ptys.get(id);
    if (p) { try { p.kill(); } catch {} ptys.delete(id); }
    getBridge()?.forget(id);
  }

  function killAll() {
    for (const p of ptys.values()) { try { p.kill(); } catch {} }
    ptys.clear();
  }

  function register(ipcMain) {
    ipcMain.handle('pty:create', (_e, opts) => create(opts));
    ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.write(data));
    ipcMain.on('pty:resize', (_e, id, cols, rows) => {
      const p = ptys.get(id);
      if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch {} }
    });
    ipcMain.on('pty:kill', (_e, id) => kill(id));
    // "Send to…": paste a block of text into another agent and submit it.
    ipcMain.handle('pty:paste', (_e, id, text) => getBridge()?.paste(id, text) ?? false);
  }

  return { ptys, killAll, register };
}

module.exports = { createPtyHost };
