// Puente seguro entre la UI y el proceso principal.
const { contextBridge, ipcRenderer, clipboard } = require('electron');

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

  // Config y sistema
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (cfg) => ipcRenderer.invoke('config:save', cfg),
  revealConfig: () => ipcRenderer.invoke('config:reveal'),
  checkAgents: () => ipcRenderer.invoke('agents:check'),
  catalogStatus: () => ipcRenderer.invoke('catalog:status'),
  ptyPaste: (id, text) => ipcRenderer.invoke('pty:paste', id, text),

  // Skills, agentes y puente entre agentes
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
  localModels: () => ipcRenderer.invoke('local:models'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),

  // Portapapeles
  copy: (text) => clipboard.writeText(text),
  paste: () => clipboard.readText(),
});
