// AgentBoard — main process (Electron)
// Owns the window, real PTYs, git status and this machine's config.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const http = require('http');
const pty = require('node-pty');
const skills = require('./skills');
const usage = require('./usage');
const { createBridge } = require('./bridge');
const { createUpdater } = require('./updates');

const IS_WIN = process.platform === 'win32';
// If AgentBoard was launched from inside a Claude Code session (e.g. `npm start` in its
// terminal), these variables would make the Claude instances in cards refuse to start.
// Card shells are login shells, so anything set in the user's profile is loaded again.
for (const k of Object.keys(process.env)) {
  if (/^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.+|ANTHROPIC_BASE_URL)$/.test(k)) delete process.env[k];
}
const IS_MAC = process.platform === 'darwin';

// ---------- Per-machine config ----------
// Lives in the app's data folder (NOT in the repo), so each computer
// keeps its own board, projects and commands.
//   Mac:     ~/Library/Application Support/AgentBoard/board.json
//   Windows: %APPDATA%\AgentBoard\board.json
const CONFIG_PATH = () => path.join(app.getPath('userData'), 'board.json');

// lightArgs / heavyArgs: arguments for light tasks (cheaper model, less reasoning) and heavy ones.
const DEFAULT_AGENTS = {
  claude: { label: 'Claude', command: 'claude', resumeArgs: '--continue', lightArgs: '--model haiku', heavyArgs: '--model opus', color: '#e8875f' },
  codex:  { label: 'Codex',  command: 'codex',  resumeArgs: 'resume --last', lightArgs: '-c model_reasoning_effort=low', heavyArgs: '-c model_reasoning_effort=high', color: '#3fbf8f' },
  gemini: { label: 'Gemini', command: 'gemini', resumeArgs: '', lightArgs: '-m gemini-2.5-flash', heavyArgs: '-m gemini-2.5-pro', color: '#6c9cf5' },
  shell:  { label: 'Terminal', command: '', resumeArgs: '', color: '#a89d8f' },
};

// Catalog of agent CLIs. Each one signs in with its own account
// (subscription, free account or API key) the first time it runs.
// If a command changes, edit it in Settings → Agents.
const CATALOG = [
  { key: 'claude',   label: 'Claude Code',  command: 'claude',       resumeArgs: '--continue',    color: '#e8875f', plan: 'Claude Pro / Max',          install: 'npm i -g @anthropic-ai/claude-code' },
  { key: 'codex',    label: 'Codex',        command: 'codex',        resumeArgs: 'resume --last', color: '#3fbf8f', plan: 'ChatGPT Plus / Pro',         install: 'npm i -g @openai/codex' },
  { key: 'gemini',   label: 'Gemini CLI',   command: 'gemini',       resumeArgs: '',              color: '#6c9cf5', plan: 'Google account (free)',      install: 'npm i -g @google/gemini-cli' },
  { key: 'copilot',  label: 'Copilot CLI',  command: 'copilot',      resumeArgs: '',              color: '#b08cf0', plan: 'GitHub Copilot',             install: 'npm i -g @github/copilot' },
  { key: 'cursor',   label: 'Cursor CLI',   command: 'cursor-agent', resumeArgs: '',              color: '#d8d0c4', plan: 'Cursor Pro',                 install: 'curl https://cursor.com/install -fsS | bash' },
  { key: 'qwen',     label: 'Qwen Code',    command: 'qwen',         resumeArgs: '',              color: '#8f7cf7', plan: 'Qwen account (free)',        install: 'npm i -g @qwen-code/qwen-code' },
  { key: 'opencode', label: 'OpenCode',     command: 'opencode',     resumeArgs: '',              color: '#f0b45a', plan: 'Any provider or local',       install: 'npm i -g opencode-ai' },
  { key: 'aider',    label: 'Aider',        command: 'aider',        resumeArgs: '',              color: '#5fd0c8', plan: 'API key or local model',     install: 'python -m pip install aider-install && aider-install' },
  { key: 'amp',      label: 'Amp',          command: 'amp',          resumeArgs: '',              color: '#f06a8a', plan: 'Amp account',                install: 'npm i -g @sourcegraph/amp' },
  { key: 'ollama',   label: 'Ollama',       command: 'ollama',       resumeArgs: '',              color: '#f1e9dd', plan: 'Local models, no account',    install: 'https://ollama.com/download' },
];

