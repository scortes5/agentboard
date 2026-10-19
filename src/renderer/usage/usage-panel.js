// Usage and savings: activity per day (GitHub style), tokens per subscription and task effectiveness.
let usageMetric = 'tokens';
let usageData = null;
const sessionView = { agent: 'all', sort: 'recent', all: false }; // the By Session table's filter, order and length
const SESSION_ROWS = 25;

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Claude cards know their sessionId: that is how tokens are counted per task.
function tasksForUsage() {
  return (cfg.tasks || []).map((t) => ({ ...t, sessionId: cfg.cards.find((c) => c.id === t.cardId)?.sessionId }));
}

async function openUsage() {
  if (!$('#usage').open) $('#usage').showModal();
  $('#usageBody').innerHTML = '<p class="muted small">Reading your CLIs\' logs…</p>';
  const r = await ab.usageScan(tasksForUsage());
  if (!r.ok) { $('#usageBody').innerHTML = `<p class="muted small">Could not read usage: ${esc(r.error)}</p>`; return; }
  usageData = r.value;
  renderUsage();
}

function heatmap(days, metric) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = new Date(today); start.setDate(start.getDate() - 52 * 7 - today.getDay()); // 53 weeks, starting on Sunday
  const vals = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) vals.push({ key: dayKey(d), v: days[dayKey(d)]?.[metric] || 0, month: d.getMonth(), date: d.getDate() });
  const max = Math.max(1, ...vals.map((x) => x.v));
  const level = (v) => v === 0 ? 0 : Math.min(4, 1 + Math.floor((Math.log(v + 1) / Math.log(max + 1)) * 3.999));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const unit = { tokens: 'tokens', sessions: 'sessions', tasks: 'tasks done' }[metric];
  let cols = '', labels = '';
  for (let w = 0; w * 7 < vals.length; w++) {
    const week = vals.slice(w * 7, w * 7 + 7);
    const first = week.find((x) => x.date === 1);
    labels += `<span>${first ? months[first.month] : ''}</span>`;
    cols += `<div class="hm-col">${week.map((x) => `<i class="l${level(x.v)}" title="${x.key}: ${fmt.count(x.v)} ${unit}"></i>`).join('')}</div>`;
  }
  const active = vals.filter((x) => x.v > 0).length;
  let streak = 0; for (let i = vals.length - 1; i >= 0 && vals[i].v > 0; i--) streak++;
  let best = 0, run = 0; for (const x of vals) { run = x.v > 0 ? run + 1 : 0; best = Math.max(best, run); }
  return `<div class="hm"><div class="hm-months">${labels}</div><div class="hm-grid">${cols}</div></div>
    <div class="hm-foot muted small"><span>${active} active days · current streak ${streak} · best streak ${best}</span>
    <span class="hm-legend">less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> more</span></div>`;
}

