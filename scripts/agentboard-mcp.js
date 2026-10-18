#!/usr/bin/env node
// AgentBoard MCP server (stdio). Claude Code, Codex and Gemini CLI register it so they
// can see the other agents on the board, message them and read their answers.
// It only talks to the AgentBoard app running on this same computer.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const VERSION = '1.0.0';

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
      return resolve({ ok: false, error: 'AgentBoard is not running on this computer.' });
    }
    const sock = net.connect(info.socket);
    let buf = '';
    let finished = false;
    const done = (r) => { if (finished) return; finished = true; sock.destroy(); resolve(r); };
    sock.setEncoding('utf8');
    sock.setTimeout(30_000, () => done({ ok: false, error: 'AgentBoard did not respond.' }));
    sock.on('connect', () => sock.write(JSON.stringify({ token: info.token, tool, args, pid: process.ppid, card: process.env.AGENTBOARD_CARD || null }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      try { done(JSON.parse(buf.slice(0, i))); } catch { done({ ok: false, error: 'Invalid response from AgentBoard.' }); }
    });
    sock.on('error', () => done({ ok: false, error: 'AgentBoard is not running on this computer.' }));
    sock.on('end', () => done({ ok: false, error: 'AgentBoard closed the connection.' }));
  });
}

const TOOLS = [
  {
    name: 'list_agents',
    description: 'Lists the agents open on the user\'s AgentBoard (Claude Code, Codex, Gemini, local models…) with their project, group, current task, status (working/waiting/stopped) and whether they accept messages. "you": true marks the caller.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'send_to_agent',
    description: 'Sends a message or task to another agent on the board; it arrives as if the user typed it in that terminal. Use it to delegate or to ask for a second opinion, then read the answer with read_agent_output.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Card name, agent type (e.g. "codex") or id, as returned by list_agents.' },
        message: { type: 'string', description: 'Full text of the task or question, with the context it needs.' },
      },
      required: ['agent', 'message'],
    },
  },
  {
    name: 'read_agent_output',
    description: 'Reads the last lines shown by another agent\'s terminal, together with its status.',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name, type or id.' },
        lines: { type: 'number', description: 'How many lines to read (1–400, default 80).' },
      },
      required: ['agent'],
    },
  },
  {
    name: 'start_agent',
    description: 'Opens a new agent on the board (e.g. "codex", "claude", "gemini") and optionally sends it a first task. By default it opens in the caller\'s project. For simple subtasks pass light=true (cheaper model, saves tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_type: { type: 'string', description: 'Agent type: claude, codex, gemini or another one configured in AgentBoard.' },
        project: { type: 'string', description: 'AgentBoard project name (optional).' },
        title: { type: 'string', description: 'Card name (optional).' },
        message: { type: 'string', description: 'First task (optional).' },
        light: { type: 'boolean', description: 'Saving mode: opens the agent with its cheap model (e.g. Claude Haiku). Use it for simple subtasks.' },
      },
      required: ['agent_type'],
    },
  },
  {
    name: 'list_tasks',
    description: 'Lists the user\'s AgentBoard tasks: text, status (pending/running/review/done/blocked), assigned agent and project.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status (optional).' } } },
  },
  {
    name: 'add_task',
    description: 'Adds a task to the user\'s queue. AgentBoard runs it in a new session with the given subscription (or the least busy one with "auto"), in parallel with others. Use it to spread independent work across Claude, Codex and Gemini.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Self-contained instruction: what to do, in which files, and how to tell it is done.' },
        agent: { type: 'string', description: '"auto" (default), "claude", "codex", "gemini" or another configured agent.' },
        project: { type: 'string', description: 'Project name (optional; defaults to the caller\'s project).' },
        group: { type: 'string', description: 'Board group where the agent should appear (optional).' },
        light: { type: 'boolean', description: 'true for simple tasks: uses that subscription\'s cheaper model.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'complete_task',
    description: 'Marks the AgentBoard task assigned to you as finished, with a one-line summary. Call it when you finish a task that came from the AgentBoard list.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What you did, in one line.' },
        blocked: { type: 'boolean', description: 'true if you could not finish and need the user.' },
        task_id: { type: 'string', description: 'Task id (optional; defaults to yours).' },
      },
      required: ['summary'],
    },
  },
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

async function onMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification
  try {
    if (method === 'initialize') {
      return send({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentboard', version: VERSION },
        instructions: 'Connects to the other agents on the user\'s AgentBoard. Call list_agents before messaging another agent.',
      } });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
      const r = await callBridge(name, params?.arguments || {});
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.ok ? r.text : r.error }], isError: !r.ok } });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unsupported method: ${method}` } });
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
