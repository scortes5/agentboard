// What the window asks of the operating system: its board file, folders, the clipboard,
// the Dock badge and the window theme.
'use strict';
const { app, dialog, shell, clipboard, nativeTheme } = require('electron');
const { IS_MAC } = require('../core/platform');

class SystemIpc {
  // getWindow(): the main window, the parent of the folder picker.
  constructor({ config, getWindow }) {
    Object.assign(this, { config, getWindow });
  }

  register(ipcMain) {
    ipcMain.handle('config:load', () => ({ config: this.config.load(), platform: process.platform, configPath: this.config.path }));
    ipcMain.handle('config:save', (_e, cfg) => { this.config.save(cfg); return true; });
    ipcMain.handle('config:reveal', () => shell.showItemInFolder(this.config.path));
    ipcMain.handle('dialog:pickFolder', async () => {
      const r = await dialog.showOpenDialog(this.getWindow(), { properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0];
    });
    ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
    ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text ?? '')));
    ipcMain.handle('clip:read', () => clipboard.readText());
    // Dock badge: tasks waiting for your review.
    ipcMain.on('app:badge', (_e, n) => { if (IS_MAC) app.dock?.setBadge(n > 0 ? String(n) : ''); });
    // The window theme (traffic lights, menus, dialogs) follows the app's theme.
    ipcMain.on('app:theme', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system'; });
  }
}

module.exports = { SystemIpc };
