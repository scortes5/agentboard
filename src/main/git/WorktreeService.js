// A task's own worktree and branch (<repo>/.agentboard/worktrees/<name>, agentboard/<name>), or the one a #group shares:
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
    this.groupLocks = new Map();
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

  // The worktree and branch a #group shares (agentboard/group-<name>): created the first time,
  // reused by the group's next tasks, and checked out again if only the branch is left.
  // Serialized per group so tasks starting together do not race to create it.
  forGroup(cwd, group) {
    const key = `${cwd}\0${group}`;
    const run = (this.groupLocks.get(key) || Promise.resolve()).catch(() => {}).then(() => this.openGroup(cwd, group));
    this.groupLocks.set(key, run);
    return run;
  }

  async openGroup(cwd, group) {
    await this.git.top(cwd); // throws when the project is not a git repository
    const top = await this.git.worktreeTop(cwd);
    const name = `group-${slugify(group, 40) || 'group'}`;
    const dir = path.join(top, '.agentboard', 'worktrees', name);
    const branch = `agentboard/${name}`;
    const mergeBase = () => this.git.text(top, ['merge-base', 'HEAD', branch]);
    if (fs.existsSync(dir)) {
      const cur = await this.git.text(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
      if (cur !== branch) throw new Error(`${dir} is checked out on ${cur || 'another branch'}, not ${branch}.`);
      return { dir, branch, base: await mergeBase() };
    }
    const hasBranch = (await this.git.run(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok;
    const base = hasBranch ? '' : await this.git.text(top, ['rev-parse', 'HEAD']);
    const r = await this.git.run(top, hasBranch ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir]);
    if (!r.ok) throw new Error(r.err.trim() || 'git worktree failed.');
    await this.excludeFromRepo(top);
    return { dir, branch, base: base || await mergeBase() };
  }

  // Commit what a finished task left in its group's worktree.
  async commitWork(dir, message) {
    if (!(await this.git.text(dir, ['status', '--porcelain']))) return { committed: false };
    await this.git.commitAll(dir, message);
    return { committed: true, sha: await this.git.text(dir, ['rev-parse', '--short', 'HEAD']) };
  }

  // Push a group's branch to origin (never forced). Uncommitted changes stay out of it.
  async pushBranch(dir, branch) {
    const top = await this.git.worktreeTop(dir);
    if (!(await this.git.text(top, ['remote'])).split('\n').includes('origin')) throw new Error('The repository has no "origin" remote.');
    const push = await this.git.run(top, ['push', '-u', 'origin', branch]);
    if (!push.ok) throw new Error('Could not push the branch: ' + push.err.trim().split('\n').slice(-2).join(' '));
    return { remote: 'origin', pending: !!(await this.git.text(dir, ['status', '--porcelain'])) };
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
    ipcMain.handle('git:worktreeMerge', wrap((_e, dir, branch, message) => this.merge(dir, branch, message)));
    ipcMain.handle('git:worktreeDiscard', wrap((_e, dir, branch) => this.discard(dir, branch)));
    ipcMain.handle('git:groupWorktree', wrap((_e, cwd, group) => this.forGroup(cwd, group)));
    ipcMain.handle('git:groupCommit', wrap((_e, dir, message) => this.commitWork(dir, message)));
    ipcMain.handle('git:groupPush', wrap((_e, dir, branch) => this.pushBranch(dir, branch)));
    ipcMain.handle('git:fullDiff', wrap((_e, opts) => this.fullDiff(opts)));
    ipcMain.handle('git:pullRequest', wrap((_e, opts) => this.pullRequest(opts)));
  }
}

module.exports = { WorktreeService };
