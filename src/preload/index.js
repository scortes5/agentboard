// Safe bridge between the UI and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ab', {
  // PTY
  ptyCreate: (opts) => ipcRenderer.invoke('pty:create', opts),
  ptyWrite: (id, data) => ipcRenderer.send('pty:write', id, data),
  ptyResize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id) => ipcRenderer.send('pty:kill', id),
  onPtyData: (cb) => ipcRenderer.on('pty:data', (_e, id, data) => cb(id, data)),
  onPtyExit: (cb) => ipcRenderer.on('pty:exit', (_e, id, code) => cb(id, code)),

  // Git
  gitStatus: (cwd) => ipcRenderer.invoke('git:status', cwd),
  gitBranches: (cwd) => ipcRenderer.invoke('git:branches', cwd),
  gitCheckout: (cwd, branch, create) => ipcRenderer.invoke('git:checkout', cwd, branch, create),

  // Config and system
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  revealConfig: () => ipcRenderer.invoke('config:reveal'),
  checkAgents: () => ipcRenderer.invoke('agents:check'),
  catalogStatus: () => ipcRenderer.invoke('catalog:status'),
  ptyPaste: (id, text) => ipcRenderer.invoke('pty:paste', id, text),

  // Skills, agents and the bridge between agents
  skillsScan: () => ipcRenderer.invoke('skills:scan'),
  skillsCopy: (src, target) => ipcRenderer.invoke('skills:copy', src, target),
  skillsReveal: (p) => ipcRenderer.invoke('skills:reveal', p),
  agentsList: () => ipcRenderer.invoke('agents:list'),
  agentsSave: (a) => ipcRenderer.invoke('agents:save', a),
  agentsDelete: (file) => ipcRenderer.invoke('agents:delete', file),
  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  onBridgeEvent: (cb) => ipcRenderer.on('bridge:event', (_e, ev) => cb(ev)),
  onBridgeNewCard: (cb) => ipcRenderer.on('bridge:new-card', (_e, req) => cb(req)),
  bridgeCardCreated: (reqId, id) => ipcRenderer.send('bridge:card-created', reqId, id),
  onBridgeAsk: (cb) => ipcRenderer.on('bridge:ask', (_e, req) => cb(req)),
  bridgeAnswer: (reqId, value) => ipcRenderer.send('bridge:answer', reqId, value),

  // Tasks, worktrees and token-saving skills
  planTasks: (text, opts) => ipcRenderer.invoke('tasks:plan', text, opts),
  gitWorktree: (cwd, slug) => ipcRenderer.invoke('git:worktree', cwd, slug),
  worktreeInfo: (dir, branch) => ipcRenderer.invoke('git:worktreeInfo', dir, branch),
  worktreeMerge: (dir, branch, msg) => ipcRenderer.invoke('git:worktreeMerge', dir, branch, msg),
  worktreeDiscard: (dir, branch) => ipcRenderer.invoke('git:worktreeDiscard', dir, branch),
  // Review: checkpoints, the full diff of a task and pull requests
  gitCheckpoint: (cwd, label) => ipcRenderer.invoke('git:checkpoint', cwd, label),
  gitRestore: (cwd, sha) => ipcRenderer.invoke('git:restore', cwd, sha),
  gitFullDiff: (opts) => ipcRenderer.invoke('git:fullDiff', opts),
  gitPullRequest: (opts) => ipcRenderer.invoke('git:pullRequest', opts),
  claudeAccountDir: (name) => ipcRenderer.invoke('accounts:claudeDir', name),
  claudeAccountStatus: (dirs) => ipcRenderer.invoke('accounts:claudeStatus', dirs),
  setBadge: (n) => ipcRenderer.send('app:badge', n),
  shortcutsList: () => ipcRenderer.invoke('shortcuts:list'),
  aiAsk: (prompt, model) => ipcRenderer.invoke('ai:ask', prompt, model),
  flowExec: (cmd, cwd) => ipcRenderer.invoke('flow:exec', cmd, cwd),
  rebuildMenu: () => ipcRenderer.send('menu:rebuild'),
  setTheme: (mode) => ipcRenderer.send('app:theme', mode),
  applyQuickKey: () => ipcRenderer.invoke('app:quickKey'),
  packStatus: () => ipcRenderer.invoke('pack:status'),
  packInstall: (providers) => ipcRenderer.invoke('pack:install', providers),
  usageScan: (tasks) => ipcRenderer.invoke('usage:scan', tasks),
  usageSessions: (ids) => ipcRenderer.invoke('usage:sessions', ids),
  localModels: () => ipcRenderer.invoke('local:models'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  onUpdate: (cb) => ipcRenderer.on('update:available', (_e, u) => cb(u)),
  updateDownload: (url) => ipcRenderer.send('update:download', url),
  updateInstall: () => ipcRenderer.send('update:install'),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),

  // Clipboard
  // Electron 44 no longer exposes `clipboard` in the preload: go through the main process
  copy: (text) => ipcRenderer.send('clip:write', String(text ?? '')),
  paste: () => ipcRenderer.invoke('clip:read'), // async: macOS may ask "Allow paste?"
});