function defaultConfig() {
  return {
    version: 1,
    machineName: os.hostname().replace(/\.local$/, ''),
    shell: '',               // empty = automatic (zsh/bash on Mac, PowerShell on Windows)
    fontSize: 13,
    resumeOnOpen: true,      // when the app reopens, relaunch agents with their "resume" args
    keepRunning: true,       // closing the window hides it; agents keep working (quit with ⌘Q / tray)
    maxParallel: 3,          // tasks running at once, across all subscriptions
    perAgentParallel: 2,     // tasks running at once per subscription
    taskWorktrees: false,    // each task in its own git worktree, so agents don't step on each other
    quickKey: 'Control+Alt+Space', // global shortcut: add a task from any app
    checkUpdates: true,      // look for a new release on start and every few hours
    tasks: [],               // to-do list: [{ id, text, status, agent, cwd, group, light, cardId, ... }]
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
    for (const [k, a] of Object.entries(base.agents)) {
      for (const f of ['lightArgs', 'heavyArgs']) if (agents[k][f] == null && a[f]) agents[k] = { ...agents[k], [f]: a[f] };
    }
    return { ...base, ...raw, agents };
  } catch {
    return defaultConfig();
  }
}

// Only the current user can read the board (project paths, notes).
function saveConfig(cfg) {
  const file = CONFIG_PATH();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!IS_WIN) { try { fs.chmodSync(dir, 0o700); } catch {} }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file); // atomic write
}

// ---------- Shell ----------
function resolveShell(cfg) {
  if (cfg.shell && cfg.shell.trim()) {
    const [file, ...args] = cfg.shell.trim().split(/\s+/);
    return { file, args };
  }
  if (IS_WIN) return { file: 'powershell.exe', args: ['-NoLogo'] };
  // -l: login shell, so PATH includes npm/brew even when the app is opened from Finder
  return { file: process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'), args: ['-l'] };
}

// ---------- PTYs ----------
// node-pty 1.1.0 ships spawn-helper without the execute bit ("posix_spawnp failed").
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

// Extra variables per card (e.g. OLLAMA_API_BASE for Aider). Only valid names and string values.
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
    return { ok: false, error: `Could not start the shell "${file}": ${err.message}` };
  }

  ptys.set(id, p);
  p.onData((data) => { send('pty:data', id, data); bridge?.record(id, data); });
  p.onExit(({ exitCode }) => {
    // if we killed it ourselves (close/restart) it is no longer in the map: stay quiet,
    // or the notice would cover the new session in the same card
    if (ptys.get(id) !== p) return;
    ptys.delete(id);
    send('pty:exit', id, exitCode);
  });

  // Type the command into the shell: when the agent exits,
  // the card is left with a usable shell instead of closing.
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
// "Send to…": paste a block of text into another agent and submit it.
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
  if (out == null) return null; // not a repo, or git is not installed
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

// ---------- Detect installed agents ----------
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

// ---------- Accounts ----------
// Each CLI stores its own session on this computer. AgentBoard only checks
// that it exists; it never reads, copies or sends the tokens.
const exists = (...p) => { try { return fs.existsSync(path.join(...p)); } catch { return false; } };

function macKeychainHas(service) {
  return new Promise((resolve) => {
    if (!IS_MAC) return resolve(false);
    // Without -w/-g: does not return the secret, only whether the entry exists.
    execFile('security', ['find-generic-password', '-s', service], { timeout: 4000 }, (err) => resolve(!err));
  });
}

