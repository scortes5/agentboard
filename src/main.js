// AgentBoard — proceso principal (Electron)
// Maneja ventanas, PTYs reales, estado git y la config de esta máquina.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const http = require('http');
const pty = require('node-pty');
const skills = require('./skills');
const { createBridge } = require('./bridge');

const IS_WIN = process.platform === 'win32';
// Si AgentBoard se abrió desde una sesión de Claude Code (ej. `npm start` en su terminal),
// estas variables harían que los Claude de las tarjetas se nieguen a arrancar.
// Los shells de las tarjetas son de login: vuelven a cargar lo que tengas en tu perfil.
for (const k of Object.keys(process.env)) {
  if (/^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.+|ANTHROPIC_BASE_URL)$/.test(k)) delete process.env[k];
}
const IS_MAC = process.platform === 'darwin';

// ---------- Config por máquina ----------
// Vive en la carpeta de datos de la app (NO en el repo), así cada
// computador tiene su propio tablero, proyectos y comandos.
//   Mac:     ~/Library/Application Support/AgentBoard/board.json
//   Windows: %APPDATA%\AgentBoard\board.json
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'board.json');

// lightArgs: argumentos del "modo ahorro" (modelo más barato / menos razonamiento) para tareas simples.
const DEFAULT_AGENTS = {
  claude: { label: 'Claude', command: 'claude', resumeArgs: '--continue', lightArgs: '--model haiku', color: '#e8875f' },
  codex:  { label: 'Codex',  command: 'codex',  resumeArgs: 'resume --last', lightArgs: '-c model_reasoning_effort=low', color: '#3fbf8f' },
  gemini: { label: 'Gemini', command: 'gemini', resumeArgs: '', lightArgs: '-m gemini-2.5-flash', color: '#6c9cf5' },
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
    keepRunning: true,       // cerrar la ventana la oculta: los agentes siguen trabajando (salir con ⌘Q / bandeja)
    maxParallel: 3,          // tareas corriendo a la vez (todas las suscripciones)
    perAgentParallel: 2,     // tareas a la vez por suscripción
    taskWorktrees: false,    // cada tarea en su propio git worktree (no se pisan entre agentes)
    tasks: [],               // lista de ToDos: [{ id, text, status, agent, cwd, group, light, cardId, ... }]
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
    const agents = { ...base.agents, ...(raw.agents || {}) };
    for (const [k, a] of Object.entries(base.agents)) if (agents[k].lightArgs == null && a.lightArgs) agents[k] = { ...agents[k], lightArgs: a.lightArgs };
    return { ...base, ...raw, agents };
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
// node-pty 1.1.0 trae spawn-helper sin permiso de ejecución ("posix_spawnp failed").
function ensureSpawnHelper() {
  if (IS_WIN) return;
  try {
    const base = path.dirname(require.resolve('node-pty/package.json')).replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const f = path.join(base, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
    if (fs.existsSync(f) && !(fs.statSync(f).mode & 0o111)) fs.chmodSync(f, 0o755);
  } catch {}
}
ensureSpawnHelper();

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
    // si lo matamos nosotros (cerrar/reiniciar) ya no está en el mapa: no avisar,
    // o el aviso taparía a la sesión nueva de la misma tarjeta
    if (ptys.get(id) !== p) return;
    ptys.delete(id);
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

// ---------- Skills de ahorro (incluidas con AgentBoard) ----------
// Carpeta skills-pack/<nombre>/SKILL.md. Se copian a la carpeta de skills de
// cada CLI; el formato SKILL.md es el mismo en Claude Code, Codex y Gemini.
const PACK_DIR = path.join(__dirname, '..', 'skills-pack');
const PACK_ROOTS = { claude: () => path.join(skills.claudeDir(), 'skills'), codex: () => path.join(skills.codexDir(), 'skills'), gemini: () => path.join(skills.geminiDir(), 'skills') };

function packSkills() {
  let names = [];
  try { names = fs.readdirSync(PACK_DIR).filter((n) => fs.existsSync(path.join(PACK_DIR, n, 'SKILL.md'))); } catch {}
  return names.map((name) => {
    const text = fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md'), 'utf8');
    const { meta } = skills.frontmatter(text);
    const installed = {};
    for (const [k, root] of Object.entries(PACK_ROOTS)) {
      try { installed[k] = fs.readFileSync(path.join(root(), name, 'SKILL.md'), 'utf8') === text ? 'ok' : 'old'; } catch { installed[k] = null; }
    }
    return { name, description: meta.description || '', installed };
  });
}

ipcMain.handle('pack:status', () => packSkills());
// Instala (o actualiza) las skills de ahorro en las suscripciones indicadas.
ipcMain.handle('pack:install', wrap((_e, providers) => {
  const done = [];
  for (const k of providers || []) {
    if (!PACK_ROOTS[k]) continue;
    for (const { name } of packSkills()) {
      const dest = path.join(PACK_ROOTS[k](), name);
      fs.mkdirSync(dest, { recursive: true });
      // readFileSync funciona dentro de app.asar (cpSync no)
      fs.writeFileSync(path.join(dest, 'SKILL.md'), fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md')));
      done.push(`${k}/${name}`);
    }
  }
  return done;
}));

// ---------- Tareas (ToDo) ----------
// Corre un CLI sin terminal (ej. `claude -p`) con el texto por stdin.
function runHeadless(cmdline, input, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const cfg = loadConfig();
    const child = IS_WIN
      ? spawn(cmdline, { shell: true, windowsHide: true })
      : spawn(resolveShell(cfg).file, ['-lc', cmdline]);
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Tardó demasiado.')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out); else reject(new Error((err || out).trim().split('\n').slice(-3).join(' ') || `código ${code}`));
    });
    child.stdin.end(input);
  });
}

