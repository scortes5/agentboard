// Open/closed checks: the app grows by adding files, not by editing the code that uses them.
// Each test adds an extension the way a contributor would (a new file in a folder) and shows
// the existing classes pick it up unchanged.
'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadProviders, defaultAgents, validateProvider } = require('../src/main/agents/registry');
const { loadTools } = require('../src/main/bridge/AgentBridge');
const { installerFor, newer } = require('../src/main/updates/versions');

const tmpDir = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-ocp-'));
  for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), code);
  return dir;
};

test('a new CLI is one provider file: the catalog and the default board pick it up', () => {
  const real = loadProviders();
  const dir = tmpDir(Object.fromEntries(real.map((p) => [`${p.key}.js`, `module.exports = ${JSON.stringify({ ...p, isSignedIn: undefined, mcp: undefined })};`])));
  fs.writeFileSync(path.join(dir, 'newcli.js'), `module.exports = {
    key: 'newcli', label: 'New CLI', command: 'newcli', color: '#123456', plan: 'Free', install: 'npm i -g newcli',
    agent: { label: 'New', resumeArgs: '--resume' },
  };`);
  const providers = loadProviders(dir);
  assert.ok(providers.some((p) => p.key === 'newcli'), 'listed in the catalog');
  assert.equal(defaultAgents(providers).newcli.command, 'newcli', 'offered on a new board');
});

test('every bundled provider meets the provider contract', () => {
  for (const p of loadProviders()) assert.doesNotThrow(() => validateProvider(p, `${p.key}.js`));
  assert.throws(() => validateProvider({ key: 'x' }, 'x.js'), /missing label, command, color, plan, install/);
});

test('a new bridge tool is one file: the bridge serves it to the MCP server', async () => {
  const real = path.join(__dirname, '..', 'src', 'main', 'bridge', 'tools');
  const dir = tmpDir(Object.fromEntries(fs.readdirSync(real).map((f) => [f, `module.exports = require(${JSON.stringify(path.join(real, f))});`])));
  fs.writeFileSync(path.join(dir, 'ping.js'), `module.exports = {
    name: 'ping', description: 'Answers pong.', inputSchema: { type: 'object', properties: {} },
    async run() { return 'pong'; },
  };`);
  const tools = loadTools(dir);
  assert.ok(tools.has('ping') && tools.has('list_agents'));
  assert.equal(await tools.get('ping').run({}, {}, null), 'pong');
});

test('update downloads pick the right installer for each platform', () => {
  const assets = ['AgentBoard-2.0.0-arm64.dmg', 'AgentBoard-2.0.0.dmg', 'AgentBoard-2.0.0.AppImage', 'AgentBoard-Setup-2.0.0.exe']
    .map((name) => ({ name, browser_download_url: `https://x/${name}` }));
  assert.equal(installerFor(assets, 'darwin', 'arm64'), 'https://x/AgentBoard-2.0.0-arm64.dmg');
  assert.equal(installerFor(assets, 'darwin', 'x64'), 'https://x/AgentBoard-2.0.0.dmg');
  assert.equal(installerFor(assets, 'linux', 'x64'), 'https://x/AgentBoard-2.0.0.AppImage');
  assert.ok(newer('v2.0.0', '1.9.9') && !newer('1.0.0', '1.0.0'));
});
