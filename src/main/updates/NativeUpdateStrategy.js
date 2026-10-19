// Updates in place (installed Windows builds): electron-updater downloads the new installer
// in the background and installs it on restart; NSIS needs no signature.
'use strict';

class NativeUpdateStrategy {
  // onReady(update): the download finished and it can be installed.
  constructor({ onReady, onDownloading, onUpToDate, onError }) {
    ({ autoUpdater: this.updater } = require('electron-updater'));
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = true;
    this.updater.on('update-available', (u) => onDownloading(u.version));
    this.updater.on('update-not-available', (u) => onUpToDate(u?.version));
    this.updater.on('update-downloaded', (u) => onReady({ version: u.version, ready: true, detail: 'It is downloaded. Restart AgentBoard to install it.' }));
    this.updater.on('error', onError);
  }

  // Results arrive through the events above.
  async check() { await this.updater.checkForUpdates(); return {}; }

  install() { this.updater.quitAndInstall(); }
}

module.exports = { NativeUpdateStrategy };
