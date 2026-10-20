#!/usr/bin/env node
// AgentBoard MCP server (stdio). Claude Code, Codex and Gemini CLI register it so they
// can see the other agents on the board, message them and read their answers.
// It only talks to the AgentBoard app running on this same computer.
'use strict';
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const VERSION = '1.10.0';

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

// The tools live in AgentBoard (src/main/bridge/tools, one file each): ask the app for them,
// so a new tool needs no change here. Without AgentBoard running there are none to offer.
async function listTools() {
  const r = await callBridge('__list_tools', {});
  return r.ok && Array.isArray(r.tools) ? r.tools : [];
}

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
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: await listTools() } });
    if (method === 'tools/call') {
      const name = String(params?.name || '');
      if (!name || name.startsWith('__')) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${name}` } });
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
