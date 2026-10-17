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
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, action) => cb(action)),

  // Portapapeles
  copy: (text) => clipboard.writeText(text),
  paste: () => clipboard.readText(),
});
