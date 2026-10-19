// Local bridge between agents: the MCP server (scripts/agentboard-mcp.js) running inside each
// CLI talks to AgentBoard over a token-protected local socket, so Claude can ask Codex
// something, read its answer or open another agent. Each tool is a file in ./tools: adding
// a tool means adding a file (the MCP server asks the bridge for the list).
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { IS_WIN } = require('../core/platform');
const { readableTail } = require('./terminalText');

const MAX_BUF = 120 * 1024;   // recent output kept per terminal
const RATE = { max: 12, perMs: 60_000 };
const BUSY_MS = 1500;

function loadTools(dir = path.join(__dirname, 'tools')) {
  const tools = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const t = require(path.join(dir, f));
    if (!t.name || typeof t.run !== 'function' || !t.inputSchema) throw new Error(`Bridge tool ${f} needs name, inputSchema and run().`);
    tools.set(t.name, t);
  }
  return tools;
}

const parentPid = (pid) => new Promise((resolve) => {
  if (IS_WIN) return resolve(null);
  execFile('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2000 }, (err, out) => resolve(err ? null : parseInt(String(out).trim(), 10) || null));
});

class AgentBridge {
  // config: ConfigStore; ptys: card id → IPty; notify(event); requestNewCard(opts) → id;
  // askWindow(kind, payload) → answer from the interface (tasks live there).
  constructor({ dataDir, config, ptys, notify, requestNewCard, askWindow, tools = loadTools() }) {
    Object.assign(this, { dataDir, config, ptys, notify, requestNewCard, askWindow, tools });
    this.out = new Map();      // card id → recent output
    this.lastData = new Map(); // card id → time of its last output
    this.sent = new Map();     // caller → recent action times (rate limit)
    this.token = crypto.randomBytes(24).toString('hex');
    this.infoFile = path.join(dataDir, 'bridge.json');
    this.socketPath = IS_WIN ? `\\\\.\\pipe\\agentboard-${os.userInfo().username}-${process.pid}` : path.join(dataDir, 'bridge.sock');
    // macOS/Linux limit a socket path to ~104 bytes; os.tmpdir() is per-user on macOS.
    if (!IS_WIN && Buffer.byteLength(this.socketPath) > 100) this.socketPath = path.join(os.tmpdir(), `agentboard-${process.getuid()}.sock`);
    this.server = null;
  }

  // ---- terminal output ----
  record(id, data) {
    const next = (this.out.get(id) || '') + data;
    this.out.set(id, next.length > MAX_BUF ? next.slice(-MAX_BUF) : next);
    this.lastData.set(id, Date.now());
  }
  forget(id) { this.out.delete(id); this.lastData.delete(id); }
  isBusy(id) { return Date.now() - (this.lastData.get(id) || 0) < BUSY_MS; }
  busyIds() { return [...this.ptys.keys()].filter((id) => this.isBusy(id)); }
  readTail(id, lines) { return readableTail(this.out.get(id) || '', lines); }

  // Bracketed paste: the TUI receives one block instead of submitting line by line.
  paste(id, text) {
    const p = this.ptys.get(id);
    if (!p) return false;
    p.write('\x1b[200~' + String(text).replace(/\x1b/g, '') + '\x1b[201~');
    setTimeout(() => { try { p.write('\r'); } catch {} }, 250);
    return true;
  }

  // ---- helpers for the tools ----
  describe(cfg, c) {
    const alive = this.ptys.has(c.id);
    const proj = cfg.projects.find((p) => p.path === c.cwd);
    return {
      id: c.id, name: c.title, agent: cfg.agents[c.agent]?.label || c.agent,
      project: proj ? proj.name : (c.cwd ? path.basename(c.cwd) : '~'),
      status: !alive ? 'stopped' : this.isBusy(c.id) ? 'working' : 'waiting',
      group: cfg.cards.find((g) => g.type === 'group' && g.id === c.groupId)?.title || '',
      task: (cfg.tasks || []).find((t) => t.cardId === c.id && t.status !== 'done')?.text || '',
      accepts_messages: this.canReceive(cfg, c),
    };
  }

  // Never write into plain terminals: only into cards running an agent.
  canReceive(cfg, c) {
    return c.type === 'term' && !c.startCmd && !!cfg.agents[c.agent]?.command && c.bridge !== false && this.ptys.has(c.id);
  }

  resolveCard(cfg, ref) {
    const cards = cfg.cards.filter((c) => c.type === 'term');
    const q = String(ref || '').trim().toLowerCase();
    if (!q) throw new Error('Missing agent name.');
    const exact = cards.filter((c) => c.id === ref || c.title.toLowerCase() === q);
    const list = exact.length ? exact : cards.filter((c) => (cfg.agents[c.agent]?.label || c.agent).toLowerCase() === q || c.agent === q);
    if (list.length === 1) return list[0];
    if (!list.length) throw new Error(`There is no agent "${ref}" on the board. Use list_agents.`);
    throw new Error(`Several agents match "${ref}": ${list.map((c) => `${c.title} (id ${c.id})`).join(', ')}. Use the id.`);
  }

  rateOk(key) {
    const now = Date.now();
    const list = (this.sent.get(key) || []).filter((t) => now - t < RATE.perMs);
    if (list.length >= RATE.max) return false;
    list.push(now); this.sent.set(key, list);
    return true;
  }

  // Which card the caller runs in: the id it was started with, or its process tree.
  async callerCard(req) {
    if (req.card && this.ptys.has(req.card)) return req.card;
    const byPid = new Map([...this.ptys].map(([id, p]) => [p.pid, id]));
    let cur = Number(req.pid) || null;
    for (let i = 0; i < 10 && cur && cur > 1; i++) {
      if (byPid.has(cur)) return byPid.get(cur);
      cur = await parentPid(cur);
    }
    return null;
  }

  toolList() {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  // ---- socket ----
  async answer(req) {
    const a = Buffer.from(String(req.token || '')), b = Buffer.from(this.token);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, error: 'Invalid token.' };
    if (req.tool === '__list_tools') return { ok: true, tools: this.toolList() };
    const tool = this.tools.get(req.tool);
    if (!tool) return { ok: false, error: 'Unknown tool.' };
    try {
      return { ok: true, text: await tool.run(req.args || {}, { from: await this.callerCard(req) }, this) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  handle(sock) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(60_000, () => sock.destroy());
    sock.on('data', async (d) => {
      buf += d;
      if (buf.length > 64 * 1024) return sock.destroy();
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let req;
      const reply = (r) => { try { sock.end(JSON.stringify(r) + '\n'); } catch {} };
      try { req = JSON.parse(buf.slice(0, i)); } catch { return reply({ ok: false, error: 'Invalid request.' }); }
      reply(await this.answer(req));
    });
    sock.on('error', () => {});
  }

  start() {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    if (!IS_WIN) { try { fs.unlinkSync(this.socketPath); } catch {} }
    this.server = net.createServer((sock) => this.handle(sock));
    this.server.on('error', (err) => console.error('[AgentBoard] Could not open the agent bridge:', err.message));
    this.server.listen(this.socketPath, () => {
      if (!IS_WIN) { try { fs.chmodSync(this.socketPath, 0o600); } catch {} }
      fs.writeFileSync(this.infoFile, JSON.stringify({ socket: this.socketPath, token: this.token, pid: process.pid }), { mode: 0o600 });
    });
  }

  stop() {
    try { this.server?.close(); } catch {}
    try { if (JSON.parse(fs.readFileSync(this.infoFile, 'utf8')).token === this.token) fs.unlinkSync(this.infoFile); } catch {}
    if (!IS_WIN) { try { fs.unlinkSync(this.socketPath); } catch {} }
  }
}

module.exports = { AgentBridge, loadTools };
