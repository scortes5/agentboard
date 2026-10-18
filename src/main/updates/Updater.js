// Update checks on start and every six hours, and "Check for Updates…" from the menu. How an
// update is found and installed depends on the platform: a strategy decides (in place on
// Windows, by download elsewhere), so a new way of updating is a new strategy class.
'use strict';
const { app, shell, dialog, BrowserWindow } = require('electron');
const { GitHubReleaseStrategy } = require('./GitHubReleaseStrategy');
const { NativeUpdateStrategy } = require('./NativeUpdateStrategy');

const REPO = 'scortes5/agentboard';
const EVERY = 6 * 60 * 60 * 1000;

class Updater {
  // send: events to the window; config: whether automatic checks are on; onBeforeInstall:
  // asks the user before restarting (it stops the agents).
  constructor({ send, config, onBeforeInstall }) {
    Object.assign(this, { send, config, onBeforeInstall });
    this.notified = null; // version already shown by an automatic check
    this.manual = false;  // the current check came from the menu
    this.strategy = process.platform === 'win32' && app.isPackaged
      ? new NativeUpdateStrategy({
        onReady: (u) => { this.offer(u); this.manual = false; },
        onDownloading: (v) => { if (this.manual) this.info(`Downloading AgentBoard ${v}…`, 'It will be ready to install in a moment.'); },
        onUpToDate: (v) => this.upToDate(v),
        onError: (err) => this.failed(err),
      })
      : new GitHubReleaseStrategy({ repo: REPO, currentVersion: () => this.currentVersion() });
  }

  // Lets a maintainer test the notice from source: AGENTBOARD_FAKE_VERSION=0.1.0 npm start
  currentVersion() { return (!app.isPackaged && process.env.AGENTBOARD_FAKE_VERSION) || app.getVersion(); }

  // A sheet on a hidden window would never be seen.
  parent() { return BrowserWindow.getAllWindows().find((w) => w.isVisible()) || null; }
  info(message, detail) { return dialog.showMessageBox(this.parent(), { type: 'info', message, detail, buttons: ['OK'] }); }

  offer(update) {
    if (!this.manual && this.notified === update.version) return;
    this.notified = update.version;
    this.send('update:available', update);
  }

  upToDate(latest) {
    if (this.manual) {
      this.info('AgentBoard is up to date', `This copy is version ${this.currentVersion()}${latest ? ` and the latest release on GitHub is ${latest}` : ''}.`
        + (app.isPackaged ? `\n\nRunning from: ${app.getPath('exe').replace(/\/Contents\/MacOS\/.*$/, '')}` : ''));
    }
    this.manual = false;
  }

  failed(err) {
    console.error('[updates]', err?.message || err);
    if (this.manual) dialog.showMessageBox(this.parent(), { type: 'warning', message: 'Could not check for updates', detail: String(err?.message || err), buttons: ['OK'] });
    this.manual = false;
  }

  async check(fromMenu = false) {
    this.manual = fromMenu;
    try {
      const r = await this.strategy.check();
      if (r.update) { this.offer(r.update); this.manual = false; } else if ('latest' in r) this.upToDate(r.latest);
    } catch (err) { this.failed(err); }
  }

  start() {
    const auto = () => { if (this.config.load().checkUpdates !== false) this.check(false); };
    setTimeout(auto, 10 * 1000); // let the window and agents start first
    setInterval(auto, EVERY);
  }

  // Only this repository's release pages are opened, whatever the window sends.
  download(url) {
    if (typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`)) shell.openExternal(url);
  }

  install() {
    if (!this.strategy.install || (this.onBeforeInstall && !this.onBeforeInstall())) return;
    this.strategy.install();
  }

  register(ipcMain) {
    ipcMain.on('update:download', (_e, url) => this.download(url));
    ipcMain.on('update:install', () => this.install());
  }
}

module.exports = { Updater };
