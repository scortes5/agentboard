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
    const out = await new Promise((resolve, reject) => execFile('gh', ['api', 'repos/{owner}/{repo}/issues?state=open&per_page=100'],
      { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout))));
    return GitHubIssues.parse(out);
  }

  // The project's recent pull requests, one per branch (an open one wins over closed ones),
  // with the result of their checks, for the Branches view.
  async pulls(cwd) {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Choose a project first.');
    if (!(await this.shellEnv.which('gh'))) throw new Error('Install the GitHub CLI (gh) and run "gh auth login" to see pull requests.');
    const list = (fields) => new Promise((resolve, reject) => execFile('gh', ['pr', 'list', '--state', 'all', '--limit', '60', '--json', fields],
      { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().split('\n').pop())) : resolve(stdout))));
    const fields = 'number,title,headRefName,state,isDraft,url,statusCheckRollup';
    // the issues a PR closes need a recent gh; older ones list the PRs without them
    const out = await list(`${fields},closingIssuesReferences`).catch(() => list(fields));
    return GitHubIssues.parsePulls(out);
  }

  // Check runs report a conclusion, commit statuses a state; anything unfinished is pending.
  static checksOf(rollup) {
    const res = { passed: 0, failed: 0, pending: 0 };
    for (const c of rollup || []) {
      const v = String(c.conclusion || c.state || '').toUpperCase();
      if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(v)) res.passed++;
      else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(v)) res.failed++;
      else res.pending++;
    }
    res.total = res.passed + res.failed + res.pending;
    res.state = !res.total ? 'none' : res.failed ? 'failing' : res.pending ? 'pending' : 'passing';
    return res;
  }

  static parsePulls(json) {
    const byBranch = {};
    for (const p of JSON.parse(json)) {
      const pr = {
        number: p.number, title: String(p.title || ''), branch: p.headRefName, url: p.url,
        state: p.isDraft && p.state === 'OPEN' ? 'draft' : String(p.state || '').toLowerCase(), checks: GitHubIssues.checksOf(p.statusCheckRollup),
        closes: (p.closingIssuesReferences || []).map((i) => i.number).filter(Number.isInteger),
      };
      const cur = byBranch[pr.branch];
      // gh lists the newest first: keep that one unless an older one is still open
      if (!cur || (cur.state !== 'open' && cur.state !== 'draft' && (pr.state === 'open' || pr.state === 'draft'))) byBranch[pr.branch] = pr;
    }
    return byBranch;
  }

  static parse(json) {
    return JSON.parse(json).filter((i) => !i.pull_request).map((i) => ({
      number: i.number, title: i.title, url: i.html_url, body: String(i.body || '').slice(0, 4000),
      labels: (i.labels || []).map((l) => l.name),
      // label colors come from GitHub as 6 hex digits; anything else is dropped
      labelColors: Object.fromEntries((i.labels || []).filter((l) => /^[0-9a-f]{6}$/i.test(l.color || '')).map((l) => [l.name, l.color])),
      author: i.user?.login || '', trusted: TRUSTED.has(i.author_association),
      comments: i.comments || 0, createdAt: Date.parse(i.created_at) || 0, updatedAt: Date.parse(i.updated_at) || 0,
      assignees: (i.assignees || []).map((a) => a.login), milestone: i.milestone?.title || '',
    }));
  }

  register(ipcMain) {
    ipcMain.handle('github:issues', wrap((_e, cwd) => this.list(cwd)));
    ipcMain.handle('github:pulls', wrap((_e, cwd) => this.pulls(cwd)));
  }
}

module.exports = { GitHubIssues };
