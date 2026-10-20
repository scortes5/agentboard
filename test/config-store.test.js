// Unit tests for ConfigStore: defaults, merging a saved board and atomic saves.
// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ConfigStore } = require('../src/main/core/ConfigStore');

const tmpStore = () => new ConfigStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ab-config-')), 'data'));

test('a missing or broken board.json falls back to the defaults', () => {
  const store = tmpStore();
  assert.deepEqual(store.load(), store.defaults());
  fs.mkdirSync(store.dataDir, { recursive: true });
  fs.writeFileSync(store.path, '{ not json');
  assert.deepEqual(store.load(), store.defaults());
});

test('saved settings win over the defaults and new default fields still appear', () => {
  const store = tmpStore();
  store.save({ fontSize: 16, projects: [{ path: '/x', name: 'x' }] });
  const cfg = store.load();
  assert.equal(cfg.fontSize, 16);
  assert.deepEqual(cfg.projects, [{ path: '/x', name: 'x' }]);
  assert.equal(cfg.maxParallel, store.defaults().maxParallel);
});

test('built-in agents get missing light/heavy args from the defaults', () => {
  const store = tmpStore();
  const base = store.defaults().agents;
  const [key, agent] = Object.entries(base).find(([, a]) => a.lightArgs || a.heavyArgs);
  const { lightArgs, heavyArgs, ...rest } = agent;
  store.save({ agents: { [key]: rest, custom: { name: 'Mine' } } });
  const cfg = store.load();
  assert.deepEqual(cfg.agents[key].lightArgs, lightArgs);
  assert.deepEqual(cfg.agents[key].heavyArgs, heavyArgs);
  assert.deepEqual(cfg.agents.custom, { name: 'Mine' });
});

test('save writes atomically and leaves no temp file behind', () => {
  const store = tmpStore();
  store.save({ a: 1 });
  store.save({ a: 2 });
  assert.equal(JSON.parse(fs.readFileSync(store.path, 'utf8')).a, 2);
  assert.equal(fs.existsSync(`${store.path}.tmp`), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(store.path).mode & 0o777, 0o600);
});

test('agent args still on an earlier default move to the current one; edited args are kept', () => {
  const store = tmpStore();
  const base = store.defaults().agents;
  store.save({ agents: {
    codex: { ...base.codex, lightArgs: '-c model_reasoning_effort=low', heavyArgs: '-m my-model', normalArgs: undefined },
  } });
  const cfg = store.load();
  assert.equal(cfg.agents.codex.lightArgs, base.codex.lightArgs);
  assert.equal(cfg.agents.codex.normalArgs, base.codex.normalArgs);
  assert.equal(cfg.agents.codex.heavyArgs, '-m my-model');
  assert.equal(cfg.agents.claude.normalArgs, '--model sonnet');
});
