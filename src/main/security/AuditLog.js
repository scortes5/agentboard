// What happened that matters for security: permission requests answered (and by whom: you,
// your phone or a rule), devices that used the remote, automation commands and the secrets they
// got, and secrets added or removed. One JSON line per event in audit.log (readable only by
// your user), shown in Settings → Security.
'use strict';
const fs = require('fs');
const path = require('path');

const { wrap } = require('../core/platform');

const MAX_BYTES = 1024 * 1024;
const FROM_WINDOW = new Set(['approval', 'remote-refused']); // events the window may record

class AuditLog {
  constructor({ dataDir }) {
    this.file = path.join(dataDir, 'audit.log');
  }

  add(kind, detail = {}) {
    try {
      const line = JSON.stringify({ at: new Date().toISOString(), kind, ...detail }).slice(0, 4000);
      fs.appendFileSync(this.file, line + '\n', { mode: 0o600 });
      if (fs.statSync(this.file).size > MAX_BYTES) this.trim();
    } catch (err) { console.error('audit:', err.message); }
  }

  // Keep the newer half when the file grows past 1 MB.
  trim() {
    const lines = fs.readFileSync(this.file, 'utf8').trim().split('\n');
    fs.writeFileSync(this.file, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n', { mode: 0o600 });
  }

  recent(n = 200) {
    try {
      return fs.readFileSync(this.file, 'utf8').trim().split('\n').slice(-n).reverse()
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  // Every event as CSV (oldest first): time, kind, and the details as columns.
  static toCsv(events) {
    const cols = [...new Set(events.flatMap((e) => Object.keys(e)))].filter((k) => k !== 'at' && k !== 'kind');
    const cell = (v) => {
      let s = v == null ? '' : Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`; // a spreadsheet must not run it as a formula
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [['at', 'kind', ...cols].join(','), ...events.map((e) => [e.at, e.kind, ...cols.map((k) => e[k])].map(cell).join(','))].join('\n') + '\n';
  }

  // Asks where to save it and writes the whole log as CSV; resolves with the path, or null if cancelled.
  async exportCsv() {
    const { dialog } = require('electron');
    const r = await dialog.showSaveDialog({ title: 'Export the security log', defaultPath: `agentboard-activity-${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, AuditLog.toCsv(this.recent(Infinity).reverse()), { mode: 0o600 });
    return r.filePath;
  }

  register(ipcMain) {
    ipcMain.on('audit:add', (_e, kind, detail) => {
      if (FROM_WINDOW.has(kind) && detail && typeof detail === 'object') this.add(kind, JSON.parse(JSON.stringify(detail)));
    });
    ipcMain.handle('audit:recent', (_e, n) => this.recent(Math.min(+n || 200, 1000)));
    ipcMain.handle('audit:export', wrap(() => this.exportCsv()));
  }
}

module.exports = { AuditLog };
