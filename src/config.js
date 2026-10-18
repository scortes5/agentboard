// This machine's board: projects, cards, tasks and settings, in the app's data folder.
'use strict';
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN } = require('./platform');

// ---------- Per-machine config ----------
// Lives in the app's data folder (NOT in the repo), so each computer
// keeps its own board, projects and commands.
//   Mac:     ~/Library/Application Support/AgentBoard/board.json
//   Windows: %APPDATA%\AgentBoard\board.json
const configPath = () => path.join(app.getPath('userData'), 'board.json');

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
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
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
  const file = configPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!IS_WIN) { try { fs.chmodSync(dir, 0o700); } catch {} }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file); // atomic write
}

module.exports = { DEFAULT_AGENTS, CATALOG, defaultConfig, loadConfig, saveConfig, configPath };
