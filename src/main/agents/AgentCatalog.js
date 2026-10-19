// The agent CLIs on this computer: which are installed and signed in, and whether each one
// has the AgentBoard tools (MCP) registered. Every CLI is a provider file in ./providers.
'use strict';
const path = require('path');
const probe = require('./probe');
const { loadProviders } = require('./registry');

const MCP_SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'agentboard-mcp.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

class AgentCatalog {
  constructor({ config, shellEnv, providers = loadProviders() }) {
    Object.assign(this, { config, shellEnv, providers });
  }

  // Which configured agents' commands exist on this computer.
  async installedAgents() {
    const entries = Object.entries(this.config.load().agents);
    const found = await Promise.all(entries.map(([, a]) => this.shellEnv.which(a.command)));
    return Object.fromEntries(entries.map(([key], i) => [key, found[i]]));
  }

  // Every known CLI with whether it is installed and, where we can tell, signed in.
  status() {
    return Promise.all(this.providers.map(async (p) => {
      const [installed, loggedIn] = await Promise.all([this.shellEnv.which(p.command), p.isSignedIn ? p.isSignedIn(probe) : null]);
      const { key, label, command, color, plan, install, login, where } = p;
      return { key, label, command, color, plan, install, resumeArgs: p.agent?.resumeArgs || '', installed, loggedIn, login: login || command, where: where || null };
    }));
  }

  // Register/remove commands and whether each CLI already has the AgentBoard tools.
  mcpStatus() {
    const withMcp = this.providers.filter((p) => p.mcp);
    const script = JSON.stringify(MCP_SCRIPT);
    return {
      connected: Object.fromEntries(withMcp.map((p) => [p.key, !!p.mcp.isRegistered(probe)])),
      commands: Object.fromEntries(withMcp.map((p) => [p.key, { add: p.mcp.add(script), remove: p.mcp.remove }])),
      script: MCP_SCRIPT,
    };
  }

  register(ipcMain) {
    ipcMain.handle('agents:check', () => this.installedAgents());
    ipcMain.handle('catalog:status', () => this.status());
    ipcMain.handle('bridge:status', () => this.mcpStatus());
  }
}

module.exports = { AgentCatalog, MCP_SCRIPT };
