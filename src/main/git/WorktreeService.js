// A task's own worktree and branch (<repo>/.agentboard/worktrees/<name>, agentboard/<name>):
// creating it, what it holds, its full diff, and merging, discarding or opening a pull request.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { shell } = require('electron');
const { wrap, slugify } = require('../core/platform');

class WorktreeService {
  constructor({ runner, gitService, shellEnv }) {
    Object.assign(this, { git: runner, gitService, shellEnv });
  }

  async create(cwd, slug) {
    const top = await this.git.top(cwd);
    const safe = slugify(slug, 40) || 'task';
    let name = safe;
    for (let i = 2; fs.existsSync(path.join(top, '.agentboard', 'worktrees', name)); i++) name = `${safe}-${i}`;
    const dir = path.join(top, '.agentboard', 'worktrees', name);
    const branch = `agentboard/${name}`;
    const base = await this.git.text(top, ['rev-parse', 'HEAD']); // where the task's work starts
    const r = await this.git.run(top, ['worktree', 'add', '-b', branch, dir]);
    if (!r.ok) throw new Error(r.err.trim() || 'git worktree failed.');
    await this.excludeFromRepo(top);
    return { dir, branch, base };
  }

  // Keep worktrees from showing up as changes in the main repository.
  async excludeFromRepo(top) {
    try {
      const exclude = path.resolve(top, await this.git.text(top, ['rev-parse', '--git-common-dir']), 'info', 'exclude');
      const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
      if (/^\/?\.agentboard\/?$/m.test(cur)) return;
      fs.mkdirSync(path.dirname(exclude), { recursive: true });
      fs.appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}.agentboard/\n`);
    } catch {}
  }

  async info(dir, branch) {
    if (!dir || !fs.existsSync(dir)) throw new Error('The worktree no longer exists.');
    const top = await this.git.worktreeTop(dir);
    const base = await this.git.text(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const [dirty, ahead, stat, wip] = await Promise.all([
      this.git.run(dir, ['status', '--porcelain']),
      this.git.run(top, ['rev-list', '--count', `${base}..${branch}`]),
      this.git.run(top, ['diff', '--stat', `${base}...${branch}`]),
      this.git.text(dir, ['diff', '--stat', 'HEAD']),
    ]);
    const uncommitted = dirty.out.trim() ? `Uncommitted:\n${dirty.out.trimEnd()}${wip ? `\n\n${wip}` : ''}` : '';
    return {
      base, top, branch, uncommitted: dirty.out.split('\n').filter(Boolean).length, commits: parseInt(ahead.out, 10) || 0,
      stat: [stat.out.trim(), uncommitted].filter(Boolean).join('\n\n').split('\n').slice(-40).join('\n'),
    };
  }

  // The diff of a task: its worktree since its branch left the base, or its folder since its checkpoint.
  async fullDiff({ dir, branch, checkpoint }) {
    if (!branch) return this.gitService.diffSince(dir, checkpoint);
    const top = await this.git.worktreeTop(dir);
    const base = await this.git.text(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return this.gitService.diffSince(dir, await this.git.text(top, ['merge-base', base, branch]));
  }

  async merge(dir, branch, message) {
    const top = await this.git.worktreeTop(dir);
    if (await this.git.text(top, ['status', '--porcelain', '--untracked-files=no'])) {
      throw new Error('The main repo has uncommitted changes; commit or stash them before merging.');
    }
    await this.git.commitAll(dir, message || `AgentBoard: ${branch}`);
    const m = await this.git.run(top, ['merge', '--no-ff', '--no-edit', branch]);
    if (!m.ok) {
      await this.git.run(top, ['merge', '--abort']);
      throw new Error('There are conflicts; nothing was merged. Resolve them in the agent card. ' + m.err.trim().split('\n').slice(-2).join(' '));
    }
    await this.discard(dir, branch, { force: false });
    return { base: await this.git.text(top, ['rev-parse', '--abbrev-ref', 'HEAD']) };
  }

  async discard(dir, branch, { force = true } = {}) {
    const top = await this.git.worktreeTop(dir);
    await this.git.run(top, ['worktree', 'remove', '--force', dir]);
    await this.git.run(top, ['branch', force ? '-D' : '-d', branch]);
    return true;
  }

  // Push the branch and open a pull request: with the GitHub CLI when installed, otherwise
  // GitHub's "compare" page in the browser.
  async pullRequest({ dir, branch, title, body }) {
    const top = await this.git.worktreeTop(dir);
    await this.git.commitAll(dir, title || `AgentBoard: ${branch}`);
    const push = await this.git.run(top, ['push', '-u', 'origin', branch]);
    if (!push.ok) throw new Error('Could not push the branch: ' + push.err.trim().split('\n').slice(-2).join(' '));
    if (await this.shellEnv.which('gh')) {
      const out = await new Promise((resolve) => execFile('gh', ['pr', 'create', '--head', branch, '--title', String(title).slice(0, 200), '--body', String(body || '')],
        { cwd: top, timeout: 60_000 }, (_err, stdout) => resolve(String(stdout || ''))));
      const url = out.match(/https:\/\/\S+\/pull\/\d+/)?.[0];
      if (url) return { url, created: true };
    }
    const m = (await this.git.text(top, ['remote', 'get-url', 'origin'])).match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (!m) throw new Error('Pushed, but the remote is not on GitHub: open the pull request there.');
    const url = `https://github.com/${m[1]}/compare/${encodeURIComponent(branch)}?expand=1`;
    shell.openExternal(url);
    return { url, created: false };
  }

  register(ipcMain) {
    ipcMain.handle('git:worktree', wrap((_e, cwd, slug) => this.create(cwd, slug)));
    ipcMain.handle('git:worktreeInfo', wrap((_e, dir, branch) => this.info(dir, branch)));
    ipcMain.handle('git:worktreeMerge', wrap((_e, dir, branch, message) => this.merge(dir, branch, message)));
    ipcMain.handle('git:worktreeDiscard', wrap((_e, dir, branch) => this.discard(dir, branch)));
    ipcMain.handle('git:fullDiff', wrap((_e, opts) => this.fullDiff(opts)));
    ipcMain.handle('git:pullRequest', wrap((_e, opts) => this.pullRequest(opts)));
  }
}

module.exports = { WorktreeService };
