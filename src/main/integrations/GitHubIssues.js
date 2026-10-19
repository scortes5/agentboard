// A project's open GitHub issues, read with the GitHub CLI (gh) already signed in on this
// computer, so they can become tasks. Nothing is stored; gh does the authentication. Each issue
// says whether its author belongs to the project: anyone can open an issue on a public repo,
// so text from outsiders is untrusted (it could try to give the agent instructions).
'use strict';
const fs = require('fs');
const { execFile } = require('child_process');
const { wrap } = require('../core/platform');

const TRUSTED = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

class GitHubIssues {
  constructor({ shellEnv }) {
    this.shellEnv = shellEnv;
  }

  async list(cwd) {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Choose a project first.');
    if (!(await this.shellEnv.which('gh'))) throw new Error('Install the GitHub CLI (gh) and run "gh auth login" to import issues.');
    // the REST API says how each author is related to the repository (gh fills in {owner}/{repo})
    const out = await new Promise((resolve, reject) => execFile('gh', ['api', 'repos/{owner}/{repo}/issues?state=open&per_page=50'],
      { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout))));
    return GitHubIssues.parse(out);
  }

  static parse(json) {
    return JSON.parse(json).filter((i) => !i.pull_request).map((i) => ({
      number: i.number, title: i.title, url: i.html_url, body: String(i.body || '').slice(0, 4000), labels: (i.labels || []).map((l) => l.name),
      author: i.user?.login || '', trusted: TRUSTED.has(i.author_association),
    }));
  }

  register(ipcMain) {
    ipcMain.handle('github:issues', wrap((_e, cwd) => this.list(cwd)));
  }
}

module.exports = { GitHubIssues };
