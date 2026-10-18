// Usage per day, subscription and project, read from each CLI's local logs
// (<claude dir>/projects, <codex dir>/sessions) plus AgentBoard's task history.
// Everything stays on this computer: only token counters are added up.
const fs = require('fs');
const path = require('path');

const fileCache = new Map(); // path → { key: mtime+size, value: file summary }

const dayOf = (ts) => {
  const d = new Date(ts);
  return isNaN(d) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function listJsonl(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

async function cached(file, parse) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = `${st.mtimeMs}:${st.size}`;
  const hit = fileCache.get(file);
  if (hit && hit.key === key) return hit.value;
  let value = null;
  try { value = parse(await fs.promises.readFile(file, 'utf8')); } catch {}
  fileCache.set(file, { key, value });
  return value;
}

// Claude Code: one line per message; streamed messages repeat with the same id.
function parseClaude(text) {
  const seen = new Set();
  const days = {};
  let cwd = null, session = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const u = d.message?.usage;
    if (d.type !== 'assistant' || !u) continue;
    const id = d.message.id || d.requestId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    cwd = d.cwd || cwd; session = d.sessionId || session;
    const day = dayOf(d.timestamp);
    if (!day) continue;
    const r = days[day] || (days[day] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, messages: 0 });
    r.input += u.input_tokens || 0;
    r.output += u.output_tokens || 0;
    r.cacheRead += u.cache_read_input_tokens || 0;
    r.cacheWrite += u.cache_creation_input_tokens || 0;
    r.messages++;
  }
  return { cwd, session, days };
}

// Codex: the session's last token_count carries the running total (input includes the cached part).
function parseCodex(text) {
  let cwd = null, first = null, total = null, messages = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (!first) { try { first = JSON.parse(line).timestamp; } catch {} }
    if (!cwd && line.includes('"session_meta"')) { try { cwd = JSON.parse(line).payload?.cwd || null; } catch {} }
    if (line.includes('"token_count"')) {
      try { const t = JSON.parse(line).payload?.info?.total_token_usage; if (t) { total = t; messages++; } } catch {}
    }
  }
  const day = dayOf(first);
  if (!total || !day) return { cwd, days: {} };
  const cacheRead = total.cached_input_tokens || 0;
  return {
    cwd,
    days: { [day]: {
      input: Math.max(0, (total.input_tokens || 0) - cacheRead), output: total.output_tokens || 0,
      cacheRead, cacheWrite: total.cache_write_input_tokens || 0, messages,
    } },
  };
}

// Finished tasks can be cleared from the board, so a separate history keeps them.
function mergeTaskHistory(file, tasks = []) {
  let hist = {};
  try { hist = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  for (const t of tasks) {
    if (!t?.id) continue;
    const prev = hist[t.id] || {};
    hist[t.id] = {
      ...prev, agent: t.assigned || t.agent || prev.agent, status: t.status, light: !!t.light, cwd: t.cwd || prev.cwd || null,
      createdAt: t.createdAt || prev.createdAt, startedAt: t.startedAt || prev.startedAt,
      finishedAt: t.finishedAt || prev.finishedAt, sessionId: t.sessionId || prev.sessionId,
    };
  }
  try { fs.writeFileSync(file, JSON.stringify(hist), { mode: 0o600 }); } catch {}
  return Object.values(hist);
}

function addInto(acc, r) {
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'messages']) acc[k] = (acc[k] || 0) + (r[k] || 0);
  return acc;
}

// claudeDirs: the default Claude folder plus the extra accounts' folders.
async function scanUsage({ tasks, historyFile, claudeDirs = [], codexDir }) {
  const sources = [
    { agent: 'claude', files: [...new Set(claudeDirs)].flatMap((d) => listJsonl(path.join(d, 'projects'))), parse: parseClaude },
    { agent: 'codex', files: codexDir ? listJsonl(path.join(codexDir, 'sessions')) : [], parse: parseCodex },
  ];
  const days = {};          // day → { tokens, sessions, tasks }
  const byAgent = {};       // agent → totals
  const byProject = {};     // cwd → tokens
  const projectDays = {};   // cwd → day → tokens (cost history per project)
  const sessionTokens = {}; // Claude sessionId → tokens (for tokens per task)

  for (const src of sources) {
    for (const f of src.files) {
      const s = await cached(f, src.parse);
      if (!s) continue;
      const tot = byAgent[src.agent] || (byAgent[src.agent] = { sessions: 0 });
      let fileTokens = 0;
      for (const [day, r] of Object.entries(s.days)) {
        addInto(tot, r);
        const t = r.input + r.output + r.cacheRead + r.cacheWrite;
        fileTokens += t;
        const dd = days[day] || (days[day] = { tokens: 0, sessions: 0, tasks: 0 });
        dd.tokens += t; dd.sessions++;
        if (s.cwd && t) { const pd = projectDays[s.cwd] || (projectDays[s.cwd] = {}); pd[day] = (pd[day] || 0) + t; }
      }
      if (!fileTokens) continue;
      tot.sessions++;
      if (s.cwd) byProject[s.cwd] = (byProject[s.cwd] || 0) + fileTokens;
      if (s.session) sessionTokens[s.session] = (sessionTokens[s.session] || 0) + fileTokens;
    }
  }

  const hist = mergeTaskHistory(historyFile, tasks);
  const taskStats = { total: hist.length, done: 0, blocked: 0, light: 0, durations: [], tokensPerTask: [], byAgent: {} };
  for (const t of hist) {
    if (t.light) taskStats.light++;
    if (t.status === 'done' || t.status === 'blocked') {
      taskStats[t.status]++;
      const a = taskStats.byAgent[t.agent] || (taskStats.byAgent[t.agent] = { done: 0, blocked: 0 });
      a[t.status]++;
      if (t.startedAt && t.finishedAt > t.startedAt) taskStats.durations.push(t.finishedAt - t.startedAt);
      const day = dayOf(t.finishedAt);
      if (day && t.status === 'done') (days[day] || (days[day] = { tokens: 0, sessions: 0, tasks: 0 })).tasks++;
    }
    if (t.sessionId && sessionTokens[t.sessionId]) taskStats.tokensPerTask.push(sessionTokens[t.sessionId]);
  }

  return {
    days, byAgent, taskStats, projectDays,
    byProject: Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cwd, tokens]) => ({ cwd, tokens })),
  };
}

// Tokens used so far by specific Claude sessions (a running task's card), found by file name
// (<claude dir>/projects/<project>/<session id>.jsonl), so a task's cost can be shown live.
async function sessionTokens({ claudeDirs = [], ids = [] }) {
  const want = new Set(ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)));
  const out = {};
  if (!want.size) return out;
  for (const dir of new Set(claudeDirs)) {
    let projects = [];
    try { projects = fs.readdirSync(path.join(dir, 'projects'), { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
    for (const p of projects) {
      for (const id of want) {
        const s = await cached(path.join(dir, 'projects', p.name, `${id}.jsonl`), parseClaude);
        if (!s) continue;
        const total = Object.values(s.days).reduce((n, r) => n + r.input + r.output + r.cacheRead + r.cacheWrite, 0);
        out[id] = (out[id] || 0) + total;
      }
    }
  }
  return out;
}

module.exports = { scanUsage, sessionTokens };
