// Remote control from a phone on the same network: a small web page that shows the tasks and
// the permission requests, approves or rejects them, and adds tasks. Off by default; every
// request needs the random token from the link shown in Settings → Integrations.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { wrap } = require('../core/platform');

const PAGE_DIR = path.join(__dirname, 'page');
const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
};
const MAX_BODY = 16 * 1024;

class RemoteServer {
  // send(channel, payload): forwards what the phone asks to the window, which owns the tasks.
  constructor({ config, send }) {
    Object.assign(this, { config, send });
    this.server = null;
    this.snapshot = { tasks: [], approvals: [], counts: {} };
  }

  settings() { return { enabled: false, port: 7777, token: '', ...(this.config.load().remote || {}) }; }

  // Addresses the phone can reach on this computer's networks.
  urls() {
    const { port, token } = this.settings();
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    return ips.map((ip) => `http://${ip}:${port}/#t=${token}`);
  }

  status() { return { running: !!this.server?.listening, urls: this.server?.listening ? this.urls() : [], ...this.settings(), token: undefined }; }

  // Start, restart or stop the server to match Settings.
  async apply() {
    await this.stop();
    const s = this.settings();
    if (!s.enabled) return this.status();
    if (s.token.length < 32) throw new Error('Create a link first (Settings → Integrations).');
    await new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.once('error', reject);
      this.server.listen(s.port, '0.0.0.0', resolve);
    });
    return this.status();
  }

  // App lifecycle (see App.start): a port already in use only disables the remote.
  onReady() { this.apply().catch((err) => console.error('Remote control:', err.message)); }
  onQuit() { this.stop(); }

  stop() {
    return new Promise((resolve) => { if (!this.server) return resolve(); this.server.close(() => resolve()); this.server = null; });
  }

  authorized(req) {
    const given = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    const want = Buffer.from(this.settings().token);
    return want.length > 0 && given.length === want.length && crypto.timingSafeEqual(given, want);
  }

  reply(res, code, body, type = 'application/json') {
    res.writeHead(code, { ...HEADERS, 'Content-Type': `${type}; charset=utf-8` });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  }

  readJson(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (d) => { data += d; if (data.length > MAX_BODY) { reject(new Error('Too large.')); req.destroy(); } });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON.')); } });
    });
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const file = STATIC[url.pathname];
    if (req.method === 'GET' && file) return this.reply(res, 200, fs.readFileSync(path.join(PAGE_DIR, file[0]), 'utf8'), file[1]);
    if (!url.pathname.startsWith('/api/')) return this.reply(res, 404, { error: 'Not found.' });
    if (!this.authorized(req)) return this.reply(res, 401, { error: 'Open the link from Settings → Integrations again.' });
    try {
      if (req.method === 'GET' && url.pathname === '/api/state') return this.reply(res, 200, this.snapshot);
      if (req.method === 'POST' && url.pathname === '/api/task') {
        const { text } = await this.readJson(req);
        if (!String(text || '').trim()) return this.reply(res, 400, { error: 'Write a task.' });
        this.send('remote:action', { kind: 'task', text: String(text).slice(0, 8000) });
        return this.reply(res, 202, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/approve') {
        const { card, yes } = await this.readJson(req);
        if (!this.snapshot.approvals.some((a) => a.card === card)) return this.reply(res, 404, { error: 'That request is gone.' });
        this.send('remote:action', { kind: 'approve', card, yes: !!yes });
        return this.reply(res, 202, { ok: true });
      }
      this.reply(res, 404, { error: 'Not found.' });
    } catch (err) {
      this.reply(res, 400, { error: err.message });
    }
  }

  register(ipcMain) {
    ipcMain.on('remote:snapshot', (_e, snap) => { this.snapshot = snap || this.snapshot; });
    ipcMain.handle('remote:apply', wrap(() => this.apply()));
    ipcMain.handle('remote:status', () => this.status());
  }
}

module.exports = { RemoteServer };