const PROVIDERS = {
  claude: {
    login: 'claude',
    where: IS_MAC ? 'macOS Keychain' : '~/.claude',
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

// Catalog + whether each CLI is installed and, where we can tell, whether it is signed in.
ipcMain.handle('catalog:status', async () => {
  const cfg = loadConfig();
  return Promise.all(CATALOG.map(async (item) => {
    const p = PROVIDERS[item.key];
    const [installed, loggedIn] = await Promise.all([which(item.command, cfg), p ? p.detect() : null]);
    return { ...item, installed, loggedIn, login: p?.login || item.command, where: p?.where || null };
  }));
});

// ---------- Local models ----------
// Only queries servers on this machine (127.0.0.1); nothing leaves the computer.
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

// ---------- Config / dialogs ----------
ipcMain.handle('config:load', () => ({ config: loadConfig(), platform: process.platform, configPath: CONFIG_PATH() }));
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('config:reveal', () => shell.showItemInFolder(CONFIG_PATH()));

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('clip:read', () => clipboard.readText());

// ---------- Skills and agents ----------
const projectsOf = () => loadConfig().projects || [];
const wrap = (fn) => async (...args) => { try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; } };

ipcMain.handle('usage:scan', wrap((_e, tasks) => usage.scanUsage({
  tasks, historyFile: path.join(app.getPath('userData'), 'task-history.json'),
  claudeDirs: [skills.claudeDir(), ...claudeAccountDirs()], codexDir: skills.codexDir(),
})));
ipcMain.handle('skills:scan', () => skills.scanSkills(projectsOf()));
ipcMain.handle('skills:copy', wrap((_e, src, target) => skills.copySkill(src, target, projectsOf())));
ipcMain.handle('agents:list', () => skills.listAgents(projectsOf()));
ipcMain.handle('agents:save', wrap(async (_e, a) => {
  const r = skills.saveAgent(a, projectsOf());
  if (r.replaced) await shell.trashItem(r.replaced);
  return r.file;
}));
ipcMain.handle('agents:delete', wrap(async (_e, file) => {
  if (!skills.isAgentFile(file, projectsOf())) throw new Error('Invalid agent file.');
  await shell.trashItem(file); // to the Trash: recoverable
  return true;
}));
ipcMain.handle('skills:reveal', (_e, p) => {
  const known = skills.scanSkills(projectsOf()).some((x) => path.resolve(x.path) === path.resolve(p))
    || skills.listAgents(projectsOf()).some((x) => path.resolve(x.file) === path.resolve(p));
  if (known) shell.showItemInFolder(p);
});

// ---------- Token-saving skills (bundled with AgentBoard) ----------
// skills-pack/<name>/SKILL.md, copied into each CLI's skills folder; the
// SKILL.md format is the same in Claude Code, Codex and Gemini.
const PACK_DIR = path.join(__dirname, '..', 'skills-pack');
// Names the same skills had up to v0.3.0; removed on install so they are not duplicated
const LEGACY_PACK = ['ahorro-contexto', 'tarea-agentboard', 'traspaso-compacto'];
const removeLegacyPack = (root) => { for (const n of LEGACY_PACK) fs.rmSync(path.join(root, n), { recursive: true, force: true }); };
const PACK_ROOTS = { claude: () => path.join(skills.claudeDir(), 'skills'), codex: () => path.join(skills.codexDir(), 'skills'), gemini: () => path.join(skills.geminiDir(), 'skills') };
// Folders of the extra Claude accounts (agents with their own CLAUDE_CONFIG_DIR)
const claudeAccountDirs = () => Object.values(loadConfig().agents || {}).map((a) => a.env?.CLAUDE_CONFIG_DIR).filter((d) => d && fs.existsSync(d));

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
// Install (or update) the token-saving skills for the given subscriptions.
ipcMain.handle('pack:install', wrap((_e, providers) => {
  const done = [];
  for (const k of providers || []) {
    if (!PACK_ROOTS[k]) continue;
    removeLegacyPack(PACK_ROOTS[k]());
    for (const { name } of packSkills()) {
      const dest = path.join(PACK_ROOTS[k](), name);
      fs.mkdirSync(dest, { recursive: true });
      // readFileSync works inside app.asar (cpSync does not)
      fs.writeFileSync(path.join(dest, 'SKILL.md'), fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md')));
      done.push(`${k}/${name}`);
    }
    if (k === 'claude') {
      for (const dir of claudeAccountDirs()) {
        removeLegacyPack(path.join(dir, 'skills'));
        for (const { name } of packSkills()) {
          const dest = path.join(dir, 'skills', name);
          fs.mkdirSync(dest, { recursive: true });
          fs.writeFileSync(path.join(dest, 'SKILL.md'), fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md')));
          done.push(`${path.basename(dir)}/${name}`);
        }
      }
    }
  }
  return done;
}));

// ---------- Tasks ----------
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

// Split free text into tasks with Claude in non-interactive mode and the cheapest
// model (haiku): one short call, no terminal, no repository access.
ipcMain.handle('tasks:plan', wrap(async (_e, text, opts = {}) => {
  const agents = (opts.agents || []).join(', ') || 'claude, codex, gemini';
  const projects = (opts.projects || []).join(', ') || '(none)';
  const prompt = [
    'Turn this to-do list into concrete, independent tasks for coding agents.',
    'Reply ONLY with a JSON array, no extra text:',
    '[{"text":"clear, self-contained instruction","agent":"auto|' + agents.replace(/, /g, '|') + '","light":true|false,"project":"name or empty","group":"short label or empty"}]',
    'light=true for simple work (docs, renames, a small test, a question). Use "auto" unless the text asks for a specific agent.',
    'Write each task in the same language as the to-do list.',
    'Available projects: ' + projects + '. Do not invent projects.',
    'To-do list:',
    String(text).slice(0, 8000),
  ].join('\n');
  const out = await runHeadless('claude -p --model haiku --tools "" --no-session-persistence', prompt);
  const m = out.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Claude did not return a list.');
  const list = JSON.parse(m[0]);
  if (!Array.isArray(list)) throw new Error('Invalid response.');
  return list.filter((t) => t && typeof t.text === 'string' && t.text.trim()).slice(0, 40);
}));

// ---------- Automations ----------
// Short question to Claude with no terminal and no tools (design a flow, explain it, decide YES/NO).
ipcMain.handle('ai:ask', wrap(async (_e, prompt, model = 'haiku') => {
  if (!['haiku', 'sonnet'].includes(model)) throw new Error('Invalid model.');
  const out = await runHeadless(`claude -p --model ${model} --tools "" --no-session-persistence`, String(prompt).slice(0, 30000), 180_000);
  return out.trim();
}));

// "Command" step of an automation: runs in the user's shell, inside the project.
ipcMain.handle('flow:exec', wrap((_e, cmd, cwd) => new Promise((resolve) => {
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const child = IS_WIN ? spawn(String(cmd), { shell: true, cwd: dir, windowsHide: true }) : spawn(resolveShell(loadConfig()).file, ['-lc', String(cmd)], { cwd: dir });
  let out = '';
  const keep = (d) => { out = (out + d).slice(-8000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const timer = setTimeout(() => { child.kill(); keep('\n[AgentBoard: stopped after 10 minutes]'); }, 10 * 60_000);
  child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: err.message }); });
  child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.trim() }); });
})));

