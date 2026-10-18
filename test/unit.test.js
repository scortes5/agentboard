// Unit tests for the main-process modules that do not need Electron.
// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { slugify, wrap } = require('../src/main/core/platform');
const usage = require('../src/main/library/usage');

test('slugify makes names safe for branches, folders and accounts', () => {
  assert.equal(slugify('Fix the Login! Página'), 'fix-the-login-pagina');
  assert.equal(slugify('  ---  '), '');
  assert.equal(slugify('a'.repeat(80), 10), 'aaaaaaaaaa');
});

test('wrap turns results and errors into { ok, value | error }', async () => {
  assert.deepEqual(await wrap(async (x) => x * 2)(21), { ok: true, value: 42 });
  assert.deepEqual(await wrap(() => { throw new Error('nope'); })(), { ok: false, error: 'nope' });
});

test('sessionTokens adds up a Claude session once per message, by file name', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-'));
  const id = '11111111-2222-3333-4444-555555555555';
  fs.mkdirSync(path.join(dir, 'projects', '-repo'), { recursive: true });
  const line = (mid) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: mid, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000 } } });
  // the same message streamed twice counts once
  fs.writeFileSync(path.join(dir, 'projects', '-repo', `${id}.jsonl`), [line('m1'), line('m1'), line('m2')].join('\n'));
  const r = await usage.sessionTokens({ claudeDirs: [dir], ids: [id, 'not-a-session-id'] });
  assert.deepEqual(r, { [id]: 2300 });
});

test('the router prompt carries the user\'s subscriptions, local agents and history', () => {
  const { TaskPlanner } = require('../src/main/ai/TaskPlanner');
  const p = TaskPlanner.planPrompt('fix login', { agents: ['claude', 'codex'], projects: ['web'], local: ['ollama'], history: 'claude: 3 done, 0 blocked' });
  assert.match(p, /"agent":"auto\|claude\|codex"/);
  assert.match(p, /local models for free: ollama/);
  assert.match(p, /claude: 3 done/);
  assert.deepEqual(TaskPlanner.parsePlan('Sure:\n[{"text":"a"},{"text":" "},{"x":1}]'), [{ text: 'a' }]);
});
