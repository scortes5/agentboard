// Unit tests for desktop notifications and the work log (no Electron needed).
// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { DesktopNotifications, preferences } = require('../src/main/notifications/DesktopNotifications');
const { GitRunner } = require('../src/main/git/GitRunner');
const { WorkLog } = require('../src/main/git/WorkLog');

function notifier(prefs = {}, focused = false, mode = 'show') {
  const instances = [], clicks = [];
  class FakeNotification extends EventEmitter {
    static isSupported() { return mode !== 'unsupported'; }
    constructor(options) { super(); this.options = options; instances.push(this); }
    show() {
      if (mode === 'throw') throw new Error('native error');
      if (mode !== 'timeout') this.emit(mode, {}, 'delivery failed');
    }
  }
  const n = new DesktopNotifications({
    Notification: FakeNotification, getPreferences: () => prefs, isFocused: () => focused, onClick: (id) => clicks.push(id), timeoutMs: 5,
  });
  return { n, instances, clicks };
}

test('notifications show with the body, sound setting and click target', async () => {
  const { n, instances, clicks } = notifier({ sound: false });
  for (const kind of ['completed', 'blocked', 'review', 'idle']) {
    assert.deepEqual(await n.notify({ kind, body: 'Task summary', cardId: 'card' }), { ok: true });
  }
  assert.equal(instances[0].options.body, 'Task summary');
  assert.equal(instances[0].options.silent, true);
  instances[0].emit('click');
  assert.deepEqual(clicks, ['card']);
});

test('global, per-event and foreground filters skip notifications', async () => {
  for (const { n, instances } of [notifier({ enabled: false }), notifier({ completed: false }), notifier({}, true)]) {
    assert.deepEqual(await n.notify({ kind: 'completed' }), { ok: true, skipped: true });
    assert.equal(instances.length, 0);
  }
  assert.deepEqual(await notifier({ backgroundOnly: false }, true).n.notify({ kind: 'completed' }), { ok: true });
  assert.deepEqual(await notifier().n.notify({ kind: 'started' }), { ok: true, skipped: true });
  assert.deepEqual(await notifier({ started: true }).n.notify({ kind: 'started' }), { ok: true });
});

test('the test notification uses unsaved settings and ignores the filters', async () => {
  const { n, instances } = notifier({ enabled: false }, true);
  assert.equal((await n.notify({ kind: 'test' })).ok, false);
  assert.deepEqual(await n.notify({ kind: 'test' }, { test: true, preferences: { sound: false } }), { ok: true });
  assert.equal(instances[0].options.silent, true);
});

test('unsupported systems, failures and unconfirmed notifications are reported', async () => {
  for (const mode of ['unsupported', 'failed', 'throw', 'timeout']) {
    const r = await notifier({}, false, mode).n.notify({ kind: 'completed' });
    assert.equal(r.ok, false, mode);
    assert.ok(r.error, mode);
  }
});

test('invalid preferences fall back and invalid events never show', async () => {
  assert.equal(preferences({ enabled: 'false', sound: false }).enabled, true);
  assert.equal(preferences({ enabled: 'false', sound: false }).sound, false);
  const { n, instances } = notifier();
  for (const event of [null, {}, { kind: '__proto__' }, { kind: 'unexpected' }]) assert.equal((await n.notify(event)).ok, false);
  assert.equal(instances.length, 0);
});

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-worklog-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'dirty.txt'), 'x\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return { dir, git };
}

test('the work log records files, lines and commits made during a task', async () => {
  const { dir, git } = repo();
  const file = path.join(dir, '..', `${path.basename(dir)}-log.json`);
  const log = new WorkLog({ file, runner: new GitRunner() });
  fs.writeFileSync(path.join(dir, 'dirty.txt'), 'someone else\n'); // dirty before the task
  assert.equal(await log.begin('t1', dir), true);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\n');
  git('commit', '-qam', 'add two');
  fs.writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
  const e = await log.finish({ id: 't1', text: 'Task', agent: 'claude', status: 'done', startedAt: 1, finishedAt: 2 });
  assert.equal(e.exact, true);
  assert.deepEqual(e.commits.map((c) => c.subject), ['add two']);
  const byPath = Object.fromEntries(e.files.map((f) => [f.path, f]));
  assert.equal(byPath['a.txt'].added, 1);
  assert.equal(byPath['dirty.txt'].preexisting, true);
  assert.equal(byPath['new file.txt'].created, true);
  assert.equal(log.recent()[0].taskId, 't1');
  // a reopened task replaces its entry
  await log.finish({ id: 't1', text: 'Task', status: 'blocked', cwd: dir });
  assert.equal(log.recent().length, 1);
  assert.equal(log.recent()[0].exact, false);
});

test('the work log ignores folders that are not git repositories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-plain-'));
  const log = new WorkLog({ file: path.join(dir, 'log.json'), runner: new GitRunner() });
  assert.equal(await log.begin('t', dir), false);
  assert.equal(await log.begin('t', path.join(dir, 'missing')), false);
  await assert.rejects(log.finish(null));
});