// Isolated worktree for a task: <repo>/.agentboard/worktrees/<slug> on branch agentboard/<slug>.
function gitLong(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '') }));
  });
}
ipcMain.handle('git:worktree', wrap(async (_e, cwd, slug) => {
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Invalid project.');
  const top = (await gitLong(cwd, ['rev-parse', '--show-toplevel'])).out.trim();
  if (!top) throw new Error('The project is not a git repository.');
  const safe = String(slug || 'task').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
  let name = safe;
  for (let i = 2; fs.existsSync(path.join(top, '.agentboard', 'worktrees', name)); i++) name = `${safe}-${i}`;
  const dir = path.join(top, '.agentboard', 'worktrees', name);
  const branch = `agentboard/${name}`;
  const r = await gitLong(top, ['worktree', 'add', '-b', branch, dir]);
  if (!r.ok) throw new Error(r.err.trim() || 'git worktree failed.');
  // keep worktrees from showing up as changes in the main repo
  try {
    const gitDir = (await gitLong(top, ['rev-parse', '--git-common-dir'])).out.trim();
    const exclude = path.resolve(top, gitDir, 'info', 'exclude');
    const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
    if (!/^\/?\.agentboard\/?$/m.test(cur)) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}.agentboard/\n`); }
  } catch {}
  return { dir, branch };
}));

// ---------- Extra Claude accounts ----------
// Each account lives in its own config folder (CLAUDE_CONFIG_DIR) with its
// own login, history and skills, so a personal and a work subscription (or two
// plans) can be used side by side and the queue spreads tasks across them.
ipcMain.handle('accounts:claudeDir', wrap((_e, name) => {
  const slug = String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
  if (!slug) throw new Error('Invalid name.');
  const dir = path.join(os.homedir(), `.claude-${slug}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { dir, slug };
}));
// Does that folder already have a session? (file existence only; tokens are never read)
ipcMain.handle('accounts:claudeStatus', (_e, dirs) => Object.fromEntries((dirs || []).map((d) => [d,
  exists(d, '.credentials.json') || exists(d, 'projects')])));

