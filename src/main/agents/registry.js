// The agent CLIs AgentBoard knows, one file each in ./providers. Adding a CLI means adding
// a file there; nothing else changes (open for extension, closed for modification).
'use strict';
const fs = require('fs');
const path = require('path');

const REQUIRED = ['key', 'label', 'command', 'color', 'plan', 'install'];

// Throws when a provider file is missing what the rest of the app relies on.
function validateProvider(p, file) {
  const missing = REQUIRED.filter((k) => typeof p[k] !== 'string' || !p[k]);
  if (missing.length) throw new Error(`${path.basename(file)}: missing ${missing.join(', ')}`);
  if (p.isSignedIn && typeof p.isSignedIn !== 'function') throw new Error(`${path.basename(file)}: isSignedIn must be a function`);
  if (p.mcp && (typeof p.mcp.add !== 'function' || typeof p.mcp.isRegistered !== 'function')) {
    throw new Error(`${path.basename(file)}: mcp needs add(script) and isRegistered(probe)`);
  }
  return p;
}

function loadProviders(dir = path.join(__dirname, 'providers')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .map((f) => validateProvider(require(path.join(dir, f)), f))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label));
}

// The agents a new board starts with: providers that declare `agent`, plus a plain terminal.
function defaultAgents(providers = loadProviders()) {
  const agents = {};
  for (const p of providers) if (p.agent) agents[p.key] = { label: p.agent.label || p.label, command: p.command, color: p.color, resumeArgs: '', ...p.agent };
  agents.shell = { label: 'Terminal', command: '', resumeArgs: '', color: '#a89d8f' };
  return agents;
}

module.exports = { loadProviders, defaultAgents, validateProvider };
