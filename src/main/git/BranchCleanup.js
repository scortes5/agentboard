// Cleaning up a project's finished work: local branches already merged into the main branch
// (or whose pull request was merged, as with squash merges) and AgentBoard's own task
// worktrees that no task uses anymore. The window asks for candidates and sends back the ones
// you picked; they are checked again here, so nothing outside that list is ever deleted.
'use strict';
const fs = require('fs');
const path = require('path');
const { wrap } = require('../core/platform');
const { GitService } = require('./GitService');

class BranchCleanup {
  constructor({ runner, gitService, github, audit }) {
    Object.assign(this, { git: runner, gitService, github, audit });
  }

  // `busy`: folders in use (worktrees of active tasks, folders of open cards); they are kept.
  async candidates(cwd, busy = []) {
    const { top, base, current, branches } = await this.gitService.overview(cwd);
    const inUse = new Set((Array.isArray(busy) ? busy : []).map((d) => path.resolve(String(d))));
    const merged = new Set((await this.git.text(top, ['branch', '--merged', base, '--format=%(refname:short)'])).split('\n').map((s) => s.trim()).filter(Boolean));
    let prs = {};
    try { prs = await this.github.pulls(top); } catch {} // without gh, only branches git sees as merged
    const done = (name) => merged.has(name) || prs[name]?.state === 'merged';
    const list = branches.filter((b) => b.name !== base && b.name !== current && !b.worktree && done(b.name))
      .map((b) => ({ name: b.name, at: b.at, subject: b.subject, how: merged.has(b.name) ? 'merged' : 'pr', pr: prs[b.name]?.number || null }));

    const own = path.join(top, '.agentboard', 'worktrees') + path.sep;
    const trees = GitService.parseWorktrees((await this.git.run(top, ['worktree', 'list', '--porcelain'])).out);
    const worktrees = [];
    for (const [branch, dir] of Object.entries(trees)) {
      if (!path.resolve(dir).startsWith(own)) continue; // only AgentBoard's own task worktrees
      if (inUse.has(path.resolve(dir))) continue;
      const missing = !fs.existsSync(dir);
      const dirty = !missing && !!(await this.git.text(dir, ['status', '--porcelain']));
      const ahead = parseInt(await this.git.text(top, ['rev-list', '--count', `${base}..${branch}`]), 10) || 0;
      const reason = dirty ? 'has uncommitted changes' : ahead && !done(branch) ? `has ${ahead} commit${ahead === 1 ? '' : 's'} not in ${base}` : '';
      worktrees.push({ dir, branch, removable: !reason, reason });
    }
    return { top, base, branches: list, worktrees };
  }

  async apply(cwd, picked = {}, busy = []) {
    const c = await this.candidates(cwd, busy);
    const wantB = new Set(Array.isArray(picked.branches) ? picked.branches : []);
    const wantW = new Set(Array.isArray(picked.worktrees) ? picked.worktrees : []);
    const removed = { branches: [], worktrees: [] };
    const errors = [];
    for (const w of c.worktrees.filter((x) => x.removable && wantW.has(x.dir))) {
      const r = await this.git.run(c.top, ['worktree', 'remove', w.dir]);
      if (!r.ok) { errors.push(`${w.branch}: ${r.err.trim().split('\n').pop()}`); continue; }
      // the branch was checked above: merged, its PR merged, or no commits of its own
      await this.git.run(c.top, ['branch', '-D', w.branch]);
      removed.worktrees.push(w.dir);
    }
    for (const b of c.branches.filter((x) => wantB.has(x.name))) {
      const r = await this.git.run(c.top, ['branch', '-D', b.name]);
      if (r.ok) removed.branches.push(b.name); else errors.push(`${b.name}: ${r.err.trim().split('\n').pop()}`);
    }
    await this.git.run(c.top, ['worktree', 'prune']);
    this.audit?.add('git-cleanup', { top: c.top, branches: removed.branches, worktrees: removed.worktrees.length });
    return { ...removed, errors };
  }

  register(ipcMain) {
    ipcMain.handle('git:cleanupCandidates', wrap((_e, cwd, busy) => this.candidates(cwd, busy)));
    ipcMain.handle('git:cleanup', wrap((_e, cwd, picked, busy) => this.apply(cwd, picked || {}, busy)));
  }
}

module.exports = { BranchCleanup };
