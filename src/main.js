// AgentBoard — proceso principal (Electron)
// Maneja ventanas, PTYs reales, estado git y la config de esta máquina.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const pty = require('node-pty');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------- Config por máquina ----------
// Vive en la carpeta de datos de la app (NO en el repo), así cada
// computador tiene su propio tablero, proyectos y comandos.
//   Mac:     ~/Library/Application Support/AgentBoard/board.json
//   Windows: %APPDATA%\AgentBoard\board.json
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'board.json');

const DEFAULT_AGENTS = {
  claude: { label: 'Claude', command: 'claude', resumeArgs: '--continue', color: '#d97757' },
  codex:  { label: 'Codex',  command: 'codex',  resumeArgs: 'resume --last', color: '#10a37f' },
  gemini: { label: 'Gemini', command: 'gemini', resumeArgs: '', color: '#4f8df5' },
  shell:  { label: 'Terminal', command: '', resumeArgs: '', color: '#8a8f98' },
};

function defaultConfig() {
  return {
    version: 1,
    machineName: os.hostname().replace(/\.local$/, ''),
    shell: '',               // vacío = automático (zsh/bash en Mac, PowerShell en Windows)
    fontSize: 13,
    resumeOnOpen: true,      // al reabrir la app, relanzar agentes con sus args de "reanudar"
    agents: DEFAULT_AGENTS,
    projects: [],            // [{ path, name }]
    selectedProject: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    cards: [],
  };
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf8'));
    const base = defaultConfig();
    return { ...base, ...raw, agents: { ...base.agents, ...(raw.agents || {}) } };
  } catch {
    return defaultConfig();
  }
}

function saveConfig(cfg) {
  const file = CONFIG_PATH();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, file); // escritura atómica
}

// ---------- Shell ----------
function resolveShell(cfg) {
  if (cfg.shell && cfg.shell.trim()) {
    const [file, ...args] = cfg.shell.trim().split(/\s+/);
    return { file, args };
  }
  if (IS_WIN) return { file: 'powershell.exe', args: ['-NoLogo'] };
  // -l: login shell, para que el PATH incluya npm/brew aunque la app se abra desde el Finder
  return { file: process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

// ---------- PTYs ----------
const ptys = new Map(); // id -> IPty
let win = null;

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

ipcMain.handle('pty:create', (_e, { id, cwd, command, cols, rows }) => {
  const existing = ptys.get(id);
  if (existing) { try { existing.kill(); } catch {} ptys.delete(id); }

  const cfg = loadConfig();
  const { file, args } = resolveShell(cfg);
  const workDir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();

  let p;
  try {
    p = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: Math.max(cols || 80, 20),
      rows: Math.max(rows || 24, 5),
      cwd: workDir,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', AGENTBOARD: '1' },
    });
  } catch (err) {
    return { ok: false, error: `No pude abrir el shell "${file}": ${err.message}` };
  }

  ptys.set(id, p);
  p.onData((data) => send('pty:data', id, data));
  p.onExit(({ exitCode }) => {
    if (ptys.get(id) === p) ptys.delete(id);
    send('pty:exit', id, exitCode);
  });

  // Escribimos el comando dentro del shell: si el agente termina,
  // la tarjeta queda en un shell usable en vez de cerrarse.
  if (command && command.trim()) {
    setTimeout(() => { try { p.write(command.trim() + '\r'); } catch {} }, IS_WIN ? 400 : 150);
  }
  return { ok: true, pid: p.pid, cwd: workDir };
});

ipcMain.on('pty:write', (_e, id, data) => { const p = ptys.get(id); if (p) p.write(data); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  const p = ptys.get(id);
  if (p && cols > 0 && rows > 0) { try { p.resize(cols, rows); } catch {} }
});
ipcMain.on('pty:kill', (_e, id) => {
  const p = ptys.get(id);
  if (p) { try { p.kill(); } catch {} ptys.delete(id); }
});

function killAll() {
  for (const p of ptys.values()) { try { p.kill(); } catch {} }
  ptys.clear();
}

// ---------- Git ----------
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

