// The application menu, built from the shortcut list and the user's overrides.
'use strict';
const { app, Menu } = require('electron');
const { IS_MAC } = require('../core/platform');
const SHORTCUTS = require('./shortcuts');

class AppMenu {
  // send(action): tells the window to run a menu action; checkUpdates/reload: app actions.
  constructor({ config, send, checkUpdates, reload }) {
    Object.assign(this, { config, send, checkUpdates, reload });
  }

  build() {
    const over = this.config.load().shortcuts || {};
    const cmd = (action) => () => this.send('menu', action);
    const item = (id) => {
      const sc = SHORTCUTS.find((x) => x.id === id);
      const key = id in over ? over[id] : sc.key;
      return { label: sc.label, ...(key ? { accelerator: key } : {}), click: cmd(id) };
    };
    const sep = { type: 'separator' };
    const checkUpdates = { label: 'Check for Updates…', click: () => this.checkUpdates() };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(IS_MAC ? [{
        label: app.name,
        submenu: [{ role: 'about' }, checkUpdates, sep, { role: 'services' }, sep, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' }],
      }] : []),
      {
        label: 'Board',
        submenu: [
          item('new:claude'), item('new:codex'), item('new:gemini'), item('new:shell'), item('new:note'), item('new:group'), sep,
          item('tasks'), item('diagram'), item('flows'), item('usage'), item('palette'), sep,
          item('sidebar'), { label: 'Skills and Agents…', click: cmd('skills') }, { label: 'Subscriptions and Accounts…', click: cmd('accounts') }, sep,
          item('arrange'), item('fit'), item('zoom:in'), item('zoom:out'), sep,
          item('shortcuts'), item('settings'),
          ...(IS_MAC ? [] : [sep, checkUpdates, { role: 'quit', label: 'Quit' }]),
        ],
      },
      { label: 'Projects', submenu: [item('space:next'), item('space:prev'), item('space:all')] },
      // No Edit menu on Windows: its Ctrl+C/Ctrl+V would steal Ctrl+C (interrupt) from the terminals.
      ...(IS_MAC ? [{ role: 'editMenu' }, { role: 'windowMenu' }] : []),
      {
        label: 'View',
        // Reload without Ctrl+R on Windows (that is the shell's history search)
        submenu: [IS_MAC ? { role: 'reload' } : { label: 'Reload', click: () => this.reload() }, { role: 'toggleDevTools' }, sep, { role: 'togglefullscreen' }],
      },
    ]));
  }

  register(ipcMain) {
    ipcMain.handle('shortcuts:list', () => SHORTCUTS);
  }
}

module.exports = { AppMenu };
