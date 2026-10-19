// The global shortcut that adds a task from any app (Settings → General).
'use strict';
const { globalShortcut } = require('electron');

class QuickKey {
  constructor({ config, onPress }) {
    Object.assign(this, { config, onPress });
    this.current = null;
  }

  apply() {
    const want = this.config.load().quickKey || '';
    if (want === this.current) return { ok: true };
    if (this.current) { try { globalShortcut.unregister(this.current); } catch {} }
    this.current = null;
    if (!want) return { ok: true };
    let ok = false;
    try { ok = globalShortcut.register(want, this.onPress); } catch {}
    if (ok) this.current = want;
    return ok ? { ok: true } : { ok: false, error: `Could not register ${want} (is another app using it?).` };
  }

  register(ipcMain) {
    ipcMain.handle('app:quickKey', () => this.apply());
  }
}

module.exports = { QuickKey };
