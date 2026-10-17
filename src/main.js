// AgentBoard — proceso principal (Electron)
// Maneja ventanas, PTYs reales, estado git y la config de esta máquina.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const http = require('http');
const pty = require('node-pty');
const skills = require('./skills');
const { createBridge } = require('./bridge');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ---------- Config por máquina ----------
// Vive en la carpeta de datos de la app (NO en el repo), así cada
// computador tiene su propio tablero, proyectos y comandos.
//   Mac:     ~/Library/Application Support/AgentBoard/board.json
//   Windows: %APPDATA%\AgentBoard\board.json
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'board.json');

const DEFAULT_AGENTS = {
  claude: { label: 'Claude', command: 'claude', resumeArgs: '--continue', color: '#e8875f' },
  codex:  { label: 'Codex',  command: 'codex',  resumeArgs: 'resume --last', color: '#3fbf8f' },
  gemini: { label: 'Gemini', command: 'gemini', resumeArgs: '', color: '#6c9cf5' },
  shell:  { label: 'Terminal', command: '', resumeArgs: '', color: '#a89d8f' },
};

// Catálogo de CLIs de agentes. Cada uno inicia sesión con su propia cuenta
// (suscripción, cuenta gratis o API key) la primera vez que lo abres.
// Si un comando cambia, se edita en Ajustes → Agentes.
const CATALOG = [
  { key: 'claude',   label: 'Claude Code',  command: 'claude',       resumeArgs: '--continue',    color: '#e8875f', plan: 'Claude Pro / Max',          install: 'npm i -g @anthropic-ai/claude-code' },
  { key: 'codex',    label: 'Codex',        command: 'codex',        resumeArgs: 'resume --last', color: '#3fbf8f', plan: 'ChatGPT Plus / Pro',         install: 'npm i -g @openai/codex' },
  { key: 'gemini',   label: 'Gemini CLI',   command: 'gemini',       resumeArgs: '',              color: '#6c9cf5', plan: 'Cuenta Google (gratis)',     install: 'npm i -g @google/gemini-cli' },
  { key: 'copilot',  label: 'Copilot CLI',  command: 'copilot',      resumeArgs: '',              color: '#b08cf0', plan: 'GitHub Copilot',             install: 'npm i -g @github/copilot' },
  { key: 'cursor',   label: 'Cursor CLI',   command: 'cursor-agent', resumeArgs: '',              color: '#d8d0c4', plan: 'Cursor Pro',                 install: 'curl https://cursor.com/install -fsS | bash' },
  { key: 'qwen',     label: 'Qwen Code',    command: 'qwen',         resumeArgs: '',              color: '#8f7cf7', plan: 'Cuenta Qwen (gratis)',       install: 'npm i -g @qwen-code/qwen-code' },
  { key: 'opencode', label: 'OpenCode',     command: 'opencode',     resumeArgs: '',              color: '#f0b45a', plan: 'Cualquier proveedor o local', install: 'npm i -g opencode-ai' },
  { key: 'aider',    label: 'Aider',        command: 'aider',        resumeArgs: '',              color: '#5fd0c8', plan: 'API key o modelo local',     install: 'python -m pip install aider-install && aider-install' },
  { key: 'amp',      label: 'Amp',          command: 'amp',          resumeArgs: '',              color: '#f06a8a', plan: 'Cuenta Amp',                 install: 'npm i -g @sourcegraph/amp' },
  { key: 'ollama',   label: 'Ollama',       command: 'ollama',       resumeArgs: '',              color: '#f1e9dd', plan: 'Modelos locales, sin cuenta', install: 'https://ollama.com/download' },
];

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
    sidebarOpen: true,
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

// Solo tu usuario puede leer el tablero (rutas de proyectos, notas).
function saveConfig(cfg) {
  const file = CONFIG_PATH();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!IS_WIN) { try { fs.chmodSync(dir, 0o700); } catch {} }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
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

// Variables extra por tarjeta (ej. OLLAMA_API_BASE para Aider). Solo nombres válidos y valores de texto.
function safeEnv(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) {
    if (/^[A-Z_][A-Z0-9_]*$/.test(k) && typeof v === 'string') out[k] = v;
  }
  return out;
}

ipcMain.handle('pty:create', (_e, { id, cwd, command, cols, rows, env }) => {
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
      env: { ...process.env, ...safeEnv(env), TERM: 'xterm-256color', COLORTERM: 'truecolor', AGENTBOARD: '1', AGENTBOARD_CARD: String(id) },
    });
  } catch (err) {
    return { ok: false, error: `No pude abrir el shell "${file}": ${err.message}` };
  }

  ptys.set(id, p);
  p.onData((data) => { send('pty:data', id, data); bridge?.record(id, data); });
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
  bridge?.forget(id);
});
// "Pasar a…": pega un bloque de texto en otro agente y lo envía.
ipcMain.handle('pty:paste', (_e, id, text) => bridge?.paste(id, text) ?? false);

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

// ---------- Cuentas ----------
// Cada CLI guarda su propia sesión en este computador. AgentBoard solo
// comprueba que exista; nunca lee, copia ni envía los tokens.
const exists = (...p) => { try { return fs.existsSync(path.join(...p)); } catch { return false; } };

function macKeychainHas(service) {
  return new Promise((resolve) => {
    if (!IS_MAC) return resolve(false);
    // Sin -w/-g: no devuelve el secreto, solo si la entrada existe.
    execFile('security', ['find-generic-password', '-s', service], { timeout: 4000 }, (err) => resolve(!err));
  });
}

