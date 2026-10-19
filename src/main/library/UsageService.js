// Usage read from the CLIs' local logs: the Usage and Savings panel, and tokens per running task.
'use strict';
const path = require('path');
const usage = require('./usage');
const skills = require('./skills');
const { wrap } = require('../core/platform');

class UsageService {
  constructor({ dataDir, claudeAccounts }) {
    Object.assign(this, { dataDir, claudeAccounts });
  }

  claudeDirs() { return [skills.claudeDir(), ...this.claudeAccounts.dirs()]; }

  register(ipcMain) {
    ipcMain.handle('usage:scan', wrap((_e, tasks) => usage.scanUsage({
      tasks, historyFile: path.join(this.dataDir, 'task-history.json'), claudeDirs: this.claudeDirs(), codexDir: skills.codexDir(),
    })));
    ipcMain.handle('usage:sessions', wrap((_e, ids) => usage.sessionTokens({ ids, claudeDirs: this.claudeDirs() })));
  }
}

module.exports = { UsageService };
