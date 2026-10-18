// The menu bar / tray icon: shows how many agents are open and working, and how to quit.
'use strict';
const path = require('path');
const { Menu, Tray, nativeImage } = require('electron');

class TrayIcon {
  // counts(): { open, busy }; onShow / onQuit: what its menu does.
  constructor({ counts, onShow, onQuit }) {
    Object.assign(this, { counts, onShow, onQuit });
    this.tray = null;
  }

  create() {
    const img = nativeImage.createFromPath(path.join(__dirname, '..', '..', 'tray.png'));
    if (img.isEmpty()) return;
    this.tray = new Tray(img);
    this.tray.on('click', this.onShow);
    this.refresh();
    setInterval(() => this.refresh(), 5000);
  }

  refresh() {
    if (!this.tray) return;
    const { open, busy } = this.counts();
    this.tray.setToolTip(`AgentBoard — ${open} agent${open === 1 ? '' : 's'} open, ${busy} working`);
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show AgentBoard', click: this.onShow },
      { label: `${open} open · ${busy} working`, enabled: false },
      { type: 'separator' },
      { label: 'Quit (stops the agents)', click: this.onQuit },
    ]));
  }

  // Windows: say once that closing the window keeps the agents running.
  hintOnce() {
    if (this.hinted || !this.tray?.displayBalloon) return;
    this.hinted = true;
    this.tray.displayBalloon({ title: 'AgentBoard is still running', content: 'Your agents keep working. Open or quit it from this icon.' });
  }
}

module.exports = { TrayIcon };
