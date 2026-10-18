// Usage and savings: activity per day (GitHub style), tokens per subscription and task effectiveness.
let usageMetric = 'tokens';
let usageData = null;

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

function renderUsage() {
  const { days, byAgent, byProject, taskStats: ts } = usageData;
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
  const maxP = byProject[0]?.tokens || 1;
  const projRows = byProject.map((p) => `<div class="u-bar"><span class="u-name" title="${esc(p.cwd)}">${esc(basename(p.cwd))}</span>
    <span class="u-track"><span style="width:${(p.tokens / maxP) * 100}%"></span></span><span class="u-val">${fmt.count(p.tokens)}</span></div>`).join('');

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
    ${projRows ? `<h3>By Project</h3><div class="rows">${projRows}</div>` : ''}
    <p class="muted small">Read from the Claude Code and Codex logs on this computer; nothing leaves it.
      Savings are an estimate: a cache read costs about 10% of normal input.</p>`;
  $('#usageMetric').onclick = (e) => { const k = e.target.closest('button')?.dataset.k; if (k) { usageMetric = k; renderUsage(); } };
}

$('#usageBtn').onclick = openUsage;
$('#usageRefresh').onclick = openUsage;
