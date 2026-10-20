// Keeping a project's branches in step with GitHub: fetch, fast-forward the local branches
// that are behind their remote branch, push the ones you pick, and make local copies of
// branches that only exist on GitHub. Nothing is ever forced: a branch with commits on both
// sides, or a checked-out branch with uncommitted changes, is left alone and reported.
'use strict';
const { wrap } = require('../core/platform');

// Never wait for a password prompt nobody can answer: fail instead, with git's message.
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
const SAFE_NAME = /^(?!-)(?!.*\.\.)[\w./-]{1,200}$/;

class BranchSync {
  constructor({ runner, gitService, audit }) {
    Object.assign(this, { git: runner, gitService, audit });
  }

  async origin(cwd) {
    const top = await this.git.top(cwd);
    if (!(await this.git.text(top, ['remote', 'get-url', 'origin']))) throw new Error('This project has no remote named origin (GitHub).');
    return top;
  }

  static why(err) {
    const e = String(err || '').trim();
    if (/could not read Username|Authentication failed|Permission denied|terminal prompts disabled/i.test(e)) return 'GitHub did not accept the credentials: sign in with git or gh in a terminal first.';
    if (/Could not resolve host|unable to access/i.test(e)) return 'GitHub could not be reached: check the connection.';
    return e.split('\n').filter(Boolean).pop() || 'git failed.';
  }

  async fetch(top) {
    const r = await this.git.run(top, ['fetch', '--prune', '--quiet', 'origin'], NO_PROMPT);
    if (!r.ok) throw new Error(BranchSync.why(r.err));
  }

  // Fetch, then fast-forward every local branch that is only behind its remote branch. `auto`
  // (the periodic sync) never touches a checked-out branch, so no working folder changes by itself.
  async pull(cwd, { auto = false } = {}) {
    const top = await this.origin(cwd);
    await this.fetch(top);
    const { branches } = await this.gitService.overview(top);
    const updated = [], skipped = [];
    for (const b of branches.filter((x) => x.upstream && !x.gone && x.behind > 0)) {
      if (b.ahead > 0) { skipped.push({ name: b.name, why: `${b.ahead} local and ${b.behind} remote commits: merge or rebase it yourself` }); continue; }
      if (b.worktree) {
        if (auto) { skipped.push({ name: b.name, why: 'checked out: use Pull' }); continue; }
        if (await this.git.text(b.worktree, ['status', '--porcelain', '--untracked-files=no'])) { skipped.push({ name: b.name, why: 'checked out with uncommitted changes' }); continue; }
        const m = await this.git.run(b.worktree, ['merge', '--ff-only', '--quiet', '@{u}']);
        if (m.ok) updated.push({ name: b.name, commits: b.behind }); else skipped.push({ name: b.name, why: BranchSync.why(m.err) });
        continue;
      }
      const up = await this.git.text(top, ['rev-parse', '--verify', '--quiet', `refs/remotes/${b.upstream}`]);
      const cur = await this.git.text(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${b.name}`]);
      if (!up || !cur || !(await this.git.run(top, ['merge-base', '--is-ancestor', cur, up])).ok) { skipped.push({ name: b.name, why: 'not a fast-forward' }); continue; }
      const u = await this.git.run(top, ['update-ref', `refs/heads/${b.name}`, up, cur]);
      if (u.ok) updated.push({ name: b.name, commits: b.behind }); else skipped.push({ name: b.name, why: BranchSync.why(u.err) });
    }
    return { updated, skipped, fetchedAt: Date.now() };
  }

  // Push the picked local branches to origin (setting the upstream of new ones). A branch
  // GitHub has moved past is rejected by git, never forced.
  async push(cwd, names = []) {
    const top = await this.origin(cwd);
    const { branches } = await this.gitService.overview(top);
    const known = new Map(branches.map((b) => [b.name, b]));
    const pushed = [], failed = [];
    for (const name of (Array.isArray(names) ? names : []).filter((n) => known.has(n) && SAFE_NAME.test(n))) {
      const b = known.get(name);
      const r = await this.git.run(top, ['push', '--quiet', ...(b.upstream && !b.gone ? [] : ['-u']), 'origin', `refs/heads/${name}:refs/heads/${name}`], NO_PROMPT);
      if (r.ok) pushed.push(name);
      else failed.push({ name, why: /rejected|non-fast-forward|fetch first/i.test(r.err) ? 'GitHub has commits this branch does not: pull it first' : BranchSync.why(r.err) });
    }
    this.audit?.add('git-push', { top, pushed, failed: failed.map((f) => f.name) });
    return { pushed, failed };
  }

  // A local branch that tracks a branch that only exists on GitHub (without switching to it).
  async track(cwd, name) {
    const top = await this.origin(cwd);
    if (!SAFE_NAME.test(String(name))) throw new Error('Invalid branch name.');
    if (!(await this.git.text(top, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`]))) throw new Error(`origin/${name} no longer exists: pull first.`);
    if (await this.git.text(top, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])) throw new Error(`A local branch named ${name} already exists.`);
    const r = await this.git.run(top, ['branch', '--track', name, `origin/${name}`]);
    if (!r.ok) throw new Error(BranchSync.why(r.err));
    return { name };
  }

  register(ipcMain) {
    ipcMain.handle('git:pull', wrap((_e, cwd, opts) => this.pull(cwd, { auto: !!opts?.auto })));
    ipcMain.handle('git:push', wrap((_e, cwd, names) => this.push(cwd, names)));
    ipcMain.handle('git:track', wrap((_e, cwd, name) => this.track(cwd, name)));
  }
}

module.exports = { BranchSync, SAFE_NAME };
