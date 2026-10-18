// Git for the board and for tasks: status pills, branches, per-task worktrees,
// checkpoints, full diffs, merging and pull requests.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { shell } = require('electron');
const { wrap, slugify } = require('./platform');
const { which } = require('./shell-env');
const { loadConfig } = require('./config');

// Quick read-only calls for the cards (status pills): null when it fails or is not a repo.
function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 4000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

// Longer operations with their output and error, optionally with extra environment.
function gitLong(cwd, args, env) {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, timeout: 60_000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: env ? { ...process.env, ...env } : undefined },
      (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout), err: String(stderr || err?.message || '') }));
  });
}

// The main repository a task's worktree belongs to.
async function worktreeTop(dir) {
  const common = (await gitLong(dir, ['rev-parse', '--git-common-dir'])).out.trim();
  if (!common) throw new Error('Not a git worktree.');
  return path.dirname(path.resolve(dir, common));
}

// A snapshot of the whole working tree (tracked and untracked files, .gitignore respected)
// written with a throwaway index, so the user's own index and stash are never touched.
async function snapshotTree(dir) {
  const real = path.resolve(dir, (await gitLong(dir, ['rev-parse', '--git-path', 'index'])).out.trim());
  const tmp = path.join(os.tmpdir(), `agentboard-index-${process.pid}-${Date.now()}`);
  try {
    if (fs.existsSync(real)) fs.copyFileSync(real, tmp);
    const env = { GIT_INDEX_FILE: tmp };
    const add = await gitLong(dir, ['add', '-A'], env);
    if (!add.ok) throw new Error(add.err.trim() || 'git add failed.');
    const tree = (await gitLong(dir, ['write-tree'], env)).out.trim();
    if (!tree) throw new Error('Could not snapshot the working tree.');
    return tree;
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

// The repository root of a project folder.
async function repoTop(cwd) {
  if (!cwd || !fs.existsSync(cwd)) throw new Error('Invalid folder.');
  const top = (await gitLong(cwd, ['rev-parse', '--show-toplevel'])).out.trim();
  if (!top) throw new Error('The project is not a git repository.');
  return top;
}

function register(ipcMain) {
  ipcMain.handle('git:status', async (_e, cwd) => {
    if (!cwd || !fs.existsSync(cwd)) return null;
    const out = await git(cwd, ['status', '--porcelain=v2', '--branch']);
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
  });

  ipcMain.handle('git:branches', async (_e, cwd) => {
    const out = await git(cwd, ['branch', '--format=%(refname:short)']);
    return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  });

  ipcMain.handle('git:checkout', async (_e, cwd, branch, create) => {
    const out = await git(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch]);
    return out != null;
  });

  // Isolated worktree for a task: <repo>/.agentboard/worktrees/<slug> on branch agentboard/<slug>.
  ipcMain.handle('git:worktree', wrap(async (_e, cwd, slug) => {
    const top = await repoTop(cwd);
    const safe = slugify(slug, 40) || 'task';
    let name = safe;
    for (let i = 2; fs.existsSync(path.join(top, '.agentboard', 'worktrees', name)); i++) name = `${safe}-${i}`;
    const dir = path.join(top, '.agentboard', 'worktrees', name);
    const branch = `agentboard/${name}`;
    const r = await gitLong(top, ['worktree', 'add', '-b', branch, dir]);
    if (!r.ok) throw new Error(r.err.trim() || 'git worktree failed.');
    // keep worktrees from showing up as changes in the main repo
    try {
      const gitDir = (await gitLong(top, ['rev-parse', '--git-common-dir'])).out.trim();
      const exclude = path.resolve(top, gitDir, 'info', 'exclude');
      const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
      if (!/^\/?\.agentboard\/?$/m.test(cur)) { fs.mkdirSync(path.dirname(exclude), { recursive: true }); fs.appendFileSync(exclude, `${cur && !cur.endsWith('\n') ? '\n' : ''}.agentboard/\n`); }
    } catch {}
    return { dir, branch };
  }));

  // What a task's worktree holds compared with the base branch.
  ipcMain.handle('git:worktreeInfo', wrap(async (_e, dir, branch) => {
    if (!dir || !fs.existsSync(dir)) throw new Error('The worktree no longer exists.');
    const top = await worktreeTop(dir);
    const base = (await gitLong(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
    const [dirty, ahead, stat] = await Promise.all([
      gitLong(dir, ['status', '--porcelain']),
      gitLong(top, ['rev-list', '--count', `${base}..${branch}`]),
      gitLong(top, ['diff', '--stat', `${base}...${branch}`]),
    ]);
    const wip = (await gitLong(dir, ['diff', '--stat', 'HEAD'])).out.trim();
    return {
      base, top, branch,
      uncommitted: dirty.out.split('\n').filter(Boolean).length,
      commits: parseInt(ahead.out, 10) || 0,
      stat: [stat.out.trim(), dirty.out.trim() ? `Uncommitted:\n${dirty.out.trimEnd()}${wip ? `\n\n${wip}` : ''}` : ''].filter(Boolean).join('\n\n').split('\n').slice(-40).join('\n'),
    };
  }));

  // Merge the task's branch into the main repo's current branch and remove the worktree.
  ipcMain.handle('git:worktreeMerge', wrap(async (_e, dir, branch, message) => {
    const top = await worktreeTop(dir);
    const mainDirty = (await gitLong(top, ['status', '--porcelain', '--untracked-files=no'])).out.trim();
    if (mainDirty) throw new Error('The main repo has uncommitted changes; commit or stash them before merging.');
    if ((await gitLong(dir, ['status', '--porcelain'])).out.trim()) {
      await gitLong(dir, ['add', '-A']);
      const c = await gitLong(dir, ['commit', '-m', String(message || `AgentBoard: ${branch}`).slice(0, 200)]);
      if (!c.ok) throw new Error('Could not commit in the worktree: ' + c.err.trim());
    }
    const m = await gitLong(top, ['merge', '--no-ff', '--no-edit', branch]);
    if (!m.ok) {
      await gitLong(top, ['merge', '--abort']);
      throw new Error('There are conflicts; nothing was merged. Resolve them in the agent card. ' + m.err.trim().split('\n').slice(-2).join(' '));
    }
    await gitLong(top, ['worktree', 'remove', '--force', dir]);
    await gitLong(top, ['branch', '-d', branch]);
    return { base: (await gitLong(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() };
  }));

  // Discard the work: remove the worktree and its branch.
  ipcMain.handle('git:worktreeDiscard', wrap(async (_e, dir, branch) => {
    const top = await worktreeTop(dir);
    await gitLong(top, ['worktree', 'remove', '--force', dir]);
    await gitLong(top, ['branch', '-D', branch]);
    return true;
  }));

  // Before a task starts: remember exactly how the project looked, to go back with one click.
  ipcMain.handle('git:checkpoint', wrap(async (_e, cwd, label) => {
    const top = await repoTop(cwd);
    const head = (await gitLong(top, ['rev-parse', 'HEAD'])).out.trim();
    if (!head) throw new Error('The repository has no commits yet.');
    const tree = await snapshotTree(top);
    const c = await gitLong(top, ['commit-tree', tree, '-p', head, '-m', `AgentBoard checkpoint: ${String(label || '').slice(0, 120)}`]);
    const sha = c.out.trim();
    if (!c.ok || !sha) throw new Error(c.err.trim() || 'Could not create the checkpoint.');
    await gitLong(top, ['update-ref', `refs/agentboard/checkpoints/${sha.slice(0, 12)}`, sha]);
    return { sha, head, top };
  }));

  // Put the project back as it was at the checkpoint: files the task added are removed,
  // changed or deleted ones come back, and HEAD returns to where it was (commits are kept in the reflog).
  ipcMain.handle('git:restore', wrap(async (_e, cwd, sha) => {
    const top = await repoTop(cwd);
    if (!/^[0-9a-f]{7,40}$/i.test(String(sha))) throw new Error('Invalid checkpoint.');
    const head = (await gitLong(top, ['rev-parse', `${sha}^`])).out.trim();
    if (!head) throw new Error('That checkpoint no longer exists.');
    const now = await snapshotTree(top);
    const added = (await gitLong(top, ['diff', '--name-only', '--diff-filter=A', '-z', sha, now])).out.split('\0').filter(Boolean);
    for (const f of added) {
      const abs = path.resolve(top, f);
      if (abs.startsWith(top + path.sep)) { try { fs.unlinkSync(abs); } catch {} }
    }
    const r1 = await gitLong(top, ['reset', '-q', '--mixed', head]);
    const r2 = await gitLong(top, ['checkout', sha, '--', '.']);
    await gitLong(top, ['reset', '-q']);
    if (!r1.ok || !r2.ok) throw new Error((r1.err || r2.err).trim());
    return { removed: added.length };
  }));

  // Everything a task changed, as a unified diff: a worktree against the point where its branch
  // left the base, or a project folder against the task's checkpoint.
  ipcMain.handle('git:fullDiff', wrap(async (_e, { dir, branch, checkpoint }) => {
    if (!dir || !fs.existsSync(dir)) throw new Error('The folder no longer exists.');
    let from = checkpoint;
    if (branch) {
      const top = await worktreeTop(dir);
      const base = (await gitLong(top, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
      from = (await gitLong(top, ['merge-base', base, branch])).out.trim();
    }
    if (!from) throw new Error('Nothing to compare with (no worktree and no checkpoint for this task).');
    const now = await snapshotTree(dir);
    const d = await gitLong(dir, ['diff', '--no-color', '--find-renames', from, now]);
    if (!d.ok) throw new Error(d.err.trim());
    const text = d.out.length > 2_000_000 ? d.out.slice(0, 2_000_000) + '\n[AgentBoard: diff truncated]' : d.out;
    return { diff: text };
  }));

  // Push the task's branch and open a pull request (with the GitHub CLI when it is installed,
  // otherwise the "compare" page in the browser).
  ipcMain.handle('git:pullRequest', wrap(async (_e, { dir, branch, title, body }) => {
    const top = await worktreeTop(dir);
    if ((await gitLong(dir, ['status', '--porcelain'])).out.trim()) {
      await gitLong(dir, ['add', '-A']);
      const c = await gitLong(dir, ['commit', '-m', String(title || `AgentBoard: ${branch}`).slice(0, 200)]);
      if (!c.ok) throw new Error('Could not commit in the worktree: ' + c.err.trim());
    }
    const push = await gitLong(top, ['push', '-u', 'origin', branch]);
    if (!push.ok) throw new Error('Could not push the branch: ' + push.err.trim().split('\n').slice(-2).join(' '));
    if (await which('gh', loadConfig())) {
      const r = await new Promise((resolve) => execFile('gh', ['pr', 'create', '--head', branch, '--title', String(title).slice(0, 200), '--body', String(body || '')],
        { cwd: top, timeout: 60_000 }, (err, out, errOut) => resolve({ ok: !err, out: String(out), err: String(errOut || err?.message || '') })));
      const url = r.out.match(/https:\/\/\S+\/pull\/\d+/)?.[0];
      if (url) return { url, created: true };
    }
    const remote = (await gitLong(top, ['remote', 'get-url', 'origin'])).out.trim();
    const m = remote.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/);
    if (!m) throw new Error('Pushed, but the remote is not on GitHub: open the pull request there.');
    const url = `https://github.com/${m[1]}/compare/${encodeURIComponent(branch)}?expand=1`;
    shell.openExternal(url);
    return { url, created: false };
  }));
}

module.exports = { register, gitLong, repoTop };
