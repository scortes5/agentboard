// Work summaries: what each agent changed while working on a task. A git snapshot is taken
// when the task starts; when it finishes we diff against it and keep the files touched, line
// counts and commits made. Everything stays in the app's data folder.
'use strict';
const fs = require('fs');
const path = require('path');
const { wrap } = require('../core/platform');

const MAX_ENTRIES = 500;
const MAX_FILES = 200; // per entry, so one huge refactor does not bloat the log
const RECENT = 20;

class WorkLog {
  // file: where the log is kept · runner: GitRunner (quick() answers null when git fails)
  constructor({ file, runner }) {
    Object.assign(this, { file, runner });
    this.starts = new Map(); // taskId → Promise<{ cwd, head, dirty } | null>
  }

  register(ipcMain) {
    ipcMain.handle('work:begin', wrap((_e, taskId, cwd) => this.begin(taskId, cwd)));
    ipcMain.handle('work:finish', wrap((_e, task) => this.finish(task)));
    ipcMain.handle('work:recent', wrap(() => this.recent()));
  }

  load() {
    try { const list = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(list) ? list : []; } catch { return []; }
  }

  save(list) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(list.slice(-MAX_ENTRIES)), { mode: 0o600 });
  }

  // Paths with uncommitted changes, tracked or not; null outside a git repository.
  async dirtyFiles(cwd) {
    const out = await this.runner.quick(cwd, ['status', '--porcelain', '-z', '--untracked-files=all', '--no-renames']);
    if (out == null) return null;
    return new Set(out.split('\0').filter((p) => p.length > 3).map((p) => p.slice(3)));
  }

  // The finish call awaits this, so a task that ends right away still diffs against its start.
  begin(taskId, cwd) {
    if (typeof taskId !== 'string' || typeof cwd !== 'string' || !fs.existsSync(cwd)) return false;
    const start = (async () => {
      const dirty = await this.dirtyFiles(cwd);
      if (dirty == null) return null;
      const head = (await this.runner.quick(cwd, ['rev-parse', 'HEAD']))?.trim() || null;
      return { cwd, head, dirty };
    })();
    this.starts.set(taskId, start);
    return start.then(Boolean);
  }

  async collect(cwd, start) {
    const files = new Map();
    // Without a start snapshot (the app restarted mid-task) only uncommitted changes are known.
    const numstat = await this.runner.quick(cwd, ['diff', '--numstat', '--no-renames', '-z', start?.head || 'HEAD']);
    for (const entry of (numstat || '').split('\0')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(entry);
      if (m) files.set(m[3], { path: m[3], added: m[1] === '-' ? 0 : +m[1], removed: m[2] === '-' ? 0 : +m[2] });
    }
    const untracked = await this.runner.quick(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const p of (untracked || '').split('\0').filter(Boolean)) {
      if (!files.has(p)) files.set(p, { path: p, added: 0, removed: 0, created: true });
    }
    // Files already dirty at the start may hold someone else's work: flag them instead of dropping them.
    for (const f of files.values()) if (start?.dirty.has(f.path)) f.preexisting = true;

    const commits = [];
    if (start?.head) {
      const log = await this.runner.quick(cwd, ['log', '--format=%h%x09%s', `${start.head}..HEAD`]);
      for (const line of (log || '').split('\n').filter(Boolean)) {
        const [hash, ...subject] = line.split('\t');
        commits.push({ hash, subject: subject.join('\t') });
      }
    }
    const branch = (await this.runner.quick(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || '';
    return { branch, commits, files: [...files.values()].slice(0, MAX_FILES), fileCount: files.size };
  }

  // Called when a task is marked done or blocked; a reopened task replaces its old entry.
  async finish(task) {
    if (!task || typeof task.id !== 'string') throw new Error('Invalid task.');
    const start = await (this.starts.get(task.id) || null);
    this.starts.delete(task.id);
    const cwd = start?.cwd || (typeof task.cwd === 'string' ? task.cwd : '');
    const changes = cwd && fs.existsSync(cwd) ? await this.collect(cwd, start) : { branch: '', commits: [], files: [], fileCount: 0 };
    const entry = {
      taskId: task.id, text: String(task.text || '').slice(0, 300), agent: String(task.agent || ''), status: String(task.status || ''),
      summary: String(task.summary || '').slice(0, 500), cwd, startedAt: +task.startedAt || null, finishedAt: +task.finishedAt || Date.now(),
      exact: !!start, ...changes,
      added: changes.files.reduce((n, f) => n + f.added, 0),
      removed: changes.files.reduce((n, f) => n + f.removed, 0),
    };
    const list = this.load().filter((e) => e.taskId !== entry.taskId);
    list.push(entry);
    this.save(list);
    return entry;
  }

  // Newest first, for the Work dialog.
  recent() { return this.load().slice(-RECENT).reverse(); }
}

module.exports = { WorkLog };
