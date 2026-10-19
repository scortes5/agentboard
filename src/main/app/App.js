// The application: one window, background mode (closing the window keeps the agents working),
// confirming before quitting, and the services that answer the window.
'use strict';
const path = require('path');
const { app, BrowserWindow, dialog, shell, ipcMain, globalShortcut } = require('electron');
const { IS_MAC } = require('../core/platform');

const ICON = path.join(__dirname, '..', '..', 'renderer', 'icon.png');
const PRELOAD = path.join(__dirname, '..', '..', 'preload', 'index.js');
const PAGE = path.join(__dirname, '..', '..', 'renderer', 'index.html');

class App {
  // services: objects with register(ipcMain) and, optionally, onReady() and onQuit();
  // see src/main/index.js for how they are made.
  constructor({ config, ptyHost, bridge, menu, tray, quickKey, updater, services }) {
    Object.assign(this, { config, ptyHost, bridge, menu, tray, quickKey, updater, services });
    this.win = null;
    this.quitting = false;
  }

  send(channel, ...args) {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send(channel, ...args);
  }

  showWindow() {
    if (!this.win) this.createWindow();
    else { if (this.win.isMinimized()) this.win.restore(); this.win.show(); this.win.focus(); }
  }

  quit() { this.quitting = true; app.quit(); }

  confirmQuit() {
    const open = this.ptyHost.ptys.size;
    if (!open) return true;
    const busy = this.bridge.busyIds().length;
    const r = dialog.showMessageBoxSync(this.win?.isVisible() ? this.win : null, {
      type: 'question', buttons: ['Quit', 'Keep Running in Background', 'Cancel'], defaultId: busy ? 1 : 0, cancelId: 2,
      message: `${open} agent${open === 1 ? ' is' : 's are'} open${busy ? ` (${busy} working)` : ''}.`,
      detail: 'Quitting stops them; their sessions resume the next time you open AgentBoard. Your subscriptions stay signed in either way.',
    });
    if (r === 1) this.win?.hide();
    return r === 0;
  }

  createWindow() {
    this.win = new BrowserWindow({
      icon: ICON, width: 1500, height: 950, minWidth: 800, minHeight: 500, backgroundColor: '#0f1115', title: 'AgentBoard',
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
      webPreferences: {
        preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false, // keep statuses and the task queue up to date while hidden
      },
    });
    this.win.loadFile(PAGE);
    // Links open in the browser, never inside the app
    this.win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.on('close', (e) => this.onClose(e));
    this.win.on('closed', () => { this.ptyHost.killAll(); this.win = null; });
  }

  // Closing the window keeps the agents running (background mode) unless the user quits.
  onClose(e) {
    if (this.quitting) return;
    if (this.config.load().keepRunning && this.ptyHost.ptys.size) {
      e.preventDefault();
      this.win.hide();
      if (!IS_MAC) this.tray.hintOnce();
    } else if (!this.confirmQuit()) e.preventDefault();
    else this.quitting = true;
  }

  start() {
    for (const s of this.services) s.register(ipcMain);
    ipcMain.on('menu:rebuild', () => { this.menu.build(); this.quickKey.apply(); });
    if (!app.requestSingleInstanceLock()) return app.quit();
    app.on('second-instance', () => this.showWindow());
    app.whenReady().then(() => {
      if (IS_MAC && !app.isPackaged) app.dock?.setIcon(ICON);
      this.menu.build();
      this.bridge.start();
      this.createWindow();
      this.tray.create();
      this.quickKey.apply();
      this.updater.start();
      for (const s of this.services) s.onReady?.();
      app.on('activate', () => this.showWindow());
    });
    app.on('before-quit', (e) => {
      if (!this.quitting && !this.confirmQuit()) { e.preventDefault(); return; }
      this.quitting = true;
      this.ptyHost.killAll(); this.bridge.stop();
      for (const s of this.services) s.onQuit?.();
    });
    app.on('window-all-closed', () => { this.ptyHost.killAll(); this.bridge.stop(); app.quit(); });
    app.on('will-quit', () => globalShortcut.unregisterAll());
  }
}

module.exports = { App };