// Divide un texto libre en tareas con Claude en modo no interactivo y el modelo
// más barato (haiku): una sola llamada corta, sin abrir terminal ni leer el repo.
ipcMain.handle('tasks:plan', wrap(async (_e, text, opts = {}) => {
  const agents = (opts.agents || []).join(', ') || 'claude, codex, gemini';
  const projects = (opts.projects || []).join(', ') || '(ninguno)';
  const prompt = [
    'Convierte esta lista de pendientes en tareas concretas e independientes para agentes de código.',
    'Responde SOLO con un arreglo JSON, sin texto extra:',
    '[{"text":"instrucción clara y autocontenida","agent":"auto|' + agents.replace(/, /g, '|') + '","light":true|false,"project":"nombre o vacío","group":"etiqueta corta o vacío"}]',
    'light=true si es simple (docs, renombrar, test chico, pregunta). Usa "auto" salvo que el texto pida un agente.',
    'Proyectos disponibles: ' + projects + '. No inventes proyectos.',
    'Pendientes:',
    String(text).slice(0, 8000),
  ].join('\n');
  const out = await runHeadless('claude -p --model haiku --tools "" --no-session-persistence', prompt);
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Claude no devolvió una lista.');
  const list = JSON.parse(m[0]);
  if (!Array.isArray(list)) throw new Error('Respuesta inválida.');
  return list.filter((t) => t && typeof t.text === 'string' && t.text.trim()).slice(0, 40);
}));

