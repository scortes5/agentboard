// Git for a project folder: the status pill and branches of a card, and the checkpoint a
// task starts from, with its full diff and the way back to it.
'use strict';
const fs = require('fs');
const path = require('path');
const { wrap } = require('../core/platform');

class GitService {
  constructor({ runner }) {
    this.git = runner;
  }

  async status(cwd) {
    if (!cwd || !fs.existsSync(cwd)) return null;
    const out = await this.git.quick(cwd, ['status', '--porcelain=v2', '--branch']);
    if (out == null) return null; // not a repo, or git is not installed
    const res = { branch: '', ahead: 0, behind: 0, changes: 0 };
    for (const line of out.split('\n')) {
      if (line.startsWith('# branch.head ')) res.branch = line.slice(14).trim();
      else if (line.startsWith('# branch.ab ')) {
        const m = line.match(/\+(\d+) -(\d+)/);
        if (m) { res.ahead = +m[1]; res.behind = +m[2]; }
      } else if (line && !line.startsWith('#')) res.changes++;
    }
    return res;
  }

  async branches(cwd) {
    const out = await this.git.quick(cwd, ['branch', '--format=%(refname:short)']);
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  }

  // Every local branch of the project's repository, most recently committed first: its last
  // commit, how far it is from the main branch and its upstream, and the worktree it is
  // checked out in (task worktrees included), so you can see where work is happening.
  async overview(cwd) {
    const top = await this.git.top(cwd);
    const [refs, trees, current, originHead] = await Promise.all([
      this.git.run(top, ['for-each-ref', 'refs/heads', '--sort=-committerdate', '--count=60',
        '--format=%(refname:short)%09%(committerdate:unix)%09%(authorname)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(objectname:short)%09%(subject)']),
      this.git.run(top, ['worktree', 'list', '--porcelain']),
      this.git.text(top, ['rev-parse', '--abbrev-ref', 'HEAD']),
      this.git.text(top, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    ]);
    if (!refs.ok) throw new Error(refs.err.trim() || 'Could not read the branches.');
    const branches = GitService.parseRefs(refs.out);
    const worktrees = GitService.parseWorktrees(trees.out);
    const names = new Set(branches.map((b) => b.name));
    const base = [originHead.replace(/^origin\//, ''), 'main', 'master', 'develop'].find((b) => b && names.has(b)) || current;
    await Promise.all(branches.map(async (b) => {
      b.worktree = worktrees[b.name] || '';
      if (b.name === base) return;
      const c = await this.git.text(top, ['rev-list', '--left-right', '--count', `${base}...${b.name}`]);
      const m = c.match(/^(\d+)\s+(\d+)$/);
      if (m) { b.behindBase = +m[1]; b.aheadBase = +m[2]; }
    }));
    return { top, base, current, branches, repoUrl: await this.repoUrl(top) };
  }

  // https://github.com/owner/repo for a GitHub origin, '' otherwise.
  async repoUrl(top) {
    const m = (await this.git.text(top, ['remote', 'get-url', 'origin'])).match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    return m ? `https://github.com/${m[1]}` : '';
  }

  // `git for-each-ref` lines (tab-separated, see overview) as objects.
  static parseRefs(out) {
    return String(out).split('\n').filter(Boolean).map((line) => {
      const [name, at, author, upstream, track, sha, ...subject] = line.split('\t');
      const ahead = /ahead (\d+)/.exec(track || ''), behind = /behind (\d+)/.exec(track || '');
      return {
        name, at: (+at || 0) * 1000, author: author || '', sha: sha || '', subject: subject.join('\t'),
        upstream: upstream || '', gone: /gone/.test(track || ''), ahead: ahead ? +ahead[1] : 0, behind: behind ? +behind[1] : 0,
        aheadBase: 0, behindBase: 0,
      };
    });
  }

  // `git worktree list --porcelain` as branch name -> folder.
  static parseWorktrees(out) {
    const map = {};
    let dir = '';
    for (const line of String(out).split('\n')) {
      if (line.startsWith('worktree ')) dir = line.slice(9);
      else if (line.startsWith('branch refs/heads/')) map[line.slice(18)] = dir;
    }
    return map;
  }

  async checkout(cwd, branch, create) {
    return (await this.git.quick(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch])) != null;
  }

  // How the project looks right now, kept as a commit under refs/agentboard/checkpoints.
  async checkpoint(cwd, label) {
    const top = await this.git.top(cwd);
    const head = await this.git.text(top, ['rev-parse', 'HEAD']);
    if (!head) throw new Error('The repository has no commits yet.');
    const tree = await this.git.snapshotTree(top);
    const c = await this.git.run(top, ['commit-tree', tree, '-p', head, '-m', `AgentBoard checkpoint: ${String(label || '').slice(0, 120)}`]);
    const sha = c.out.trim();
    if (!c.ok || !sha) throw new Error(c.err.trim() || 'Could not create the checkpoint.');
    await this.git.run(top, ['update-ref', `refs/agentboard/checkpoints/${sha.slice(0, 12)}`, sha]);
    return { sha, head, top };
  }

  // Back to the checkpoint: files added since are removed, changed or deleted ones come back,
  // and HEAD returns to where it was (later commits stay in the reflog).
  async restore(cwd, sha) {
    const top = await this.git.top(cwd);
    if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) throw new Error('Invalid checkpoint.');
    const head = await this.git.text(top, ['rev-parse', `${sha}^`]);
    if (!head) throw new Error('That checkpoint no longer exists.');
    const now = await this.git.snapshotTree(top);
    const added = (await this.git.run(top, ['diff', '--name-only', '--diff-filter=A', '-z', sha, now])).out.split('\0').filter(Boolean);
    for (const f of added) {
      const abs = path.resolve(top, f);
      if (abs.startsWith(top + path.sep)) { try { fs.unlinkSync(abs); } catch {} }
    }
    const r1 = await this.git.run(top, ['reset', '-q', '--mixed', head]);
    const r2 = await this.git.run(top, ['checkout', sha, '--', '.']);
    await this.git.run(top, ['reset', '-q']);
    if (!r1.ok || !r2.ok) throw new Error((r1.err || r2.err).trim());
    return { removed: added.length };
  }

  // Everything that changed since `from` (a checkpoint, or where a task's branch started).
  async diffSince(dir, from) {
    if (!dir || !fs.existsSync(dir)) throw new Error('The folder no longer exists.');
    if (!from) throw new Error('Nothing to compare with (no worktree and no checkpoint for this task).');
    const now = await this.git.snapshotTree(dir);
    const d = await this.git.run(dir, ['diff', '--no-color', '--find-renames', from, now]);
    if (!d.ok) throw new Error(d.err.trim());
    return { diff: d.out.length > 2_000_000 ? d.out.slice(0, 2_000_000) + '\n[AgentBoard: diff truncated]' : d.out };
  }

  register(ipcMain) {
    ipcMain.handle('git:status', (_e, cwd) => this.status(cwd));
    ipcMain.handle('git:branches', (_e, cwd) => this.branches(cwd));
    ipcMain.handle('git:overview', wrap((_e, cwd) => this.overview(cwd)));
    ipcMain.handle('git:checkout', (_e, cwd, branch, create) => this.checkout(cwd, branch, create));
    ipcMain.handle('git:checkpoint', wrap((_e, cwd, label) => this.checkpoint(cwd, label)));
    ipcMain.handle('git:restore', wrap((_e, cwd, sha) => this.restore(cwd, sha)));
  }
}

module.exports = { GitService };
