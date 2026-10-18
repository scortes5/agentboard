// The agent CLIs on this computer: which are installed and signed in, local models,
// extra Claude accounts, and whether each CLI has the AgentBoard tools (MCP) registered.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const skills = require('./skills');
const { IS_MAC, wrap, slugify } = require('./platform');
const { CATALOG, loadConfig } = require('./config');
const { which } = require('./shell-env');

// Each CLI stores its own session on this computer. AgentBoard only checks
// that it exists; it never reads, copies or sends the tokens.
const exists = (...p) => { try { return fs.existsSync(path.join(...p)); } catch { return false; } };

function macKeychainHas(service) {
  return new Promise((resolve) => {
    if (!IS_MAC) return resolve(false);
    // Without -w/-g: does not return the secret, only whether the entry exists.
    execFile('security', ['find-generic-password', '-s', service], { timeout: 4000 }, (err) => resolve(!err));
  });
}

const PROVIDERS = {
  claude: {
    login: 'claude',
    where: IS_MAC ? 'macOS Keychain' : '~/.claude',
    async detect() {
      if (await macKeychainHas('Claude Code-credentials')) return true;
      return exists(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json');
    },
  },
  codex: {
    login: 'codex login',
    where: '~/.codex',
    async detect() { return exists(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'auth.json'); },
  },
  gemini: {
    login: 'gemini',
    where: '~/.gemini',
    async detect() { return exists(os.homedir(), '.gemini', 'oauth_creds.json'); },
  },
};

// Only queries servers on this machine (127.0.0.1); nothing leaves the computer.
function localJson(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 1500 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const MCP_SCRIPT = path.join(__dirname, '..', 'scripts', 'agentboard-mcp.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function mcpCommands() {
  const script = JSON.stringify(MCP_SCRIPT);
  return {
    claude: { add: `claude mcp add --scope user agentboard -- node ${script}`, remove: 'claude mcp remove --scope user agentboard' },
    codex: { add: `codex mcp add agentboard -- node ${script}`, remove: 'codex mcp remove agentboard' },
    gemini: { add: `gemini mcp add --scope user agentboard node ${script}`, remove: 'gemini mcp remove --scope user agentboard' },
  };
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

// Only checks whether the "agentboard" entry exists; reads nothing else from those files.
function mcpConnected() {
  const toml = (() => { try { return fs.readFileSync(path.join(skills.codexDir(), 'config.toml'), 'utf8'); } catch { return ''; } })();
  return {
    claude: !!readJson(path.join(os.homedir(), '.claude.json'))?.mcpServers?.agentboard,
    codex: /^\[mcp_servers\.("?)agentboard\1\]/m.test(toml),
    gemini: !!readJson(path.join(skills.geminiDir(), 'settings.json'))?.mcpServers?.agentboard,
  };
}

// Folders of the extra Claude accounts (agents with their own CLAUDE_CONFIG_DIR)
const claudeAccountDirs = () => Object.values(loadConfig().agents || {}).map((a) => a.env?.CLAUDE_CONFIG_DIR).filter((d) => d && fs.existsSync(d));

function register(ipcMain) {
  // Which configured agents' commands exist on this computer.
  ipcMain.handle('agents:check', async () => {
    const cfg = loadConfig();
    const result = {};
    await Promise.all(Object.entries(cfg.agents).map(async ([key, a]) => {
      result[key] = await which(a.command, cfg);
    }));
    return result;
  });

  // Catalog + whether each CLI is installed and, where we can tell, whether it is signed in.
  ipcMain.handle('catalog:status', async () => {
    const cfg = loadConfig();
    return Promise.all(CATALOG.map(async (item) => {
      const p = PROVIDERS[item.key];
      const [installed, loggedIn] = await Promise.all([which(item.command, cfg), p ? p.detect() : null]);
      return { ...item, installed, loggedIn, login: p?.login || item.command, where: p?.where || null };
    }));
  });

  // Ollama and LM Studio running on this machine, with their models.
  ipcMain.handle('local:models', async () => {
    const cfg = loadConfig();
    const [tags, lms, ollamaInstalled] = await Promise.all([
      localJson(11434, '/api/tags'),
      localJson(1234, '/v1/models'),
      which('ollama', cfg),
    ]);
    return {
      ollama: { installed: ollamaInstalled, running: !!tags, models: (tags?.models || []).map((m) => m.name).filter(Boolean) },
      lmstudio: { running: !!lms, models: (lms?.data || []).map((m) => m.id).filter(Boolean) },
    };
  });

  // Each account lives in its own config folder (CLAUDE_CONFIG_DIR) with its
  // own login, history and skills, so a personal and a work subscription (or two
  // plans) can be used side by side and the queue spreads tasks across them.
  ipcMain.handle('accounts:claudeDir', wrap((_e, name) => {
    const slug = slugify(name, 30);
    if (!slug) throw new Error('Invalid name.');
    const dir = path.join(os.homedir(), `.claude-${slug}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { dir, slug };
  }));
  // Does that folder already have a session? (file existence only; tokens are never read)
  ipcMain.handle('accounts:claudeStatus', (_e, dirs) => Object.fromEntries((dirs || []).map((d) => [d,
    exists(d, '.credentials.json') || exists(d, 'projects')])));

  ipcMain.handle('bridge:status', () => ({ connected: mcpConnected(), commands: mcpCommands(), script: MCP_SCRIPT }));
}

module.exports = { register, mcpConnected, claudeAccountDirs, MCP_SCRIPT };