// Worktree aislado para una tarea: <repo>/.agentboard/worktrees/<slug> en la rama agentboard/<slug>.
function gitLong(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '') }));
  });
}
ipcMain.handle('git:worktree', wrap(async (_e, cwd, slug) => {
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Proyecto inválido.');
  const top = (await gitLong(cwd, ['rev-parse', '--show-toplevel'])).out.trim();
  if (!top) throw new Error('El proyecto no es un repositorio git.');
  const safe = String(slug || 'tarea').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tarea';
  let name = safe;
  for (let i = 2; fs.existsSync(path.join(top, '.agentboard', 'worktrees', name)); i++) name = `${safe}-${i}`;
  const dir = path.join(top, '.agentboard', 'worktrees', name);
  const branch = `agentboard/${name}`;
  const r = await gitLong(top, ['worktree', 'add', '-b', branch, dir]);
  if (!r.ok) throw new Error(r.err.trim() || 'git worktree falló.');
  // que los worktrees no aparezcan como cambios del repo principal
  try {
    const gitDir = (await gitLong(top, ['rev-parse', '--git-common-dir'])).out.trim();
    const exclude = path.resolve(top, gitDir, 'info', 'exclude');
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!/^\/?\.agentboard\/?$/m.test(cur)) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}.agentboard/\n`); }
  } catch {}
  return { dir, branch };
}));

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

// Preguntas del puente que solo la UI puede responder (ej. agregar una tarea a la lista).
const pendingAsks = new Map();
function askRenderer(kind, payload, ms = 5000) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const reqId = Math.random().toString(36).slice(2);
    pendingAsks.set(reqId, resolve);
    send('bridge:ask', { reqId, kind, payload });
    setTimeout(() => { if (pendingAsks.delete(reqId)) resolve(null); }, ms);
  });
}
ipcMain.on('bridge:answer', (_e, reqId, value) => { pendingAsks.get(reqId)?.(value); pendingAsks.delete(reqId); });

function startBridge() {
  bridge = createBridge({
    dataDir: app.getPath('userData'),
    ptys,
    loadConfig,
    notify: (ev) => send('bridge:event', ev),
    askRenderer,
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
        { label: 'Nuevo grupo', accelerator: 'CmdOrCtrl+Shift+G', click: cmd('new:group') },
        { type: 'separator' },
        { label: 'Tareas', accelerator: 'CmdOrCtrl+Shift+T', click: cmd('tasks') },
        { label: 'Diagrama', accelerator: 'CmdOrCtrl+Shift+D', click: cmd('diagram') },
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
    // ⌘W cierra la ventana (los agentes siguen en segundo plano), ⌘M minimiza
    ...(IS_MAC ? [{ role: 'windowMenu' }] : []),
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

// ---------- Ícono, bandeja y segundo plano ----------
// Cerrar la ventana solo la oculta (si hay agentes corriendo): siguen trabajando
// y las tareas en cola se siguen despachando. Para salir de verdad: ⌘Q o la bandeja.
let tray = null;
let quitting = false;
let trayHintShown = false;
const ICON = path.join(__dirname, 'renderer', 'icon.png');

function showWindow() {
  if (!win) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function busyCount() { return bridge ? bridge.busyIds().length : 0; }

function refreshTray() {
  if (!tray) return;
  const n = ptys.size, busy = busyCount();
  tray.setToolTip(`AgentBoard — ${n} agente${n === 1 ? '' : 's'} abierto${n === 1 ? '' : 's'}, ${busy} trabajando`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar AgentBoard', click: showWindow },
    { label: `${n} abiertos · ${busy} trabajando`, enabled: false },
    { type: 'separator' },
    { label: 'Salir (detiene los agentes)', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.on('click', showWindow);
  refreshTray();
  setInterval(refreshTray, 5000);
}

function confirmQuit() {
  if (!ptys.size) return true;
  const busy = busyCount();
  const r = dialog.showMessageBoxSync(win && win.isVisible() ? win : null, {
    type: 'question',
    buttons: ['Salir', 'Seguir en segundo plano', 'Cancelar'],
    defaultId: busy ? 1 : 0, cancelId: 2,
    message: `Hay ${ptys.size} agente${ptys.size === 1 ? '' : 's'} abierto${ptys.size === 1 ? '' : 's'}${busy ? ` (${busy} trabajando)` : ''}.`,
    detail: 'Si sales se detienen; al volver a abrir AgentBoard se reanudan sus sesiones. Tus suscripciones siguen con la sesión iniciada en cualquier caso.',
  });
  if (r === 1 && win) win.hide();
  return r === 0;
}

function createWindow() {
  win = new BrowserWindow({
    icon: ICON,
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
      backgroundThrottling: false, // con la ventana oculta, los estados y la cola de tareas siguen al día
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links (http/https) se abren en el navegador, nunca dentro de la app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (quitting) return;
    if (loadConfig().keepRunning && ptys.size) {
      e.preventDefault();
      win.hide();
      if (!IS_MAC && tray && !trayHintShown) {
        trayHintShown = true;
        tray.displayBalloon?.({ title: 'AgentBoard sigue corriendo', content: 'Tus agentes siguen trabajando. Ábrelo o sal desde este ícono.' });
      }
    } else if (!confirmQuit()) e.preventDefault();
    else quitting = true;
  });
  win.on('closed', () => { killAll(); win = null; });
}

// Una sola instancia: abrir el ícono de nuevo muestra la ventana existente.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    if (IS_MAC && !app.isPackaged) app.dock?.setIcon(ICON);
    buildMenu();
    startBridge();
    createWindow();
    createTray();
    app.on('activate', showWindow);
  });
}

app.on('before-quit', (e) => {
  if (!quitting && !confirmQuit()) { e.preventDefault(); return; }
  quitting = true;
  killAll(); bridge?.stop();
});
app.on('window-all-closed', () => { killAll(); bridge?.stop(); app.quit(); });
