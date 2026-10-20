// Unit tests for the subscription limits parsers (no network, no real logs).
// Run: npm test
'use strict';
const test = require('node:test');
const assert = require('assert/strict');
const { parseClaudeUsage, parseCodexLimits, windowLabel } = require('../src/main/library/SubscriptionLimits');

test('windowLabel names the usual windows', () => {
  assert.equal(windowLabel(300), '5 h');
  assert.equal(windowLabel(10080), 'Week');
  assert.equal(windowLabel(1440), '1 d');
  assert.equal(windowLabel(45), '45 min');
});

test('parseClaudeUsage reads the 5-hour window and the week', () => {
  const rows = parseClaudeUsage({
    five_hour: { utilization: 23.4, resets_at: '2026-10-20T18:00:00Z' },
    seven_day: { utilization: 61, resets_at: '2026-10-25T09:00:00Z' },
    seven_day_opus: null,
  });
  assert.deepEqual(rows, [
    { label: '5 h', used: 23.4, resetsAt: Date.parse('2026-10-20T18:00:00Z') },
    { label: 'Week', used: 61, resetsAt: Date.parse('2026-10-25T09:00:00Z') },
  ]);
  assert.deepEqual(parseClaudeUsage({}), []);
});

test('parseCodexLimits takes the last record and resets expired windows', () => {
  const line = (used, resetsAt) => JSON.stringify({ timestamp: '2026-10-20T12:00:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: {
    primary: { used_percent: used, window_minutes: 300, resets_at: resetsAt }, secondary: { used_percent: 4, window_minutes: 10080, resets_at: 2_000_000_000 }, plan_type: 'plus' } } });
  const now = 1_900_000_000_000;
  const text = [line(10, 1_950_000_000), '{"payload":{"rate_limits":null}}', line(23, 1_950_000_000)].join('\n');
  const r = parseCodexLimits(text, now);
  assert.equal(r.plan, 'plus');
  assert.deepEqual(r.windows[0], { label: '5 h', used: 23, resetsAt: 1_950_000_000_000 });
  assert.equal(r.windows[1].label, 'Week');
  // the 5-hour window already reset: nothing used
  assert.deepEqual(parseCodexLimits(line(80, 1_800_000_000), now).windows[0], { label: '5 h', used: 0, resetsAt: null });
  assert.equal(parseCodexLimits('{"payload":{"rate_limits":null}}', now), null);
});
