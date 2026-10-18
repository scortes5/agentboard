// A project's open GitHub issues, read with the GitHub CLI (gh) already signed in on this
// computer, so they can become tasks. Nothing is stored; gh does the authentication.
'use strict';
const fs = require('fs');
const { execFile } = require('child_process');
const { wrap } = require('../core/platform');

class GitHubIssues {
  constructor({ shellEnv }) {
    this.shellEnv = shellEnv;
  }

  async list(cwd) {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Choose a project first.');
    if (!(await this.shellEnv.which('gh'))) throw new Error('Install the GitHub CLI (gh) and run "gh auth login" to import issues.');
    const out = await new Promise((resolve, reject) => execFile('gh', ['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,body,url,labels'],
      { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout))));
    return JSON.parse(out).map((i) => ({
      number: i.number, title: i.title, url: i.url, body: String(i.body || '').slice(0, 4000), labels: (i.labels || []).map((l) => l.name),
    }));
  }

  register(ipcMain) {
    ipcMain.handle('github:issues', wrap((_e, cwd) => this.list(cwd)));
  }
}

module.exports = { GitHubIssues };
