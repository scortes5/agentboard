// Remote control from a phone on the same network: a small web page that shows the tasks and
// the permission requests, approves or rejects them, and adds tasks. Off by default; served
// over HTTPS; every request needs the random token from the link in Settings → Integrations;
// it turns itself off after the hours set there; a new device and repeated wrong tokens are
// recorded in the audit log, and requests marked dangerous can only be approved at the computer.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { wrap } = require('../core/platform');
const { TlsIdentity } = require('./TlsIdentity');
const { FailureLimiter } = require('../security/FailureLimiter');

const PAGE_DIR = path.join(__dirname, 'page');
const STATIC = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=31536000',
};
const HOUR = 3600_000;
const MAX_BODY = 16 * 1024;

class RemoteServer {
  // send(channel, payload): forwards what the phone asks to the window, which owns the tasks.
  // tls: the HTTPS certificate; audit: the security log.
  constructor({ config, send, audit, tls, limiter = new FailureLimiter() }) {
    Object.assign(this, { config, send, audit, tls, limiter });
    this.server = null;
    this.timer = null;
    this.expiresAt = null;
    this.devices = new Set(); // address + browser already seen in this session
    this.snapshot = { tasks: [], approvals: [], counts: {} };
  }

  // hours: how long it stays on after being turned on (0 = until you turn it off).
  settings() { return { enabled: false, port: 7777, token: '', hours: 8, ...(this.config.load().remote || {}) }; }

  // Addresses the phone can reach on this computer's networks.
  urls() {
    const { port, token } = this.settings();
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    return ips.map((ip) => `https://${ip}:${port}/#t=${token}`);
  }

  status() {
    const running = !!this.server?.listening;
    return { ...this.settings(), token: undefined, running, urls: running ? this.urls() : [], expiresAt: running ? this.expiresAt : null, fingerprint: running ? this.fingerprint : null };
  }

  // Start, restart or stop the server to match Settings.
  async apply() {
    await this.stop();
    const s = this.settings();
    if (!s.enabled) return this.status();
    if (s.token.length < 32) throw new Error('Create a link first (Settings → Integrations).');
    const { key, cert, fingerprint } = await this.tls.get();
    this.fingerprint = fingerprint;
    await new Promise((resolve, reject) => {
      this.server = https.createServer({ key, cert }, (req, res) => this.handle(req, res));
      this.server.once('error', reject);
      this.server.listen(s.port, '0.0.0.0', resolve);
    });
    this.devices.clear();
    if (s.hours > 0) {
      this.expiresAt = Date.now() + s.hours * HOUR;
      this.timer = setTimeout(() => this.expire(), s.hours * HOUR);
    }
    this.audit?.add('remote-on', { hours: s.hours });
    return this.status();
  }

  // Turned off on its own after the hours set: the window saves it as off.
  async expire() {
    await this.stop();
    this.audit?.add('remote-off', { reason: 'expired' });
    this.send('remote:expired');
  }

  // App lifecycle (see App.start): a port already in use only disables the remote.
  onReady() { this.apply().catch((err) => console.error('Remote control:', err.message)); }
  onQuit() { this.stop(); }

  stop() {
    clearTimeout(this.timer);
    this.expiresAt = null;
    return new Promise((resolve) => { if (!this.server) return resolve(); this.server.close(() => resolve()); this.server.closeAllConnections?.(); this.server = null; });
  }

  // The first request from a phone tells the window (and the log) a device is connected.
  seen(req) {
    const addr = req.socket.remoteAddress;
    const id = `${addr} ${req.headers['user-agent'] || ''}`;
    if (this.devices.has(id)) return;
    this.devices.add(id);
    const device = { address: addr, browser: String(req.headers['user-agent'] || '').slice(0, 160) };
    this.audit?.add('remote-device', device);
    this.send('remote:device', device);
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
    const addr = req.socket.remoteAddress;
    if (this.limiter.blocked(addr)) return this.reply(res, 429, { error: 'Too many wrong attempts. Try again in a few minutes.' });
    if (!this.authorized(req)) {
      if (this.limiter.fail(addr)) this.audit?.add('remote-blocked', { address: addr });
      return this.reply(res, 401, { error: 'Open the link from Settings → Integrations again.' });
    }
    this.seen(req);
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
        const ask = this.snapshot.approvals.find((a) => a.card === card);
        if (!ask) return this.reply(res, 404, { error: 'That request is gone.' });
        if (yes && ask.danger) {
          this.audit?.add('remote-refused', { card, question: ask.question });
          return this.reply(res, 403, { error: 'This one looks dangerous: approve it at the computer.' });
        }
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
