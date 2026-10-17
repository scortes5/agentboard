// Puente local entre agentes: el servidor MCP (scripts/agentboard-mcp.js) que corre
// dentro de cada CLI habla con AgentBoard por un socket local protegido con token.
// Así Claude puede pedirle algo a Codex, leer su respuesta o abrir otro agente.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const IS_WIN = process.platform === 'win32';
const MAX_BUF = 120 * 1024;   // salida reciente que guardamos por terminal
const RATE = { max: 12, perMs: 60_000 };

function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>78cDEHMNOZ]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// Texto legible de lo último que mostró una terminal (las TUIs redibujan mucho).
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
 *   requestNewCard({ agent, cwd, title }) -> Promise<id|null>
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
  // macOS/Linux limitan la ruta de un socket a ~104 bytes; os.tmpdir() es privado por usuario en macOS.
  if (!IS_WIN && Buffer.byteLength(socketPath) > 100) socketPath = path.join(os.tmpdir(), `agentboard-${process.getuid()}.sock`);
  let server = null;

  function record(id, data) {
    const prev = out.get(id) || '';
    const next = prev + data;
    out.set(id, next.length > MAX_BUF ? next.slice(-MAX_BUF) : next);
    lastData.set(id, Date.now());
  }
  function forget(id) { out.delete(id); lastData.delete(id); }

  // Pegado "bracketed": la TUI lo recibe como un bloque y no lo envía línea por línea.
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
      status: !alive ? 'terminado' : busy ? 'trabajando' : 'esperando',
      accepts_messages: canReceive(cfg, c),
    };
  }

  // Nunca escribimos en terminales "normales": solo en tarjetas que corren un agente.
  function canReceive(cfg, c) {
    return c.type === 'term' && !c.startCmd && !!cfg.agents[c.agent]?.command && c.bridge !== false && deps.ptys.has(c.id);
  }

  function resolveCard(cfg, ref) {
    const cards = cfg.cards.filter((c) => c.type === 'term');
    const q = String(ref || '').trim().toLowerCase();
    if (!q) throw new Error('Falta el nombre del agente.');
    const exact = cards.filter((c) => c.id === ref || c.title.toLowerCase() === q);
    const list = exact.length ? exact : cards.filter((c) => (cfg.agents[c.agent]?.label || c.agent).toLowerCase() === q || c.agent === q);
    if (list.length === 1) return list[0];
    if (!list.length) throw new Error(`No hay un agente "${ref}" en el tablero. Usa list_agents.`);
    throw new Error(`Hay varios agentes que coinciden con "${ref}": ${list.map((c) => `${c.title} (id ${c.id})`).join(', ')}. Usa el id.`);
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
      return agents.length ? JSON.stringify(agents, null, 2) : 'No hay agentes abiertos en el tablero.';
    },

    async send_to_agent(args, ctx) {
      const cfg = deps.loadConfig();
      const target = resolveCard(cfg, args.agent);
      const message = String(args.message || '').trim();
      if (!message) throw new Error('El mensaje está vacío.');
      if (message.length > 20000) throw new Error('Mensaje demasiado largo (máx. 20.000 caracteres).');
      if (target.id === ctx.from) throw new Error('No puedes enviarte mensajes a ti mismo.');
      if (!canReceive(cfg, target)) throw new Error(`"${target.title}" no acepta mensajes (es una terminal, está cerrado o el usuario lo desactivó).`);
      if (!rateOk(ctx.from || 'desconocido')) throw new Error('Demasiados mensajes seguidos; espera un minuto.');
      const from = cfg.cards.find((c) => c.id === ctx.from);
      const header = `[Mensaje de ${from ? from.title : 'otro agente'} vía AgentBoard]\n`;
      paste(target.id, header + message);
      deps.notify({ kind: 'send', from: ctx.from, to: target.id });
      return `Enviado a "${target.title}". Lee su respuesta con read_agent_output en un rato (si está "trabajando", espera a que pase a "esperando").`;
    },

    async read_agent_output(args, ctx) {
      const cfg = deps.loadConfig();
      const target = resolveCard(cfg, args.agent);
      const lines = Math.min(Math.max(parseInt(args.lines, 10) || 80, 1), 400);
      deps.notify({ kind: 'read', from: ctx.from, to: target.id });
      const d = describe(cfg, target);
      return `Estado: ${d.status}\n---\n${readableTail(out.get(target.id) || '', lines) || '(sin salida todavía)'}`;
    },

    async start_agent(args, ctx) {
      const cfg = deps.loadConfig();
      const want = String(args.agent_type || '').trim().toLowerCase();
      const key = Object.keys(cfg.agents).find((k) => k === want || (cfg.agents[k].label || '').toLowerCase() === want);
      if (!key || !cfg.agents[key].command) throw new Error(`Tipo de agente desconocido. Opciones: ${Object.entries(cfg.agents).filter(([, a]) => a.command).map(([k]) => k).join(', ')}`);
      let cwd = cfg.cards.find((c) => c.id === ctx.from)?.cwd || cfg.selectedProject || null;
      if (args.project) {
        const p = cfg.projects.find((x) => x.name.toLowerCase() === String(args.project).toLowerCase() || x.path === args.project);
        if (!p) throw new Error(`Proyecto desconocido. Opciones: ${cfg.projects.map((x) => x.name).join(', ')}`);
        cwd = p.path;
      }
      if (!rateOk(ctx.from || 'desconocido')) throw new Error('Demasiadas acciones seguidas; espera un minuto.');
      const id = await deps.requestNewCard({ agent: key, cwd, title: args.title ? String(args.title).slice(0, 60) : null });
      if (!id) throw new Error('No pude abrir el agente.');
      deps.notify({ kind: 'start', from: ctx.from, to: id });
      if (args.message) {
        // Esperamos a que el CLI arranque antes de escribirle.
        const t0 = Date.now();
        while (!deps.ptys.has(id) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 200));
        await new Promise((r) => setTimeout(r, 4000));
        const from = cfg.cards.find((c) => c.id === ctx.from);
        paste(id, `[Tarea de ${from ? from.title : 'otro agente'} vía AgentBoard]\n${String(args.message).slice(0, 20000)}`);
      }
      return `Abrí un agente ${cfg.agents[key].label} (id ${id}).${args.message ? ' Le envié la tarea.' : ''} Usa read_agent_output con ese id para seguir su avance.`;
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
      try { req = JSON.parse(buf.slice(0, i)); } catch { return reply({ ok: false, error: 'Solicitud inválida.' }); }
      const a = Buffer.from(String(req.token || '')), b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return reply({ ok: false, error: 'Token inválido.' });
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
    server.on('error', (err) => console.error('[AgentBoard] No pude abrir el puente entre agentes:', err.message));
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

  return { start, stop, record, forget, paste, tools, readableTail };
}

module.exports = { createBridge, readableTail, stripAnsi };
