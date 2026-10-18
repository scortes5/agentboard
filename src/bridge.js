// Local bridge between agents: the MCP server (scripts/agentboard-mcp.js) running
// inside each CLI talks to AgentBoard over a token-protected local socket.
// That lets Claude ask Codex something, read its answer or open another agent.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const MAX_BUF = 120 * 1024;   // recent output kept per terminal
const RATE = { max: 12, perMs: 60_000 };

function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>78cDEHMNOZ]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// Readable text of what a terminal showed last (TUIs redraw a lot).
function readableTail(raw, lines) {
  const out = [];
  for (const line of stripAnsi(raw).split('\n')) {
    const seg = line.split('\r').filter(Boolean).pop() || '';
    const t = seg.replace(/\s+$/, '');
    if (!t.trim()) continue;
    if (out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out.slice(-lines).join('\n');
}

function parentPid(pid) {
  return new Promise((resolve) => {
    if (IS_WIN) return resolve(null);
    execFile('ps', ['-o', 'ppid=', '-p', String(pid)], { timeout: 2000 }, (err, out) => resolve(err ? null : parseInt(String(out).trim(), 10) || null));
  });
}

/**
 * deps: {
 *   dataDir, ptys: Map<id, IPty>, loadConfig(), notify(event),
 *   requestNewCard({ agent, cwd, title, light, from }) -> Promise<id|null>
 *   askRenderer(kind, payload) -> Promise<any>   (tasks: the UI stores them)
 * }
 */
function createBridge(deps) {
  const out = new Map();       // id -> salida reciente
  const lastData = new Map();  // id -> timestamp
  const sent = new Map();      // remitente -> [timestamps]
  const token = crypto.randomBytes(24).toString('hex');
  const infoFile = path.join(deps.dataDir, 'bridge.json');
  let socketPath = IS_WIN
    ? `\\\\.\\pipe\\agentboard-${os.userInfo().username}-${process.pid}`
    : path.join(deps.dataDir, 'bridge.sock');
  // macOS/Linux limit a socket path to ~104 bytes; os.tmpdir() is per-user on macOS.
  if (!IS_WIN && Buffer.byteLength(socketPath) > 100) socketPath = path.join(os.tmpdir(), `agentboard-${process.getuid()}.sock`);
  let server = null;

  function record(id, data) {
    const prev = out.get(id) || '';
    const next = prev + data;
    out.set(id, next.length > MAX_BUF ? next.slice(-MAX_BUF) : next);
    lastData.set(id, Date.now());
  }
  function forget(id) { out.delete(id); lastData.delete(id); }
  const busyIds = () => [...deps.ptys.keys()].filter((id) => Date.now() - (lastData.get(id) || 0) < 1500);

  // Bracketed paste: the TUI receives one block instead of submitting line by line.
  function paste(id, text) {
    const p = deps.ptys.get(id);
    if (!p) return false;
    p.write('\x1b[200~' + String(text).replace(/\x1b/g, '') + '\x1b[201~');
    setTimeout(() => { try { p.write('\r'); } catch {} }, 250);
    return true;
  }

  function describe(cfg, c) {
    const agent = cfg.agents[c.agent] || {};
    const proj = cfg.projects.find((p) => p.path === c.cwd);
    const alive = deps.ptys.has(c.id);
    const busy = alive && Date.now() - (lastData.get(c.id) || 0) < 1500;
    return {
      id: c.id, name: c.title, agent: agent.label || c.agent,
      project: proj ? proj.name : (c.cwd ? path.basename(c.cwd) : '~'),
      status: !alive ? 'stopped' : busy ? 'working' : 'waiting',
      group: cfg.cards.find((g) => g.type === 'group' && g.id === c.groupId)?.title || '',
      task: (cfg.tasks || []).find((t) => t.cardId === c.id && t.status !== 'done')?.text || '',
      accepts_messages: canReceive(cfg, c),
    };
  }

  // Never write into plain terminals: only into cards running an agent.
  function canReceive(cfg, c) {
    return c.type === 'term' && !c.startCmd && !!cfg.agents[c.agent]?.command && c.bridge !== false && deps.ptys.has(c.id);
  }

  function resolveCard(cfg, ref) {
    const cards = cfg.cards.filter((c) => c.type === 'term');
    const q = String(ref || '').trim().toLowerCase();
    if (!q) throw new Error('Missing agent name.');
    const exact = cards.filter((c) => c.id === ref || c.title.toLowerCase() === q);
    const list = exact.length ? exact : cards.filter((c) => (cfg.agents[c.agent]?.label || c.agent).toLowerCase() === q || c.agent === q);
    if (list.length === 1) return list[0];
    if (!list.length) throw new Error(`There is no agent "${ref}" on the board. Use list_agents.`);
    throw new Error(`Several agents match "${ref}": ${list.map((c) => `${c.title} (id ${c.id})`).join(', ')}. Use the id.`);
  }

  async function callerCard(req) {
    if (req.card && deps.ptys.has(req.card)) return req.card;
    const byPid = new Map([...deps.ptys].map(([id, p]) => [p.pid, id]));
    let cur = Number(req.pid) || null;
    for (let i = 0; i < 10 && cur && cur > 1; i++) {
      if (byPid.has(cur)) return byPid.get(cur);
      cur = await parentPid(cur);
    }
    return null;
  }

  function rateOk(key) {
    const now = Date.now();
    const list = (sent.get(key) || []).filter((t) => now - t < RATE.perMs);
    if (list.length >= RATE.max) return false;
    list.push(now); sent.set(key, list);
    return true;
  }

  const tools = {
    async list_agents(_args, ctx) {
      const cfg = deps.loadConfig();
      const agents = cfg.cards.filter((c) => c.type === 'term').map((c) => ({ ...describe(cfg, c), you: c.id === ctx.from }));
      return agents.length ? JSON.stringify(agents, null, 2) : 'No agents are open on the board.';
    },

    async send_to_agent(args, ctx) {
      const cfg = deps.loadConfig();
      const target = resolveCard(cfg, args.agent);
      const message = String(args.message || '').trim();
      if (!message) throw new Error('The message is empty.');
      if (message.length > 20000) throw new Error('Message too long (max 20,000 characters).');
      if (target.id === ctx.from) throw new Error('You cannot send messages to yourself.');
      if (!canReceive(cfg, target)) throw new Error(`"${target.title}" does not accept messages (it is a terminal, it is closed, or the user disabled it).`);
      if (!rateOk(ctx.from || 'unknown')) throw new Error('Too many messages in a row; wait a minute.');
      const from = cfg.cards.find((c) => c.id === ctx.from);
      const header = `[Message from ${from ? from.title : 'another agent'} via AgentBoard]\n`;
      paste(target.id, header + message);
      deps.notify({ kind: 'send', from: ctx.from, to: target.id });
      return `Sent to "${target.title}". Read its answer with read_agent_output in a while (if it is "working", wait until it is "waiting").`;
    },

    async read_agent_output(args, ctx) {
      const cfg = deps.loadConfig();
      const target = resolveCard(cfg, args.agent);
      const lines = Math.min(Math.max(parseInt(args.lines, 10) || 80, 1), 400);
      deps.notify({ kind: 'read', from: ctx.from, to: target.id });
      const d = describe(cfg, target);
      return `Status: ${d.status}\n---\n${readableTail(out.get(target.id) || '', lines) || '(no output yet)'}`;
    },

    async start_agent(args, ctx) {
      const cfg = deps.loadConfig();
      const want = String(args.agent_type || '').trim().toLowerCase();
      const key = Object.keys(cfg.agents).find((k) => k === want || (cfg.agents[k].label || '').toLowerCase() === want);
      if (!key || !cfg.agents[key].command) throw new Error(`Unknown agent type. Options: ${Object.entries(cfg.agents).filter(([, a]) => a.command).map(([k]) => k).join(', ')}`);
      let cwd = cfg.cards.find((c) => c.id === ctx.from)?.cwd || cfg.selectedProject || null;
      if (args.project) {
        const p = cfg.projects.find((x) => x.name.toLowerCase() === String(args.project).toLowerCase() || x.path === args.project);
        if (!p) throw new Error(`Unknown project. Options: ${cfg.projects.map((x) => x.name).join(', ')}`);
        cwd = p.path;
      }
      if (!rateOk(ctx.from || 'unknown')) throw new Error('Too many actions in a row; wait a minute.');
      const id = await deps.requestNewCard({ agent: key, cwd, title: args.title ? String(args.title).slice(0, 60) : null, light: !!args.light, from: ctx.from || null });
      if (!id) throw new Error('Could not open the agent.');
      deps.notify({ kind: 'start', from: ctx.from, to: id });
      if (args.message) {
        // Wait for the CLI to start before typing into it.
        const t0 = Date.now();
        while (!deps.ptys.has(id) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 200));
        await new Promise((r) => setTimeout(r, 4000));
        const from = cfg.cards.find((c) => c.id === ctx.from);
        paste(id, `[Task from ${from ? from.title : 'another agent'} via AgentBoard]\n${String(args.message).slice(0, 20000)}`);
      }
      return `Opened a ${cfg.agents[key].label} agent${args.light ? ' in saving mode' : ''} (id ${id}).${args.message ? ' Sent it the task.' : ''} Use read_agent_output with that id to follow its progress.`;
    },

    // ---- The user's task list ----
    async list_tasks(args) {
      const cfg = deps.loadConfig();
      const want = String(args.status || '').toLowerCase();
      const tasks = (cfg.tasks || []).filter((t) => !want || t.status === want).map((t) => ({
        id: t.id, text: t.text.length > 300 ? t.text.slice(0, 300) + '…' : t.text, status: t.status,
        agent: t.agent, project: cfg.projects.find((p) => p.path === t.cwd)?.name || (t.cwd ? path.basename(t.cwd) : ''),
        group: t.group || '', card: t.cardId || null, summary: t.summary || '',
      }));
      return tasks.length ? JSON.stringify(tasks, null, 2) : 'No tasks.';
    },

    async add_task(args, ctx) {
      const text = String(args.text || '').trim();
      if (!text) throw new Error('The task is empty.');
      if (text.length > 8000) throw new Error('Task too long (max 8,000 characters).');
      if (!rateOk(ctx.from || 'unknown')) throw new Error('Too many actions in a row; wait a minute.');
      const r = await deps.askRenderer('task-add', {
        text, agent: args.agent ? String(args.agent) : 'auto', project: args.project ? String(args.project) : '',
        group: args.group ? String(args.group).slice(0, 40) : '', light: !!args.light, from: ctx.from,
      });
      if (!r || r.error) throw new Error(r?.error || 'AgentBoard did not respond.');
      return `Task added (id ${r.id}). It will run with ${r.agent} as soon as there is a free slot.`;
    },

    async complete_task(args, ctx) {
      const r = await deps.askRenderer('task-done', {
        id: args.task_id ? String(args.task_id) : null, card: ctx.from,
        summary: String(args.summary || '').slice(0, 500), blocked: !!args.blocked,
      });
      if (!r || r.error) throw new Error(r?.error || 'No task is assigned to this agent.');
      return `Task "${r.text.slice(0, 80)}" marked as ${r.status}.`;
    },
  };

  function handle(sock) {
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
      const a = Buffer.from(String(req.token || '')), b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply({ ok: false, error: 'Invalid token.' });
      const fn = tools[req.tool];
      if (!fn) return reply({ ok: false, error: 'Herramienta desconocida.' });
      try {
        const from = await callerCard(req);
        reply({ ok: true, text: await fn(req.args || {}, { from }) });
      } catch (err) {
        reply({ ok: false, error: err.message });
      }
    });
    sock.on('error', () => {});
  }

  function start() {
    fs.mkdirSync(deps.dataDir, { recursive: true, mode: 0o700 });
    if (!IS_WIN) { try { fs.unlinkSync(socketPath); } catch {} }
    server = net.createServer(handle);
    server.on('error', (err) => console.error('[AgentBoard] Could not open the agent bridge:', err.message));
    server.listen(socketPath, () => {
      if (!IS_WIN) { try { fs.chmodSync(socketPath, 0o600); } catch {} }
      fs.writeFileSync(infoFile, JSON.stringify({ socket: socketPath, token, pid: process.pid }), { mode: 0o600 });
    });
  }

  function stop() {
    try { server && server.close(); } catch {}
    try {
      const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
      if (info.token === token) fs.unlinkSync(infoFile);
    } catch {}
    if (!IS_WIN) { try { fs.unlinkSync(socketPath); } catch {} }
  }

  return { start, stop, record, forget, paste, tools, readableTail, busyIds };
}

module.exports = { createBridge, readableTail, stripAnsi };
