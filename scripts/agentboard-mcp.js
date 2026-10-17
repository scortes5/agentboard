#!/usr/bin/env node
// Servidor MCP (stdio) de AgentBoard. Lo registran Claude Code, Codex y Gemini CLI
// para poder ver a los otros agentes del tablero, escribirles y leer sus respuestas.
// Solo habla con la app AgentBoard abierta en este mismo computador.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const VERSION = '0.2.0';

function dataDir() {
  if (process.env.AGENTBOARD_DATA) return process.env.AGENTBOARD_DATA;
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'AgentBoard');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgentBoard');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'AgentBoard');
}

function callBridge(tool, args) {
  return new Promise((resolve) => {
    let info;
    try { info = JSON.parse(fs.readFileSync(path.join(dataDir(), 'bridge.json'), 'utf8')); } catch {
      return resolve({ ok: false, error: 'AgentBoard no está abierto en este computador.' });
    }
    const sock = net.connect(info.socket);
    let buf = '';
    let finished = false;
    const done = (r) => { if (finished) return; finished = true; sock.destroy(); resolve(r); };
    sock.setEncoding('utf8');
    sock.setTimeout(30_000, () => done({ ok: false, error: 'AgentBoard no respondió.' }));
    sock.on('connect', () => sock.write(JSON.stringify({ token: info.token, tool, args, pid: process.ppid, card: process.env.AGENTBOARD_CARD || null }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try { done(JSON.parse(buf.slice(0, i))); } catch { done({ ok: false, error: 'Respuesta inválida de AgentBoard.' }); }
    });
    sock.on('error', () => done({ ok: false, error: 'AgentBoard no está abierto en este computador.' }));
    sock.on('end', () => done({ ok: false, error: 'AgentBoard cerró la conexión.' }));
  });
}

const TOOLS = [
  {
    name: 'list_agents',
    description: 'Lista los agentes abiertos en el tablero de AgentBoard del usuario (Claude Code, Codex, Gemini, modelos locales…), con su proyecto, estado (trabajando/esperando/terminado) y si aceptan mensajes. "you": true marca al agente que llama.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_to_agent',
    description: 'Envía un mensaje o tarea a otro agente del tablero; le llega como si el usuario lo escribiera en su terminal. Úsalo para delegar o pedir una segunda opinión. Luego usa read_agent_output para leer su respuesta.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Nombre de la tarjeta, tipo de agente (ej. "codex") o id, según list_agents.' },
        message: { type: 'string', description: 'Texto completo de la tarea o pregunta, con el contexto necesario.' },
      },
      required: ['agent', 'message'],
    },
  },
  {
    name: 'read_agent_output',
    description: 'Lee las últimas líneas que mostró la terminal de otro agente del tablero, junto con su estado.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Nombre, tipo o id del agente.' },
        lines: { type: 'number', description: 'Cuántas líneas leer (1–400, por defecto 80).' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'start_agent',
    description: 'Abre un agente nuevo en el tablero (ej. "codex", "claude", "gemini") y opcionalmente le envía una tarea inicial. Por defecto se abre en el mismo proyecto que el agente que llama.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_type: { type: 'string', description: 'Tipo de agente: claude, codex, gemini u otro configurado en AgentBoard.' },
        project: { type: 'string', description: 'Nombre del proyecto en AgentBoard (opcional).' },
        title: { type: 'string', description: 'Nombre para la tarjeta (opcional).' },
        message: { type: 'string', description: 'Tarea inicial (opcional).' },
      },
      required: ['agent_type'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Lista las tareas (ToDo) del usuario en AgentBoard: texto, estado (pendiente/en_curso/revisar/hecho/bloqueado), agente asignado y proyecto.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filtrar por estado (opcional).' } } },
  },
  {
    name: 'add_task',
    description: 'Agrega una tarea a la cola del usuario. AgentBoard la ejecuta en una sesión nueva con la suscripción indicada (o la menos ocupada con "auto"), en paralelo con otras. Úsalo para repartir trabajo independiente entre Claude, Codex y Gemini.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Instrucción autocontenida: qué hacer, en qué archivos y cómo saber que está listo.' },
        agent: { type: 'string', description: '"auto" (por defecto), "claude", "codex", "gemini" u otro configurado.' },
        project: { type: 'string', description: 'Nombre del proyecto (opcional; por defecto el del agente que llama).' },
        group: { type: 'string', description: 'Grupo/sección del tablero donde ubicar al agente (opcional).' },
        light: { type: 'boolean', description: 'true para tareas simples: usa el modelo barato de esa suscripción.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'complete_task',
    description: 'Marca como terminada la tarea de AgentBoard asignada a ti, con un resumen de una línea. Llámalo al terminar una tarea que te llegó desde la lista de AgentBoard.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Qué hiciste, en una línea.' },
        blocked: { type: 'boolean', description: 'true si no pudiste terminar y necesitas al usuario.' },
        task_id: { type: 'string', description: 'Id de la tarea (opcional; por defecto la tuya).' },
      },
      required: ['summary'],
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function onMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notificación
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentboard', version: VERSION },
        instructions: 'Conecta con los otros agentes del tablero AgentBoard del usuario. Usa list_agents antes de escribirle a otro agente.',
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Herramienta desconocida: ${name}` } });
      const r = await callBridge(name, params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.ok ? r.text : r.error }], isError: !r.ok } });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  } catch (err) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
  }
}

let buf = '';
let inFlight = 0;
let ended = false;
const maybeExit = () => { if (ended && inFlight === 0) process.exit(0); };
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    inFlight++;
    onMessage(msg).finally(() => { inFlight--; maybeExit(); });
  }
});
process.stdin.on('end', () => { ended = true; maybeExit(); });
