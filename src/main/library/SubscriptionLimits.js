// How much of each subscription's usage limit is left: the 5-hour window and the week, and when
// each one resets. Claude: asked to Anthropic with the CLI's own sign-in token, read here in the
// main process and sent only to api.anthropic.com (never to the window or anywhere else).
// Codex: read from its local session logs, which record the limits after every answer.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const skills = require('./skills');
const { wrap } = require('../core/platform');

const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_MS = 60_000; // the dialog can be opened often; Anthropic is asked at most once a minute

// "5 h", "Week", "24 h"…: from a window's length in minutes.
function windowLabel(minutes) {
  if (minutes === 10080) return 'Week';
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) * 10) / 10));

// Anthropic's answer → [{ label, used (0–100), resetsAt (ms) }].
function parseClaudeUsage(json) {
  const rows = [['five_hour', '5 h'], ['seven_day', 'Week'], ['seven_day_opus', 'Week · Opus'], ['seven_day_sonnet', 'Week · Sonnet']];
  return rows.filter(([k]) => json?.[k] && json[k].utilization != null).map(([k, label]) => ({
    label, used: pct(json[k].utilization), resetsAt: json[k].resets_at ? Date.parse(json[k].resets_at) || null : null,
  }));
}

// The last "rate_limits" a Codex log recorded. A window whose reset time has passed is back to 0.
function parseCodexLimits(text, now = Date.now()) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits":{')) continue;
    let d;
    try { d = JSON.parse(lines[i]); } catch { continue; }
    const rl = d.payload?.rate_limits || d.rate_limits;
    if (!rl) continue;
    const windows = [rl.primary, rl.secondary].filter((w) => w && w.used_percent != null).map((w) => {
      const resetsAt = w.resets_at ? w.resets_at * 1000 : w.resets_in_seconds != null && d.timestamp ? Date.parse(d.timestamp) + w.resets_in_seconds * 1000 : null;
      const reset = resetsAt && resetsAt <= now;
      return { label: w.window_minutes ? windowLabel(w.window_minutes) : '', used: reset ? 0 : pct(w.used_percent), resetsAt: reset ? null : resetsAt };
    });
    if (windows.length) return { windows, asOf: d.timestamp ? Date.parse(d.timestamp) : null, plan: rl.plan_type || null };
  }
  return null;
}

// The newest files of a sessions/YYYY/MM/DD tree, without listing the whole history. Many hold
// no limits (sessions closed before any answer), so a good number are looked at.
function newestJsonl(dir, max = 200) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => path.join(d, e.name));
    files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    out.push(...files);
    for (const sub of dirs) { if (out.length >= max) return; walk(path.join(d, sub)); }
  };
  walk(dir);
  return out.slice(0, max);
}

class SubscriptionLimits {
  constructor() {
    this.cache = new Map(); // config dir → { at, value }
  }

  async claudeToken(dir) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf8'));
      if (j.claudeAiOauth?.accessToken) return j.claudeAiOauth;
    } catch {}
    // macOS keeps the main account's login in the Keychain
    if (process.platform !== 'darwin' || dir !== skills.claudeDir()) return null;
    const raw = await new Promise((resolve) => execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 },
      (err, out) => resolve(err ? '' : out)));
    try { return JSON.parse(raw).claudeAiOauth || null; } catch { return null; }
  }

  async claude(dir, force) {
    const hit = this.cache.get(dir);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const auth = await this.claudeToken(dir);
    if (!auth?.accessToken) return { error: 'Not signed in.' };
    if (auth.expiresAt && auth.expiresAt < Date.now()) return { error: 'The sign-in expired: open Claude once and it renews it.' };
    const res = await fetch(CLAUDE_USAGE_URL, {
      headers: { Authorization: `Bearer ${auth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return { error: 'The sign-in expired: open Claude once and it renews it.' };
    if (!res.ok) return { error: `Anthropic answered ${res.status}.` };
    const value = { windows: parseClaudeUsage(await res.json()), asOf: Date.now(), plan: auth.subscriptionType || null };
    this.cache.set(dir, { at: Date.now(), value });
    return value;
  }

  codex() {
    for (const f of newestJsonl(path.join(skills.codexDir(), 'sessions'))) {
      let text;
      try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
      if (!text.includes('"rate_limits":{')) continue;
      const r = parseCodexLimits(text);
      if (r) return r;
    }
    return { error: 'No data yet: Codex records it after its first answer.' };
  }

  // list: [{ key, kind: 'claude' | 'codex', dir? }] → { key: { windows, asOf, plan } | { error } }
  async get(list = [], force = false) {
    const out = {};
    await Promise.all(list.map(async ({ key, kind, dir }) => {
      try {
        out[key] = kind === 'claude' ? await this.claude(dir || skills.claudeDir(), force) : kind === 'codex' ? this.codex() : { error: 'Not supported.' };
      } catch (err) { out[key] = { error: err.name === 'TimeoutError' ? 'Anthropic did not answer in time.' : err.message }; }
    }));
    return out;
  }

  register(ipcMain) {
    ipcMain.handle('limits:get', wrap((_e, list, force) => this.get(list, force)));
  }
}

module.exports = { SubscriptionLimits, parseClaudeUsage, parseCodexLimits, windowLabel };
