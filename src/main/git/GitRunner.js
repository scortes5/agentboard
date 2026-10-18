// Runs git: quick read-only calls for the cards, longer ones with their output, and a
// snapshot of the whole working tree that never touches the user's own index or stash.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

class GitRunner {
  // Read-only calls for the cards (status pills): the output, or null when it fails.
  quick(cwd, args) {
    return new Promise((resolve) => execFile('git', args, { cwd, timeout: 4000, windowsHide: true }, (err, out) => resolve(err ? null : out)));
  }

  // Longer operations: { ok, out, err }, optionally with extra environment.
  run(cwd, args, env) {
    return new Promise((resolve) => execFile('git', args,
      { cwd, timeout: 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined },
      (err, out, errOut) => resolve({ ok: !err, out: String(out), err: String(errOut || err?.message || '') })));
  }

  async text(cwd, args) { return (await this.run(cwd, args)).out.trim(); }

  // The repository root of a project folder.
  async top(cwd) {
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Invalid folder.');
    const top = await this.text(cwd, ['rev-parse', '--show-toplevel']);
    if (!top) throw new Error('The project is not a git repository.');
    return top;
  }

  // The main repository a task's worktree belongs to.
  async worktreeTop(dir) {
    const common = await this.text(dir, ['rev-parse', '--git-common-dir']);
    if (!common) throw new Error('Not a git worktree.');
    return path.dirname(path.resolve(dir, common));
  }

  // Tracked and untracked files (.gitignore respected) written as a tree with a throwaway index.
  async snapshotTree(dir) {
    const real = path.resolve(dir, await this.text(dir, ['rev-parse', '--git-path', 'index']));
    const tmp = path.join(os.tmpdir(), `agentboard-index-${process.pid}-${Date.now()}`);
    try {
      if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
      const env = { GIT_INDEX_FILE: tmp };
      const add = await this.run(dir, ['add', '-A'], env);
      if (!add.ok) throw new Error(add.err.trim() || 'git add failed.');
      const tree = (await this.run(dir, ['write-tree'], env)).out.trim();
      if (!tree) throw new Error('Could not snapshot the working tree.');
      return tree;
    } finally { try { fs.unlinkSync(tmp); } catch {} }
  }

  // Commit pending changes in a folder (before a merge or a pull request).
  async commitAll(dir, message) {
    if (!(await this.text(dir, ['status', '--porcelain']))) return;
    await this.run(dir, ['add', '-A']);
    const c = await this.run(dir, ['commit', '-m', String(message).slice(0, 200)]);
    if (!c.ok) throw new Error('Could not commit: ' + c.err.trim());
  }
}

module.exports = { GitRunner };