ipcMain.handle('git:status', async (_e, cwd) => {
  if (!cwd || !fs.existsSync(cwd)) return null;
  const out = await git(cwd, ['status', '--porcelain=v2', '--branch']);
  if (out == null) return null; // no es repo, o git no está instalado
  const res = { branch: '', ahead: 0, behind: 0, changes: 0 };
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) res.branch = line.slice(14).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { res.ahead = +m[1]; res.behind = +m[2]; }
    } else if (line && !line.startsWith('#')) res.changes++;
  }
  return res;
});

ipcMain.handle('git:branches', async (_e, cwd) => {
  const out = await git(cwd, ['branch', '--format=%(refname:short)']);
  return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
});

ipcMain.handle('git:checkout', async (_e, cwd, branch, create) => {
  const out = await git(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch]);
  return out != null;
});

// ---------- Detectar agentes instalados ----------
function which(cmd, cfg) {
  return new Promise((resolve) => {
    if (!cmd) return resolve(true);
    const bin = cmd.trim().split(/\s+/)[0];
    if (IS_WIN) {
      execFile('where.exe', [bin], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
    } else {
      const { file } = resolveShell(cfg);
      execFile(file, ['-lc', `command -v ${bin}`], { timeout: 8000 }, (err) => resolve(!err));
    }
  });
}

ipcMain.handle('agents:check', async () => {
  const cfg = loadConfig();
  const result = {};
  await Promise.all(Object.entries(cfg.agents).map(async ([key, a]) => {
    result[key] = await which(a.command, cfg);
  }));
  return result;
});

// ---------- Config / diálogos ----------
ipcMain.handle('config:load', () => ({ config: loadConfig(), platform: process.platform, configPath: CONFIG_PATH() }));
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('config:reveal', () => shell.showItemInFolder(CONFIG_PATH()));

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));

// ---------- Ventana + menú ----------
function buildMenu() {
  const cmd = (action) => () => send('menu', action);
  const template = [
    ...(IS_MAC ? [{ role: 'appMenu' }] : []),
    {
      label: 'Tablero',
      submenu: [
        { label: 'Nuevo Claude', accelerator: 'CmdOrCtrl+Shift+1', click: cmd('new:claude') },
        { label: 'Nuevo Codex', accelerator: 'CmdOrCtrl+Shift+2', click: cmd('new:codex') },
        { label: 'Nuevo Gemini', accelerator: 'CmdOrCtrl+Shift+3', click: cmd('new:gemini') },
        { label: 'Nueva terminal', accelerator: 'CmdOrCtrl+Shift+4', click: cmd('new:shell') },
        { label: 'Nueva nota', accelerator: 'CmdOrCtrl+Shift+N', click: cmd('new:note') },
        { type: 'separator' },
        { label: 'Ordenar tarjetas', accelerator: 'CmdOrCtrl+Shift+O', click: cmd('arrange') },
        { label: 'Ver todo', accelerator: 'CmdOrCtrl+0', click: cmd('fit') },
        { label: 'Acercar', accelerator: 'CmdOrCtrl+=', click: cmd('zoom:in') },
        { label: 'Alejar', accelerator: 'CmdOrCtrl+-', click: cmd('zoom:out') },
        { type: 'separator' },
        { label: 'Ajustes…', accelerator: 'CmdOrCtrl+,', click: cmd('settings') },
        ...(IS_MAC ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Salir' }]),
      ],
    },
    // En Windows NO registramos el menú Editar: sus atajos Ctrl+C/Ctrl+V
    // le robarían el Ctrl+C (interrumpir) a las terminales. Ahí el
    // portapapeles lo maneja la UI.
    ...(IS_MAC ? [{ role: 'editMenu' }] : []),
    {
      label: 'Ver',
      // Recargar sin Ctrl+R en Windows (es la búsqueda del historial del shell)
      submenu: [
        IS_MAC ? { role: 'reload' } : { label: 'Recargar', click: () => win && win.reload() },
        { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f1115',
    title: 'AgentBoard',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // el preload usa el clipboard de Electron
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links (http/https) se abren en el navegador, nunca dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { killAll(); win = null; });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('before-quit', killAll);
app.on('window-all-closed', () => { killAll(); app.quit(); });
