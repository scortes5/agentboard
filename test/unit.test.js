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

test('the webhook payload carries the text for Slack/Teams (text) and Discord (content)', () => {
  const { WebhookNotifier } = require('../src/main/integrations/WebhookNotifier');
  const p = WebhookNotifier.payload('x'.repeat(5000));
  assert.equal(p.text.length, 3800);
  assert.equal(p.content.length, 1990);
  assert.equal(WebhookNotifier.payload('hi').content, 'hi');
});

test('the remote server needs the token, shows the snapshot and forwards actions', async () => {
  const { RemoteServer } = require('../src/main/remote/RemoteServer');
  const token = 'a'.repeat(48);
  const sent = [];
  const config = { load: () => ({ remote: { enabled: true, port: 0, token } }) };
  const remote = new RemoteServer({ config, send: (...a) => sent.push(a) });
  await remote.apply();
  try {
    const base = `http://127.0.0.1:${remote.server.address().port}`;
    const call = (p, { auth = token, body } = {}) => fetch(base + p, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${auth}` }, body: body && JSON.stringify(body),
    });
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await call('/api/state', { auth: 'b'.repeat(48) })).status, 401);
    assert.equal((await call('/api/state', { auth: '' })).status, 401);
    remote.snapshot = { tasks: [{ id: 't1', text: 'Fix it' }], approvals: [{ card: 'c1', question: 'Run?' }], counts: {} };
    assert.deepEqual((await (await call('/api/state')).json()).tasks, [{ id: 't1', text: 'Fix it' }]);
    assert.equal((await call('/api/task', { body: { text: 'From the phone' } })).status, 202);
    assert.equal((await call('/api/task', { body: { text: '  ' } })).status, 400);
    assert.equal((await call('/api/approve', { body: { card: 'gone', yes: true } })).status, 404);
    assert.equal((await call('/api/approve', { body: { card: 'c1', yes: true } })).status, 202);
    assert.deepEqual(sent, [['remote:action', { kind: 'task', text: 'From the phone' }], ['remote:action', { kind: 'approve', card: 'c1', yes: true }]]);
  } finally {
    await remote.stop();
  }
});

test('the remote server stays off without a strong token', async () => {
  const { RemoteServer } = require('../src/main/remote/RemoteServer');
  const remote = new RemoteServer({ config: { load: () => ({ remote: { enabled: true, port: 0, token: 'short' } }) }, send() {} });
  await assert.rejects(remote.apply(), /Create a link first/);
  assert.equal(remote.status().running, false);
});

test('ground rules live in one marked block that can be replaced and removed', () => {
  const { GroundRules } = require('../src/main/agents/GroundRules');
  const once = GroundRules.merge('# Mine\n', '- Commit as me.');
  assert.match(once, /^# Mine\n\n<!-- agentboard:ground-rules:start[^\n]*-->\n## Ground rules\n\n- Commit as me\.\n<!-- agentboard:ground-rules:end -->\n$/);
  const twice = GroundRules.merge(once, '- Ask before deleting.');
  assert.equal((twice.match(/ground-rules:start/g) || []).length, 1);
  assert.doesNotMatch(twice, /Commit as me/);
  assert.equal(GroundRules.merge(twice, ''), '# Mine\n');
  assert.equal(GroundRules.merge('', ''), '');
});