// ---------- Review and merge a task's worktree ----------
async function worktreeTop(dir) {
  const common = (await gitLong(dir, ['rev-parse', '--git-common-dir'])).out.trim();
  if (!common) throw new Error('Not a git worktree.');
  return path.dirname(path.resolve(dir, common));
}

ipcMain.handle('git:worktreeInfo', wrap(async (_e, dir, branch) => {
  if (!dir || !fs.existsSync(dir)) throw new Error('The worktree no longer exists.');
  const top = await worktreeTop(dir);
  const base = (await gitLong(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
  const [dirty, ahead, stat] = await Promise.all([
    gitLong(dir, ['status', '--porcelain']),
    gitLong(top, ['rev-list', '--count', `${base}..${branch}`]),
    gitLong(top, ['diff', '--stat', `${base}...${branch}`]),
  ]);
  const wip = (await gitLong(dir, ['diff', '--stat', 'HEAD'])).out.trim();
  return {
    base, top, branch,
    uncommitted: dirty.out.split('\n').filter(Boolean).length,
    commits: parseInt(ahead.out, 10) || 0,
    stat: [stat.out.trim(), dirty.out.trim() ? `Uncommitted:\n${dirty.out.trimEnd()}${wip ? `\n\n${wip}` : ''}` : ''].filter(Boolean).join('\n\n').split('\n').slice(-40).join('\n'),
  };
}));

// Merge the task's branch into the main repo's current branch and remove the worktree.
ipcMain.handle('git:worktreeMerge', wrap(async (_e, dir, branch, message) => {
  const top = await worktreeTop(dir);
  const mainDirty = (await gitLong(top, ['status', '--porcelain', '--untracked-files=no'])).out.trim();
  if (mainDirty) throw new Error('The main repo has uncommitted changes; commit or stash them before merging.');
  if ((await gitLong(dir, ['status', '--porcelain'])).out.trim()) {
    await gitLong(dir, ['add', '-A']);
    const c = await gitLong(dir, ['commit', '-m', String(message || `AgentBoard: ${branch}`).slice(0, 200)]);
    if (!c.ok) throw new Error('Could not commit in the worktree: ' + c.err.trim());
  }
  const m = await gitLong(top, ['merge', '--no-ff', '--no-edit', branch]);
  if (!m.ok) {
    await gitLong(top, ['merge', '--abort']);
    throw new Error('There are conflicts; nothing was merged. Resolve them in the agent card. ' + m.err.trim().split('\n').slice(-2).join(' '));
  }
  await gitLong(top, ['worktree', 'remove', '--force', dir]);
  await gitLong(top, ['branch', '-d', branch]);
  return { base: (await gitLong(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() };
}));

// Discard the work: remove the worktree and its branch.
ipcMain.handle('git:worktreeDiscard', wrap(async (_e, dir, branch) => {
  const top = await worktreeTop(dir);
  await gitLong(top, ['worktree', 'remove', '--force', dir]);
  await gitLong(top, ['branch', '-D', branch]);
  return true;
}));

// Dock badge: tasks waiting for your review.
ipcMain.on('app:badge', (_e, n) => { if (IS_MAC) app.dock?.setBadge(n > 0 ? String(n) : ''); });

// ---------- Global shortcut: add a task from any app ----------
let quickKey = null;
function registerQuickKey() {
  const want = loadConfig().quickKey || '';
  if (want === quickKey) return { ok: true };
  if (quickKey) { try { globalShortcut.unregister(quickKey); } catch {} }
  quickKey = null;
  if (!want) return { ok: true };
  let ok = false;
  try { ok = globalShortcut.register(want, () => { showWindow(); send('menu', 'quick-task'); }); } catch {}
  if (ok) quickKey = want;
  return ok ? { ok: true } : { ok: false, error: `Could not register ${want} (is another app using it?).` };
}
ipcMain.handle('app:quickKey', () => registerQuickKey());

// ---------- Bridge between agents (MCP) ----------
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

// Only checks whether the "agentboard" entry exists; reads nothing else from those files.
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

// Bridge requests only the UI can answer (e.g. adding a task to the list).
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
    requestNewCard: ({ agent, cwd, title, light, from }) => new Promise((resolve) => {
      const reqId = Math.random().toString(36).slice(2);
      pendingCards.set(reqId, resolve);
      send('bridge:new-card', { reqId, agent, cwd, title, light, from });
      setTimeout(() => { if (pendingCards.delete(reqId)) resolve(null); }, 5000);
    }),
  });
  bridge.start();
}

// ---------- Window + menu ----------
// Shortcuts: every action has a default; Settings → Shortcuts overrides them
// (cfg.shortcuts = { action: "CmdOrCtrl+Shift+X" }, empty = no shortcut).
const SHORTCUTS = [
  { id: 'new:claude', label: 'New Claude', key: 'CmdOrCtrl+Shift+1', section: 'Agents' },
  { id: 'new:codex', label: 'New Codex', key: 'CmdOrCtrl+Shift+2', section: 'Agents' },
  { id: 'new:gemini', label: 'New Gemini', key: 'CmdOrCtrl+Shift+3', section: 'Agents' },
  { id: 'new:shell', label: 'New Terminal', key: 'CmdOrCtrl+Shift+4', section: 'Agents' },
  { id: 'new:note', label: 'New Note', key: 'CmdOrCtrl+Shift+N', section: 'Board' },
  { id: 'new:group', label: 'New Group', key: 'CmdOrCtrl+Shift+G', section: 'Board' },
  { id: 'tasks', label: 'Tasks', key: 'CmdOrCtrl+Shift+T', section: 'Panels' },
  { id: 'diagram', label: 'Diagram', key: 'CmdOrCtrl+Shift+D', section: 'Panels' },
  { id: 'flows', label: 'Automations', key: 'CmdOrCtrl+Shift+F', section: 'Panels' },
  { id: 'usage', label: 'Usage and Savings', key: 'CmdOrCtrl+Shift+U', section: 'Panels' },
  { id: 'palette', label: 'Search or Run…', key: 'CmdOrCtrl+Shift+P', section: 'Panels' },
  { id: 'sidebar', label: 'Agent List', key: 'CmdOrCtrl+Shift+A', section: 'Panels' },
  { id: 'space:next', label: 'Next Project', key: 'CmdOrCtrl+Alt+Right', section: 'Projects' },
  { id: 'space:prev', label: 'Previous Project', key: 'CmdOrCtrl+Alt+Left', section: 'Projects' },
  { id: 'space:all', label: 'All Projects', key: 'CmdOrCtrl+Alt+0', section: 'Projects' },
  { id: 'arrange', label: 'Arrange Cards', key: 'CmdOrCtrl+Shift+O', section: 'Board' },
  { id: 'fit', label: 'Fit All', key: 'CmdOrCtrl+0', section: 'Board' },
  { id: 'zoom:in', label: 'Zoom In', key: 'CmdOrCtrl+=', section: 'Board' },
  { id: 'zoom:out', label: 'Zoom Out', key: 'CmdOrCtrl+-', section: 'Board' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts…', key: 'CmdOrCtrl+/', section: 'Panels' },
  { id: 'settings', label: 'Settings…', key: 'CmdOrCtrl+,', section: 'Panels' },
];
ipcMain.handle('shortcuts:list', () => SHORTCUTS);
ipcMain.on('menu:rebuild', () => { buildMenu(); registerQuickKey(); });

function buildMenu() {
  const cmd = (action) => () => send('menu', action);
  const over = loadConfig().shortcuts || {};
  const item = (id) => {
    const sc = SHORTCUTS.find((x) => x.id === id);
    const key = id in over ? over[id] : sc.key;
    return { label: sc.label, ...(key ? { accelerator: key } : {}), click: cmd(id) };
  };
  const sep = { type: 'separator' };
  const checkUpdates = { label: 'Check for Updates…', click: () => updater?.check(true) };
  const template = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, checkUpdates, sep, { role: 'services' }, sep,
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Board',
      submenu: [
        item('new:claude'), item('new:codex'), item('new:gemini'), item('new:shell'), item('new:note'), item('new:group'), sep,
        item('tasks'), item('diagram'), item('flows'), item('usage'), item('palette'), sep,
        item('sidebar'),
        { label: 'Skills and Agents…', click: cmd('skills') },
        { label: 'Subscriptions and Accounts…', click: cmd('accounts') }, sep,
        item('arrange'), item('fit'), item('zoom:in'), item('zoom:out'), sep,
        item('shortcuts'), item('settings'),
        ...(IS_MAC ? [] : [sep, checkUpdates, { role: 'quit', label: 'Quit' }]),
      ],
    },
    { label: 'Projects', submenu: [item('space:next'), item('space:prev'), item('space:all')] },
    // On Windows we do NOT register the Edit menu: its Ctrl+C/Ctrl+V shortcuts
    // would steal Ctrl+C (interrupt) from the terminals. The UI handles the
    // clipboard there.
    ...(IS_MAC ? [{ role: 'editMenu' }] : []),
    // ⌘W closes the window (agents keep running in the background), ⌘M minimizes
    ...(IS_MAC ? [{ role: 'windowMenu' }] : []),
    {
      label: 'View',
      // Reload without Ctrl+R on Windows (that is the shell's history search)
      submenu: [
        IS_MAC ? { role: 'reload' } : { label: 'Reload', click: () => win && win.reload() },
        { role: 'toggleDevTools' }, sep, { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Updates ----------
let updater = null;
ipcMain.on('update:download', (_e, url) => updater?.download(url));
ipcMain.on('update:install', () => updater?.install());

// The window theme (traffic lights, menus, dialogs) follows the app's theme.
const { nativeTheme } = require('electron');
ipcMain.on('app:theme', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system'; });

// ---------- Icon, tray and background mode ----------
// Closing the window only hides it (while agents are running): they keep working
// and queued tasks keep being dispatched. To really quit: ⌘Q or the tray.
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
  tray.setToolTip(`AgentBoard — ${n} agent${n === 1 ? '' : 's'} open, ${busy} working`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show AgentBoard', click: showWindow },
    { label: `${n} open · ${busy} working`, enabled: false },
    { type: 'separator' },
    { label: 'Quit (stops the agents)', click: () => { quitting = true; app.quit(); } },
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
    buttons: ['Quit', 'Keep Running in Background', 'Cancel'],
    defaultId: busy ? 1 : 0, cancelId: 2,
    message: `${ptys.size} agent${ptys.size === 1 ? ' is' : 's are'} open${busy ? ` (${busy} working)` : ''}.`,
    detail: 'Quitting stops them; their sessions resume the next time you open AgentBoard. Your subscriptions stay signed in either way.',
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
      sandbox: false,
      backgroundThrottling: false, // keep statuses and the task queue up to date while hidden
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links (http/https) open in the browser, never inside the app
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
        tray.displayBalloon?.({ title: 'AgentBoard is still running', content: 'Your agents keep working. Open or quit it from this icon.' });
      }
    } else if (!confirmQuit()) e.preventDefault();
    else quitting = true;
  });
  win.on('closed', () => { killAll(); win = null; });
}

// Single instance: opening the app again shows the existing window.
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
    registerQuickKey();
    updater = createUpdater({
      send, loadConfig,
      // Restarting to install stops the agents: ask first, like ⌘Q
      onBeforeInstall: () => { if (!confirmQuit()) return false; quitting = true; return true; },
    });
    updater.start();
    app.on('activate', showWindow);
  });
}

app.on('before-quit', (e) => {
  if (!quitting && !confirmQuit()) { e.preventDefault(); return; }
  quitting = true;
  killAll(); bridge?.stop();
});
app.on('window-all-closed', () => { killAll(); bridge?.stop(); app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
