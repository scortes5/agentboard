// Extra Claude accounts: each lives in its own config folder (CLAUDE_CONFIG_DIR) with its
// own login, history and skills, so several plans can be used side by side.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exists } = require('./probe');
const { wrap, slugify } = require('../core/platform');

class ClaudeAccounts {
  constructor({ config }) {
    this.config = config;
  }

  // Folders of the extra accounts (agents with their own CLAUDE_CONFIG_DIR).
  dirs() {
    return Object.values(this.config.load().agents || {}).map((a) => a.env?.CLAUDE_CONFIG_DIR).filter((d) => d && fs.existsSync(d));
  }

  create(name) {
    const slug = slugify(name, 30);
    if (!slug) throw new Error('Invalid name.');
    const dir = path.join(os.homedir(), `.claude-${slug}`);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return { dir, slug };
  }

  // Whether each folder already has a session (file existence only; tokens are never read).
  status(dirs = []) {
    return Object.fromEntries(dirs.map((d) => [d, exists(d, '.credentials.json') || exists(d, 'projects')]));
  }

  register(ipcMain) {
    ipcMain.handle('accounts:claudeDir', wrap((_e, name) => this.create(name)));
    ipcMain.handle('accounts:claudeStatus', (_e, dirs) => this.status(dirs || []));
  }
}

module.exports = { ClaudeAccounts };