// Each project's tokens today, this week and this month, with its last 30 days as small bars.
function costByProject(rows, perToken) {
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.flatMap((r) => r.last30.map((d) => d.tokens)));
  return `<table class="u-cost"><thead><tr><th>Project</th><th>Today</th><th>This week</th><th>This month</th><th title="At the API prices in Settings → Tasks; with a subscription you don't pay per token">≈ API price</th><th>Last 30 days</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td title="${esc(r.path)}">${esc(r.name)}</td><td>${fmt.count(r.today)}</td><td>${fmt.count(r.week)}</td><td>${fmt.count(r.month)}</td><td>${CostEstimate.fmt(r.month * perToken)}</td>
      <td><span class="spark">${r.last30.map((d) => `<i style="height:${Math.max(d.tokens ? 8 : 0, Math.round((d.tokens / max) * 100))}%" title="${esc(d.day)}: ${fmt.count(d.tokens)}"></i>`).join('')}</span></td></tr>`).join('')}
  </tbody></table>`;
}

// One row per CLI session, so you can see which conversations cost the most. A Claude session
// that a card or a task ran is named after it; the rest show their project.
function sessionsTable(list) {
  if (!list?.length) return '';
  const label = (s) => (cfg.agents[s.agent]?.label || s.agent) + (s.account ? ` · ${s.account}` : '');
  const owner = (s) => (s.id && (cfg.cards.find((c) => c.sessionId === s.id)?.title || tasks().find((t) => t.sessionId === s.id)?.text)) || '';
  const agents = [...new Set(list.map((s) => s.agent))];
  if (!agents.includes(sessionView.agent)) sessionView.agent = 'all';
  let rows = list.filter((s) => sessionView.agent === 'all' || s.agent === sessionView.agent);
  if (sessionView.sort === 'tokens') rows = [...rows].sort((a, b) => b.tokens - a.tokens);
  const shown = sessionView.all ? rows : rows.slice(0, SESSION_ROWS);
  const when = (ts) => (ts ? `${new Date(ts).toLocaleDateString()} ${fmt.clock(ts)}` : '—');
  const seg = (key, opts) => `<div class="seg" data-sv="${key}">${opts.map(([v, l, tip]) =>
    `<button type="button" data-v="${esc(v)}" class="${sessionView[key] === v ? 'active' : ''}" title="${esc(tip)}">${esc(l)}</button>`).join('')}</div>`;
  return `<div class="u-sess-head">
      ${seg('agent', [['all', 'All', 'Sessions of every subscription'], ...agents.map((a) => [a, cfg.agents[a]?.label || a, `Only ${cfg.agents[a]?.label || a} sessions`])])}
      ${seg('sort', [['recent', 'Recent', 'Most recently used first'], ['tokens', 'Most Tokens', 'The most expensive sessions first']])}
    </div>
    <table class="u-cost u-sess"><thead><tr><th>Subscription</th><th>Card or project</th><th>Last used</th><th title="Answers in the session">Turns</th>
      <th title="Every token of the session: input, cache reads and writes, and output">Tokens</th>
      <th title="What the last answer had to read. It is paid again on every turn, so a big number means /compact or a new session would save tokens">Context</th></tr></thead><tbody>
    ${shown.map((s) => {
      const name = owner(s);
      return `<tr><td>${esc(label(s))}</td><td title="${esc(s.cwd || '')}">${esc(name || basename(s.cwd || '') || '—')}${name && s.cwd ? ` <span class="muted">${esc(basename(s.cwd))}</span>` : ''}</td>
        <td>${when(s.last)}</td><td>${s.messages}</td>
        <td title="Input ${fmt.count(s.input)} · cache read ${fmt.count(s.cacheRead)} · cache write ${fmt.count(s.cacheWrite)} · output ${fmt.count(s.output)}">${fmt.count(s.tokens)}</td>
        <td class="${s.context >= CONTEXT_WARN ? 'warn' : ''}">${s.context ? fmt.count(s.context) : '—'}</td></tr>`;
    }).join('')}
    </tbody></table>
    ${rows.length > SESSION_ROWS ? `<button type="button" class="ghost" data-sv-more title="${sessionView.all ? 'Show only the first sessions' : 'Show every session in the list'}">${sessionView.all ? 'Show Fewer' : `Show All ${rows.length}`}</button>` : ''}`;
}

// Progress of every budget set in Settings (all projects and per project).
function budgetStatus(list) {
  return list.map((b) => `<div class="u-bar"><span class="u-name">${esc(b.name)} · ${{ day: 'today', week: 'this week', month: 'this month' }[b.period]}</span>
    <span class="u-track"><span class="${b.ratio >= 1 ? 'bad' : b.ratio >= 0.8 ? 'warn' : ''}" style="width:${Math.min(100, b.ratio * 100)}%"></span></span>
    <span class="u-val">${fmt.count(b.used)} of ${fmt.count(b.limit)} (${Math.round(b.ratio * 100)}%)</span></div>`).join('');
}

function renderUsage() {
  const { days, byAgent, taskStats: ts } = usageData;
  const sum = (k) => Object.values(byAgent).reduce((s, a) => s + (a[k] || 0), 0);
  const input = sum('input'), output = sum('output'), cacheRead = sum('cacheRead'), cacheWrite = sum('cacheWrite');
  const total = input + output + cacheRead + cacheWrite;
  const promptTotal = input + cacheRead + cacheWrite;
  const hitRate = promptTotal ? cacheRead / promptTotal : 0;
  // A cache read costs about 10% of a normal input token: the other 90% is saved.
  const saved = cacheRead * 0.9;
  const finished = ts.done + ts.blocked;
  const tile = (label, value, sub = '') => `<div class="u-tile"><span class="eyebrow">${label}</span><b>${value}</b><span class="muted small">${sub}</span></div>`;

  const agentRows = Object.entries(byAgent).map(([k, a]) => {
    const t = a.input + a.output + a.cacheRead + a.cacheWrite;
    const color = cfg.agents[k]?.color || 'var(--accent)';
    const done = ts.byAgent[k];
    return `<div class="u-bar"><span class="u-name"><i style="background:${esc(color)}"></i>${esc(cfg.agents[k]?.label || k)}</span>
      <span class="u-track"><span style="width:${total ? (t / total) * 100 : 0}%;background:${esc(color)}"></span></span>
      <span class="u-val">${fmt.count(t)} · ${a.sessions} sessions${done ? ` · ${done.done} done, ${done.blocked} blocked` : ''}</span></div>`;
  }).join('') || '<p class="muted small">No Claude Code or Codex logs on this computer.</p>';
  budgets.update(usageData);
  const perToken = CostEstimate.perToken(byAgent);
  const projRows = costByProject(budgets.projectRows(), perToken);
  const budgetRows = budgetStatus(budgets.status());

  $('#usageBody').innerHTML = `
    <div class="u-head"><div id="usageMetric" class="seg">
      ${[['tokens', 'Tokens', 'Color each day by tokens used'], ['sessions', 'Sessions', 'Color each day by agent sessions'], ['tasks', 'Tasks Done', 'Color each day by tasks finished']]
        .map(([k, l, tip]) => `<button type="button" data-k="${k}" class="${k === usageMetric ? 'active' : ''}" title="${tip}">${l}</button>`).join('')}
    </div></div>
    ${heatmap(days, usageMetric)}
    <h3>Usage</h3>
    <div class="u-tiles">
      ${tile('Total tokens', fmt.count(total), `${fmt.count(output)} generated`)}
      ${tile('Sessions', sum('sessions'), `${sum('messages')} answers`)}
      ${tile('Tasks', ts.total, `${ts.light} in light mode`)}
      ${tile('At API prices', '≈ ' + CostEstimate.fmt(Object.values(byAgent).reduce((s, a) => s + CostEstimate.of(a), 0)), 'what these tokens would cost without a subscription')}
    </div>
    <h3>Savings and Effectiveness</h3>
    <div class="u-tiles">
      ${tile('Cache savings', '≈ ' + fmt.count(saved), 'input tokens you did not pay in full')}
      ${tile('Cache hit rate', Math.round(hitRate * 100) + '%', 'of the input came from cache')}
      ${tile('Tasks solved', finished ? Math.round((ts.done / finished) * 100) + '%' : '—', `${ts.done} done · ${ts.blocked} blocked`)}
      ${tile('Time per task', ts.durations.length ? fmt.duration(median(ts.durations)) : '—', 'median')}
      ${tile('Tokens per task', ts.tokensPerTask.length ? fmt.count(median(ts.tokensPerTask)) : '—', 'median (Claude tasks)')}
    </div>
    <h3>By Subscription</h3><div class="rows">${agentRows}</div>
    ${usageData.sessions?.length ? `<h3>By Session</h3><div id="usageSessions">${sessionsTable(usageData.sessions)}</div>` : ''}
    ${budgetRows ? `<h3>Budgets</h3><div class="rows">${budgetRows}</div>` : ''}
    ${projRows ? `<h3>Cost by Project</h3>${projRows}` : ''}
    <p class="muted small">Read from the Claude Code and Codex logs on this computer; nothing leaves it.
      Savings are an estimate: a cache read costs about 10% of normal input.</p>`;
  $('#usageMetric').onclick = (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { usageMetric = k; renderUsage(); } };
  const sess = $('#usageSessions');
  if (sess) {
    sess.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sv-more')) sessionView.all = !sessionView.all;
      else { const key = b.closest('[data-sv]')?.dataset.sv; if (!key) return; sessionView[key] = b.dataset.v; sessionView.all = false; }
      sess.innerHTML = sessionsTable(usageData.sessions);
    };
  }
}

$('#usageBtn').onclick = openUsage;
$('#usageRefresh').onclick = openUsage;