const PROVIDERS = {
  claude: {
    login: 'claude',
    where: IS_MAC ? 'Llavero de macOS' : '~/.claude',
    async detect() {
      if (await macKeychainHas('Claude Code-credentials')) return true;
      return exists(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
    },
  },
  codex: {
    login: 'codex login',
    where: '~/.codex',
    async detect() { return exists(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'); },
  },
  gemini: {
    login: 'gemini',
    where: '~/.gemini',
    async detect() { return exists(os.homedir(), '.gemini', 'oauth_creds.json'); },
  },
};

// Catálogo + si cada CLI está instalado y, para los que sabemos revisar, si hay sesión.
ipcMain.handle('catalog:status', async () => {
  const cfg = loadConfig();
  return Promise.all(CATALOG.map(async (item) => {
    const p = PROVIDERS[item.key];
    const [installed, loggedIn] = await Promise.all([which(item.command, cfg), p ? p.detect() : null]);
    return { ...item, installed, loggedIn, login: p?.login || item.command, where: p?.where || null };
  }));
});

// ---------- Modelos locales ----------
// Solo consulta servidores en esta máquina (127.0.0.1); nada sale a internet.
function localJson(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

ipcMain.handle('local:models', async () => {
  const cfg = loadConfig();
  const [tags, lms, ollamaInstalled] = await Promise.all([
    localJson(11434, '/api/tags'),
    localJson(1234, '/v1/models'),
    which('ollama', cfg),
  ]);
  return {
    ollama: { installed: ollamaInstalled, running: !!tags, models: (tags?.models || []).map((m) => m.name).filter(Boolean) },
    lmstudio: { running: !!lms, models: (lms?.data || []).map((m) => m.id).filter(Boolean) },
  };
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

// ---------- Skills y agentes ----------
const projectsOf = () => loadConfig().projects || [];
const wrap = (fn) => async (...args) => { try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; } };

ipcMain.handle('skills:scan', () => skills.scanSkills(projectsOf()));
ipcMain.handle('skills:copy', wrap((_e, src, target) => skills.copySkill(src, target, projectsOf())));
ipcMain.handle('agents:list', () => skills.listAgents(projectsOf()));
ipcMain.handle('agents:save', wrap(async (_e, a) => {
  const r = skills.saveAgent(a, projectsOf());
  if (r.replaced) await shell.trashItem(r.replaced);
  return r.file;
}));
ipcMain.handle('agents:delete', wrap(async (_e, file) => {
  if (!skills.isAgentFile(file, projectsOf())) throw new Error('Archivo de agente inválido.');
  await shell.trashItem(file); // a la papelera: se puede recuperar
  return true;
}));
ipcMain.handle('skills:reveal', (_e, p) => {
  const known = skills.scanSkills(projectsOf()).some((x) => path.resolve(x.path) === path.resolve(p))
    || skills.listAgents(projectsOf()).some((x) => path.resolve(x.file) === path.resolve(p));
  if (known) shell.showItemInFolder(p);
});

// ---------- Puente entre agentes (MCP) ----------
let bridge = null;
const pendingCards = new Map();
const MCP_SCRIPT = path.join(__dirname, '..', 'scripts', 'agentboard-mcp.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function mcpCommands() {
  const script = JSON.stringify(MCP_SCRIPT);
  return {
    claude: { add: `claude mcp add --scope user agentboard -- node ${script}`, remove: 'claude mcp remove --scope user agentboard' },
    codex: { add: `codex mcp add agentboard -- node ${script}`, remove: 'codex mcp remove agentboard' },
    gemini: { add: `gemini mcp add --scope user agentboard node ${script}`, remove: 'gemini mcp remove --scope user agentboard' },
  };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// Solo revisa si existe la entrada "agentboard"; no lee nada más de esos archivos.
function mcpConnected() {
  const toml = (() => { try { return fs.readFileSync(path.join(skills.codexDir(), 'config.toml'), 'utf8'); } catch { return ''; } })();
  return {
    claude: !!readJson(path.join(os.homedir(), '.claude.json'))?.mcpServers?.agentboard,
    codex: /^\[mcp_servers\.("?)agentboard\1\]/m.test(toml),
    gemini: !!readJson(path.join(skills.geminiDir(), 'settings.json'))?.mcpServers?.agentboard,
  };
}

ipcMain.handle('bridge:status', () => ({ connected: mcpConnected(), commands: mcpCommands(), script: MCP_SCRIPT }));
ipcMain.on('bridge:card-created', (_e, reqId, id) => { pendingCards.get(reqId)?.(id); pendingCards.delete(reqId); });

function startBridge() {
  bridge = createBridge({
    dataDir: app.getPath('userData'),
    ptys,
    loadConfig,
    notify: (ev) => send('bridge:event', ev),
    requestNewCard: ({ agent, cwd, title }) => new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      pendingCards.set(reqId, resolve);
      send('bridge:new-card', { reqId, agent, cwd, title });
      setTimeout(() => { if (pendingCards.delete(reqId)) resolve(null); }, 5000);
    }),
  });
  bridge.start();
}

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
        { label: 'Panel de agentes', accelerator: 'CmdOrCtrl+Shift+A', click: cmd('sidebar') },
        { label: 'Skills y agentes…', click: cmd('skills') },
        { label: 'Suscripciones y modelos…', click: cmd('accounts') },
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
  startBridge();
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('before-quit', () => { killAll(); bridge?.stop(); });
app.on('window-all-closed', () => { killAll(); bridge?.stop(); app.quit(); });
