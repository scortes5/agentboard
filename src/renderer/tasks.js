// AgentBoard — task list (to-dos) spread across your subscriptions.
// Each task runs in a new agent session (clean context = fewer tokens), several at
// once, and marks itself when the agent prints "DONE:" or calls complete_task.
'use strict';
/* global ab, cfg, $, esc, uid, basename, clamp, isMac, runtime, cardData, agentOf, newCard, focusCardView, focusCard, closeCard, closePopover, openPopover,
   ensureGroup, slotIn, looseSpot, terminalTail, toast, save, agentAvailable, visibleRect, applyViewport, drawMinimap, projectOfPath, icon,
   diagramOpen, toggleDiagram, STATUS_LABEL, openSkills */

const STATUS = {
  pending: 'Queued',
  running: 'Working',
  review: 'Needs your review',
  done: 'Done',
  blocked: 'Blocked',
};
const IDLE_REVIEW_MS = 20000;   // running → review when the agent stays quiet this long
const taskRt = new Map();       // id -> { lastBusy, dispatching }
const lastAssigned = {};        // agent -> timestamp (tie-breaker when spreading tasks)
let taskFilter = 'active';

// ---------- Data ----------
function tasks() { return cfg.tasks || (cfg.tasks = []); }
const runningOf = (key) => tasks().filter((t) => t.status === 'running' && t.assigned === key).length;
const subscriptions = () => Object.entries(cfg.agents).filter(([k, a]) => a.command && k !== 'shell' && !a.hidden);
function autoAgents() {
  if (!cfg.autoAgents) cfg.autoAgents = ['claude', 'codex', 'gemini'].filter((k) => cfg.agents[k]);
  return cfg.autoAgents.filter((k) => cfg.agents[k]?.command && agentAvailable[k] !== false);
}
function agentKeyFrom(word) {
  const w = String(word || '').toLowerCase();
  if (!w || w === 'auto') return 'auto';
  return Object.keys(cfg.agents).find((k) => k === w || (cfg.agents[k].label || '').toLowerCase() === w
    || (cfg.agents[k].label || '').toLowerCase().split(/\s+/)[0] === w) || null;
}
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function projectFrom(word) {
  const w = slug(word);
  return cfg.projects.find((p) => slug(p.name) === w || slug(basename(p.path)) === w) || null;
}

// "@codex fix login #backend +web !"  →  { text, agent, group, cwd, light, heavy }
function parseLine(line, defaults) {
  const t = { agent: defaults.agent, cwd: defaults.cwd, light: defaults.light, heavy: defaults.heavy, group: defaults.group || '' };
  const words = [];
  for (const w of line.trim().split(/\s+/)) {
    let m;
    if ((m = w.match(/^@([\w.-]+)$/)) && agentKeyFrom(m[1])) t.agent = agentKeyFrom(m[1]);
    else if ((m = w.match(/^#([\p{L}\p{N}_-]+)$/u))) t.group = m[1].replace(/-/g, ' ');
    else if ((m = w.match(/^\+([\p{L}\p{N}._-]+)$/u)) && projectFrom(m[1])) t.cwd = projectFrom(m[1]).path;
    else if (w === '!' || /^!(light|quick|fast)$/i.test(w)) { t.light = true; t.heavy = false; }
    else if (w === '!!' || /^!(heavy|strong)$/i.test(w)) { t.heavy = true; t.light = false; }
    else words.push(w);
  }
  t.text = words.join(' ').replace(/^[-*•]\s+|^\[\s?\]\s+|^\d+[.)]\s+/, '').trim();
  return t;
}

function addTask(fields) {
  const t = {
    id: uid(), text: fields.text, status: 'pending', agent: fields.agent || 'auto',
    cwd: fields.cwd ?? cfg.selectedProject ?? null, group: fields.group || '', light: !!fields.light, heavy: !!fields.heavy && !fields.light,
    worktree: fields.worktree ?? null, from: fields.from || null, createdAt: Date.now(),
  };
  tasks().push(t);
  save(); renderTasks();
  return t;
}

// ---------- Dispatch ----------
// Subscriptions that hit their usage limit get no tasks until it renews.
function exhaustedUntil(key) {
  const until = cfg.exhausted?.[key];
  if (!until) return 0;
  if (Date.now() > until) { delete cfg.exhausted[key]; save(); return 0; }
  return until;
}

// Subscription for a task: the chosen one or, with "auto", the one running the fewest
// tasks (ties go to the one idle the longest). Respects the per-subscription limit.
function pickAgent(t) {
  const per = cfg.perAgentParallel || 2;
  if (t.agent && t.agent !== 'auto') {
    return cfg.agents[t.agent]?.command && runningOf(t.agent) < per && !exhaustedUntil(t.agent) ? t.agent : null;
  }
  const cands = autoAgents().filter((k) => runningOf(k) < per && !exhaustedUntil(k));
  if (!cands.length) return null;
  cands.sort((a, b) => runningOf(a) - runningOf(b) || (lastAssigned[a] || 0) - (lastAssigned[b] || 0));
  return cands[0];
}

// Whether this subscription's CLI has the AgentBoard tools (MCP) registered, so it can open
// subagents that show up on the board. Refreshed when tasks start; Settings registers it.
let bridgeConnected = {};
async function refreshBridgeStatus() {
  try { bridgeConnected = (await ab.bridgeStatus())?.connected || {}; } catch { bridgeConnected = {}; }
  return bridgeConnected;
}
function canOpenSubagents(key) {
  if (cfg.taskSubagents === false) return false;
  const cli = (cfg.agents[key]?.command || '').trim().split(/\s+/)[0].split(/[\\/]/).pop().replace(/\.(cmd|exe)$/i, '');
  return !!(bridgeConnected[key] || bridgeConnected[cli]);
}

function taskPrompt(t, subagents = false) {
  const max = cfg.maxSubagents || 4;
  return `[AgentBoard task ${t.id}] ${t.text}\n`
    + '(Only this, keep it short; use the agentboard-task skill if you have it. When finished, call complete_task if available and end with the line «DONE: …» or «BLOCKED: …».)'
    + (subagents && !t.light
      ? `\n(If the task has parts that can be done at the same time, split it: open up to ${max} helpers with the AgentBoard tool start_agent — light=true for simple parts, each with a self-contained message — so they work in parallel on the user's board next to you. Follow them with read_agent_output, check and combine their work, then write your own DONE line. Do not split small tasks.)`
      : '');
}

async function startTask(t, key) {
  const a = cfg.agents[key];
  t.status = 'running'; t.assigned = key; t.startedAt = Date.now(); t.summary = '';
  lastAssigned[key] = Date.now();
  taskRt.set(t.id, { lastBusy: Date.now(), dispatching: true });
  save(); renderTasks();

  let cwd = t.cwd || cfg.selectedProject || null;
  const wantWorktree = t.worktree ?? cfg.taskWorktrees;
  if (wantWorktree && cwd) {
    const r = await ab.gitWorktree(cwd, t.text.split(/\s+/).slice(0, 5).join(' '));
    if (r.ok) { cwd = r.value.dir; t.branch = r.value.branch; t.workdir = r.value.dir; }
    else toast(`No worktree for this task (${esc(r.error)}); using the project folder.`, 5000);
  }
  const g = t.group ? ensureGroup(t.group, projectOfPath(t.cwd || cfg.selectedProject || '')) : null;
  const pos = g ? slotIn(g) : looseSpot();
  const title = t.text.length > 34 ? t.text.slice(0, 32).trim() + '…' : t.text;
  await refreshBridgeStatus();
  const card = newCard('term', key, {
    cwd, title, args: t.light ? (a.lightArgs || '') : t.heavy ? (a.heavyArgs || '') : '', prompt: taskPrompt(t, canOpenSubagents(key)), taskId: t.id, noFocus: true, ...pos,
  });
  if (!card) { t.status = 'pending'; taskRt.delete(t.id); save(); renderTasks(); return; }
  t.cardId = card.id;
  save(); renderTasks();
  setTimeout(() => { const rt = taskRt.get(t.id); if (rt) rt.dispatching = false; }, 4000);
  toast(`Task → <b>${esc(a.label)}</b>${g ? ` in ${esc(g.title)}` : ''}: ${esc(title)}`);
}

// onlyFlows: with "Run queue" off, automation steps still run
function dispatchQueued(onlyFlows = false) {
  let slots = (cfg.maxParallel || 3) - tasks().filter((t) => t.status === 'running').length;
  for (const t of tasks()) {
    if (slots <= 0) break;
    if (t.status !== 'pending' || (onlyFlows && !t.flowRun)) continue;
    const key = pickAgent(t);
    if (!key) continue;
    slots--;
    startTask(t, key);
  }
}

// Look for «DONE: …» / «BLOCKED: …» at the end of the terminal (HECHO/BLOQUEADO from older
// prompts still count). The echo of our own instruction says «DONE: …» and is skipped by the "…".
function findMarker(c) {
  const lines = terminalTail(c, 30).split('\n').reverse();
  for (const line of lines) {
    const m = line.match(/(?:^|[\s●⏺•>*✦│])(DONE|BLOCKED|HECHO|BLOQUEADO):\s*(.+?)\s*$/);
    if (!m || m[2].startsWith('…') || m[2].length < 3) continue;
    return { status: /^(DONE|HECHO)$/.test(m[1]) ? 'done' : 'blocked', text: m[2].slice(0, 300) };
  }
  return null;
}

// "Claude usage limit reached… resets 3pm", "You've hit your usage limit… try again in 2 hours"
const LIMIT_RE = /(usage limit|limit reached|hit your (usage )?limit|rate limit exceeded|quota exceeded|out of (credits|quota))/i;
function findLimit(c) {
  const text = terminalTail(c, 20);
  const line = text.split('\n').reverse().find((l) => LIMIT_RE.test(l) && /(reset|try again|renew|in \d)/i.test(l));
  if (!line) return null;
  let until = Date.now() + 60 * 60_000; // no time given: retry in 1 h
  let m;
  if ((m = line.match(/in\s+(\d+)\s*(h|hours?|m|min|minutes?)\b/i))) {
    until = Date.now() + (+m[1]) * (/^h/i.test(m[2]) ? 3_600_000 : 60_000);
  } else if ((m = line.match(/reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i))) {
    const d = new Date();
    let h = +m[1] % 12 + (/pm/i.test(m[3] || '') ? 12 : 0);
    if (!m[3]) h = +m[1];
    d.setHours(h, +(m[2] || 0), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    until = d.getTime();
  }
  return { until, line: line.trim().slice(0, 160) };
}

// Folder trust prompt (the first time a CLI opens a project or worktree)
const TRUST_RE = /(trust (this folder|the files)|one you trust|Do you trust)/i;

// Answer "yes, I trust it" by moving the selection to the affirmative option.
async function acceptTrust(t) {
  const c = t.cardId && cardData(t.cardId);
  if (!c) return;
  for (let i = 0; i < 4; i++) {
    const lines = terminalTail(c, 12).split('\n');
    const sel = lines.find((l) => /^\s*[❯>]/.test(l)) || '';
    if (/yes|trust|proceed/i.test(sel)) { ab.ptyWrite(c.id, '\r'); break; }
    ab.ptyWrite(c.id, '\x1b[B');
    await new Promise((r) => setTimeout(r, 300));
  }
  t.needsTrust = false;
  renderTasks();
}

function finishTask(t, status, summary) {
  t.status = status; t.summary = summary || t.summary || ''; t.finishedAt = Date.now();
  taskRt.delete(t.id);
  const a = cfg.agents[t.assigned];
  toast(`${status === 'done' ? 'Done' : 'Blocked'} · ${esc(a?.label || '')}: ${esc(t.text.slice(0, 60))}`, 4500);
  if (!document.hasFocus()) {
    try { new Notification(status === 'done' ? 'Task done' : 'Task blocked', { body: `${t.text.slice(0, 80)}\n${t.summary}` }); } catch {}
  }
}

function tickTasks() {
  if (!cfg) return;
  if (cfg.tasksOpen) updateTaskLive();
  let changed = false;
  const now = Date.now();
  for (const t of tasks()) {
    if (t.status !== 'running' && t.status !== 'review') continue;
    const c = t.cardId && cardData(t.cardId);
    const rt = c && runtime.get(c.id);
    if (!c || !rt) { t.status = 'review'; t.summary = t.summary || 'The agent card was closed.'; t.cardId = null; changed = true; continue; }
    const st = taskRt.get(t.id) || { lastBusy: t.startedAt || now };
    taskRt.set(t.id, st);
    if (st.dispatching) continue;
    const m = findMarker(c);
    if (m) { finishTask(t, m.status, m.text); changed = true; continue; }
    const lim = findLimit(c);
    if (lim && t.assigned) {
      // the subscription ran out: back to the queue so another one picks it up
      cfg.exhausted = { ...(cfg.exhausted || {}), [t.assigned]: lim.until };
      const label = cfg.agents[t.assigned]?.label || t.assigned;
      toast(`${esc(label)} hit its usage limit (until ${new Date(lim.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Reassigning the task.`, 6000);
      Object.assign(t, { status: 'pending', cardId: null, assigned: t.agent === 'auto' ? null : t.assigned, summary: `${label}: ${lim.line}` });
      taskRt.delete(t.id);
      changed = true; continue;
    }
    const trust = TRUST_RE.test(terminalTail(c, 14));
    if (trust !== !!t.needsTrust) { t.needsTrust = trust; changed = true; }
    if (rt.status === 'busy') {
      st.lastBusy = now;
      if (t.status === 'review') { t.status = 'running'; changed = true; }
    } else if (t.status === 'running' && (rt.status === 'dead' || now - st.lastBusy > IDLE_REVIEW_MS)) {
      t.status = 'review'; changed = true; // finished, or waiting for something (permission, a question)
    }
  }
  dispatchQueued(!cfg.taskAuto);
  if (changed) { save(); renderTasks(); }
  updateBadge();
}

// ---------- Panel ----------
function updateBadge() {
  const n = tasks().filter((t) => t.status === 'pending' || t.status === 'running' || t.status === 'review').length;
  const review = tasks().filter((t) => t.status === 'review' || t.status === 'blocked').length;
  const b = $('#tasksBadge');
  b.textContent = review ? `${n} · ${review}!` : String(n);
  b.classList.toggle('hidden', !n && !review);
  b.classList.toggle('warn', review > 0);
  ab.setBadge(review);
}

function renderTaskOptions() {
  $('#taskAuto').checked = !!cfg.taskAuto;
  $('#taskParallel').value = cfg.maxParallel || 3;
  $('#taskPerAgent').value = cfg.perAgentParallel || 2;
  $('#taskWorktree').checked = !!cfg.taskWorktrees;
  $('#taskRoute').checked = cfg.taskRoute !== false;
  const auto = new Set(autoAgents());
  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#taskAutoAgents').innerHTML = subscriptions().map(([k, a]) =>
    `<button type="button" data-k="${esc(k)}" class="${auto.has(k) ? 'active' : ''} ${exhaustedUntil(k) ? 'spent' : ''}" title="${agentAvailable[k] === false ? 'Not installed on this computer' : exhaustedUntil(k) ? 'Hit its usage limit; it gets tasks again at that time' : auto.has(k) ? 'Included in automatic spreading; click to exclude it' : 'Not included in automatic spreading; click to include it'}">
      <span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}${exhaustedUntil(k) ? ` <em>until ${time(exhaustedUntil(k))}</em>` : ''}</button>`).join('');
  const sel = $('#taskAgent');
  const prevAgent = sel.value || 'auto';
  sel.innerHTML = '<option value="auto">Auto (spread)</option>'
    + subscriptions().map(([k, a]) => `<option value="${esc(k)}">${esc(a.label)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === prevAgent) ? prevAgent : 'auto';
  const ps = $('#taskProject');
  ps.innerHTML = cfg.projects.map((p) => `<option value="${esc(p.path)}">${esc(p.name)}</option>`).join('') || '<option value="">Home folder</option>';
  ps.value = cfg.selectedProject || cfg.projects[0]?.path || '';
}

function chip(text, cls = '', style = '') { return `<span class="tchip ${cls}" ${style ? `style="${style}"` : ''}>${text}</span>`; }

function renderTasks() {
  const list = $('#taskList');
  if (!list) return;
  const active = (t) => t.status !== 'done';
  const shown = tasks().filter((t) => taskFilter === 'all' || (taskFilter === 'done' ? !active(t) : active(t)));
  const order = { review: 0, blocked: 1, running: 2, pending: 3, done: 4 };
  shown.sort((a, b) => (order[a.status] - order[b.status]) || (taskFilter === 'done' ? (b.finishedAt || 0) - (a.finishedAt || 0) : 0));

  const counts = {};
  for (const t of tasks()) counts[t.status] = (counts[t.status] || 0) + 1;
  $('#taskCounts').textContent = [
    counts.running && `${counts.running} working`, counts.pending && `${counts.pending} queued`,
    (counts.review || counts.blocked) && `${(counts.review || 0) + (counts.blocked || 0)} to review`,
  ].filter(Boolean).join(' · ');

  if (!shown.length) {
    list.innerHTML = `<div class="side-empty">${tasks().length ? 'Nothing here.' : 'Write your to-dos below. Each line is a task; they are spread across your subscriptions and run in parallel.'}</div>`;
    updateBadge();
    return;
  }
  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || '~';
  list.innerHTML = shown.map((t) => {
    const key = t.assigned || t.agent;
    const a = key && key !== 'auto' ? cfg.agents[key] : null;
    const who = a ? chip(esc(a.label), 'agent', `--agent:${esc(a.color)}`) : chip('auto', 'agent');
    const meta = [
      who,
      chip(esc(projName(t.cwd))),
      t.group ? chip(esc(t.group)) : '',
      t.light ? chip('light', 'light') : '',
      t.heavy ? chip('heavy', 'heavy') : '',
      t.branch ? chip(icon('branch', 11) + ' ' + esc(t.branch.replace(/^agentboard\//, '')), 'branch') : '',
      t.from ? chip('from ' + esc(cardData(t.from)?.title || 'an agent')) : '',
      t.flowRun ? chip('automation') : '',
    ].join('');
    const B = (a, ic, tip) => `<button data-a="${a}" title="${tip}">${icon(ic, 14)}</button>`;
    const wt = t.workdir && t.branch ? B('diff', 'diff', 'See its worktree changes and merge or discard them') : '';
    const go = B('go', 'focus', 'Go to the agent card');
    const done = B('done', 'check', 'Mark as done');
    const retry = B('retry', 'refresh', 'Put it back in the queue');
    const del = B('del', 'trash', 'Delete the task');
    const acts = {
      pending: B('top', 'up', 'Move to the top of the queue') + B('run', 'play', 'Run now, without waiting for the queue') + del,
      running: go + done,
      review: wt + go + done,
      blocked: go + retry + done,
      done: wt + retry + del,
    }[t.status];
    return `<div class="task st-${t.status}" data-id="${esc(t.id)}">
      <span class="tdot" title="${STATUS[t.status]}"></span>
      <div class="tmain">
        <div class="ttext" title="Double-click to edit">${esc(t.text)}</div>
        <div class="tmeta">${meta}</div>
        ${t.summary ? `<div class="tsum">${esc(t.summary)}</div>` : ''}
        ${t.status === 'running' || t.status === 'review' ? `<div class="tlive" data-live="${esc(t.id)}"></div>` : ''}
        ${t.needsTrust ? '<div class="tsum warn">It asks whether you trust the folder. <button class="inline" data-a="trust" title="Answer that you trust this folder so the task continues">Trust and Continue</button></div>'
          : t.status === 'review' ? '<div class="tsum warn">The agent is waiting: check whether it finished or asked you something.</div>' : ''}
      </div>
      <div class="tacts">${acts}</div>
    </div>`;
  }).join('');
  updateBadge();
  updateTaskLive();
}

// ---------- Live progress ----------
// Every second while the panel is open: what each running task (and each subagent it
// opened) is doing right now, for how long, and any error line seen in its terminal.
const fmtElapsed = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`; };
const NOISE_RE = /^[\s─━│┃╭╮╰╯┌┐└┘├┤┬┴┼═║>❯›·•*✻✽✢⏺⎿-]*$|^\s*(\? for shortcuts|esc to interrupt|Context left|auto-accept)/i;
function lastLine(c) {
  const lines = terminalTail(c, 14, true).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && !NOISE_RE.test(l));
  return (lines.pop() || '').slice(0, 140);
}
function liveOf(c) {
  const rt = c && runtime.get(c.id);
  if (!rt) return { st: 'dead', label: 'closed', line: '' };
  const st = rt.status || 'idle';
  return { st, label: STATUS_LABEL[st] || st, line: lastLine(c), alert: rt.alert?.line || '' };
}
function updateTaskLive() {
  const els = document.querySelectorAll('#taskList [data-live]');
  const now = Date.now();
  for (const el of els) {
    const t = taskById(el.dataset.live);
    const c = t?.cardId && cardData(t.cardId);
    if (!t || !c) { el.innerHTML = ''; continue; }
    const me = liveOf(c);
    const kids = cfg.cards.filter((k) => k.parent === c.id);
    const sameLine = me.alert && me.alert === me.line;
    el.innerHTML = `<div class="lrow${sameLine ? ' lalert' : ''}"${sameLine ? ` data-go="${esc(c.id)}"` : ''}><span class="status ${me.st}"></span><span class="ltime">${fmtElapsed(now - (t.startedAt || now))}</span><span class="lline">${esc(me.line || me.label)}</span>${sameLine ? icon('alert', 11) : ''}</div>`
      + (me.alert && !sameLine ? `<div class="lrow lalert" data-go="${esc(c.id)}">${icon('alert', 11)}<span class="lline">${esc(me.alert)}</span></div>` : '')
      + kids.map((k) => {
        const s = liveOf(k);
        return `<div class="lrow lkid" data-go="${esc(k.id)}" title="Go to ${esc(k.title)}"><span class="status ${s.st}" style="--agent:${esc(agentOf(k).color)}"></span><span class="lname">${esc(k.title)}</span><span class="lline">${esc(s.alert || s.line || s.label)}</span>${s.alert ? icon('alert', 11) : ''}</div>`;
      }).join('');
  }
  updateProgress();
}
function updateProgress() {
  const bar = $('#taskProgress');
  if (!bar) return;
  const list = tasks();
  const done = list.filter((t) => t.status === 'done').length;
  const running = list.filter((t) => t.status === 'running');
  const errors = running.filter((t) => t.cardId && (runtime.get(t.cardId)?.alert || cfg.cards.some((k) => k.parent === t.cardId && runtime.get(k.id)?.alert))).length;
  const blocked = list.filter((t) => t.status === 'blocked').length;
  const kids = cfg.cards.filter((k) => k.parentTask && runtime.get(k.id)?.alive).length;
  bar.classList.toggle('hidden', !list.length);
  if (!list.length) return;
  $('i', bar).style.width = `${Math.round((done / list.length) * 100)}%`;
  bar.classList.toggle('bad', errors + blocked > 0);
  const noBridge = cfg.taskSubagents !== false && running.length && !Object.values(bridgeConnected).some(Boolean);
  $('span', bar).innerHTML = [
    `${done}/${list.length} done`, running.length && `${running.length} working`, kids && `${kids} subagent${kids === 1 ? '' : 's'}`,
    errors && `<b class="bad">${errors} with errors</b>`, blocked && `<b class="bad">${blocked} blocked</b>`,
  ].filter(Boolean).join(' · ') + (noBridge ? ' · <button class="inline" data-x="connect" title="Register AgentBoard in your CLIs so task agents can open subagents you can see">Enable subagents</button>' : '');
}

function taskById(id) { return tasks().find((t) => t.id === id); }

$('#taskList').addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]')?.dataset.go;
  const gc = go && cardData(go);
  if (gc) { if (diagramOpen()) toggleDiagram(false); focusCardView(gc); focusCard(gc.id); return; }
  const row = e.target.closest('.task');
  const act = e.target.closest('[data-a]')?.dataset.a;
  if (!row || !act) return;
  const t = taskById(row.dataset.id);
  if (!t) return;
  if (act === 'run') {
    const key = t.agent !== 'auto' ? t.agent : (pickAgent(t) || autoAgents()[0]);
    if (!key) return toast('No subscriptions are available for "auto". Enable them above.');
    startTask(t, key);
  } else if (act === 'del') {
    cfg.tasks = tasks().filter((x) => x !== t); save(); renderTasks();
  } else if (act === 'go') {
    const c = t.cardId && cardData(t.cardId);
    if (c) { if (diagramOpen()) toggleDiagram(false); focusCardView(c); focusCard(c.id); }
  } else if (act === 'done') {
    finishTask(t, 'done', t.summary || 'Marked by hand.'); save(); renderTasks();
  } else if (act === 'trust') {
    acceptTrust(t);
  } else if (act === 'top') {
    cfg.tasks = [t, ...tasks().filter((x) => x !== t)]; save(); renderTasks();
  } else if (act === 'diff') {
    worktreeMenu(t, e.target.closest('button'));
  } else if (act === 'retry') {
    Object.assign(t, { status: 'pending', cardId: null, assigned: null, summary: '', finishedAt: null });
    save(); renderTasks();
  }
});

$('#taskList').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.ttext');
  const t = el && taskById(el.closest('.task').dataset.id);
  if (!t || t.status !== 'pending') return;
  el.contentEditable = 'true'; el.focus();
  document.getSelection().selectAllChildren(el);
  const done = () => { el.contentEditable = 'false'; t.text = el.textContent.trim() || t.text; save(); renderTasks(); };
  el.addEventListener('blur', done, { once: true });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); el.blur(); } });
});

// Review what a task did in its worktree and merge it (or discard it).
async function worktreeMenu(t, anchor) {
  closePopover();
  const r = await ab.worktreeInfo(t.workdir, t.branch);
  const pop = document.createElement('div');
  pop.className = 'popover edit wt';
  if (!r.ok) {
    pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`;
    openPopover(pop, anchor, 300);
    return;
  }
  const v = r.value;
  const nothing = !v.commits && !v.uncommitted;
  pop.innerHTML = `
    <label>Branch <code>${esc(v.branch)}</code> → <code>${esc(v.base)}</code></label>
    <div class="hint">${v.commits} commit${v.commits === 1 ? '' : 's'}${v.uncommitted ? ` · ${v.uncommitted} uncommitted file${v.uncommitted === 1 ? '' : 's'} (committed when merging)` : ''}</div>
    <pre class="stat">${esc(v.stat || 'No changes.')}</pre>
    <div class="row">
      <button data-x="open" title="Open the worktree folder">Open Folder</button>
      <button data-x="discard" title="Delete the worktree and its branch">Discard</button>
      <button data-x="merge" class="primary" ${nothing ? 'disabled' : ''} title="Commit pending changes, merge into ${esc(v.base)} and remove the worktree">Merge into ${esc(v.base)}</button>
    </div>`;
  openPopover(pop, anchor, 420);
  pop.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'open') ab.openPath(t.workdir);
    if (x === 'discard') {
      if (!confirm(`Discard the work of "${t.text.slice(0, 60)}"? The worktree and the branch ${v.branch} are deleted.`)) return;
      const d = await ab.worktreeDiscard(t.workdir, t.branch);
      closePopover();
      if (!d.ok) return toast(esc(d.error), 6000);
      t.workdir = null; t.branch = null; save(); renderTasks();
      toast('Worktree discarded.');
    }
    if (x === 'merge') {
      const m = await ab.worktreeMerge(t.workdir, t.branch, `${t.text.slice(0, 120)}\n\nAgentBoard task`);
      closePopover();
      if (!m.ok) return toast(esc(m.error), 8000);
      const c = t.cardId && cardData(t.cardId);
      if (c) closeCard(c);
      t.workdir = null; t.mergedInto = m.value.base;
      if (t.status !== 'done') finishTask(t, 'done', t.summary || 'Merged.');
      save(); renderTasks();
      toast(`Merged into <b>${esc(m.value.base)}</b>`, 4000);
    }
  });
}

// Markdown summary of today's work, to paste into a standup, a commit or an email.
function dailySummary() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const done = tasks().filter((t) => t.status === 'done' && (t.finishedAt || 0) >= start.getTime());
  const open = tasks().filter((t) => t.status !== 'done');
  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || '~';
  const line = (t) => `- ${t.status === 'done' ? '[x]' : '[ ]'} ${t.text}${t.summary ? ` — ${t.summary}` : ''} _(${[cfg.agents[t.assigned]?.label, projName(t.cwd), t.mergedInto ? `merged into ${t.mergedInto}` : t.branch].filter(Boolean).join(' · ')})_`;
  const md = [`## ${start.toLocaleDateString()} — AgentBoard`, '', `### Done (${done.length})`, ...done.map(line),
    '', `### Pending (${open.length})`, ...open.map(line)].join('\n');
  ab.copy(md);
  toast(`Summary copied: ${done.length} done, ${open.length} pending.`);
}

function composerDefaults() {
  return { agent: $('#taskAgent').value || 'auto', cwd: $('#taskProject').value || null, light: $('#taskLight').checked };
}

// Routing: haiku (one short call, no terminal) splits what you wrote into independent
// tasks and picks a subscription and model for each; the queue then runs them in parallel.
const canRoute = () => cfg.taskRoute !== false && agentAvailable.claude !== false && !!cfg.agents.claude?.command;

function addPlanned(list, d) {
  for (const x of list) {
    const proj = x.project && projectFrom(x.project);
    const light = !!x.light || d.light;
    const agent = agentKeyFrom(x.agent);
    addTask({ text: x.text.trim(), agent: agent && agent !== 'auto' ? agent : d.agent, cwd: proj ? proj.path : d.cwd, light, heavy: !!x.heavy && !light, group: (x.group || '').trim() });
  }
}

async function addFromComposer() {
  const input = $('#taskInput');
  const text = input.value.trim();
  if (!text) return;
  if (!canRoute()) return addLines(text);
  const btn = $('#taskAdd');
  if (btn.disabled) return;
  btn.disabled = true; btn.textContent = 'Routing…';
  const r = await ab.planTasks(text, { agents: subscriptions().map(([k]) => k), projects: cfg.projects.map((p) => p.name) });
  btn.disabled = false; btn.textContent = 'Add';
  if (input.value.trim() === text) input.value = '';
  if (!r.ok || !r.value.length) {
    toast(`Could not route with haiku (${esc(r.error || 'empty answer')}); added the lines as they are.`, 6000);
    return addLines(text);
  }
  addPlanned(r.value, composerDefaults());
  toast(`haiku routed it into ${r.value.length} task${r.value.length === 1 ? '' : 's'}${cfg.taskAuto ? ' running in parallel' : ' — turn on "Run queue" to start them'}`);
  tickTasks();
}

function addLines(text) {
  const input = $('#taskInput');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const d = composerDefaults();
  // a line with only #group / @agent and no text applies to the following lines
  let carry = {};
  let n = 0;
  for (const line of lines) {
    const t = parseLine(line, { ...d, ...carry });
    if (!t.text) { carry = { agent: t.agent, group: t.group, cwd: t.cwd, light: t.light }; continue; }
    addTask(t); n++;
  }
  input.value = '';
  toast(`${n} task${n === 1 ? '' : 's'} queued${cfg.taskAuto ? '' : ' — turn on "Run queue" or run them one by one'}`);
  tickTasks();
}

async function planWithAI() {
  const input = $('#taskInput');
  const text = input.value.trim();
  if (!text) return toast('Write your to-dos first; Claude (haiku) splits them into tasks.');
  const btn = $('#taskPlan');
  btn.disabled = true; btn.textContent = 'Splitting…';
  const r = await ab.planTasks(text, { agents: subscriptions().map(([k]) => k), projects: cfg.projects.map((p) => p.name) });
  btn.disabled = false; btn.textContent = 'Split';
  if (!r.ok) return toast(`Could not split with Claude: ${esc(r.error)}`, 6000);
  addPlanned(r.value, composerDefaults());
  input.value = '';
  toast(`${r.value.length} tasks created with haiku`);
}

function toggleTasks(force) {
  cfg.tasksOpen = force ?? !cfg.tasksOpen;
  document.body.classList.toggle('tasks-open', !!cfg.tasksOpen);
  if (cfg.tasksOpen) { renderTaskOptions(); renderTasks(); setTimeout(() => $('#taskInput').focus(), 50); }
  drawMinimap(); save();
}

function openTasks(prefill = '') {
  toggleTasks(true);
  const input = $('#taskInput');
  if (prefill && !input.value.startsWith(prefill)) input.value = prefill + input.value;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ---------- Bridge: agents can add and finish tasks ----------
ab.onBridgeAsk(({ reqId, kind, payload }) => {
  let value = null;
  try {
    if (kind === 'task-add') {
      const agent = agentKeyFrom(payload.agent);
      if (!agent) throw new Error(`Unknown agent. Options: auto, ${subscriptions().map(([k]) => k).join(', ')}`);
      const caller = payload.from && cardData(payload.from);
      const proj = payload.project ? projectFrom(payload.project) : null;
      if (payload.project && !proj) throw new Error(`Unknown project. Options: ${cfg.projects.map((p) => p.name).join(', ')}`);
      const t = addTask({
        text: payload.text, agent, light: payload.light, group: payload.group || (caller ? (cardData(caller.groupId)?.title || '') : ''),
        cwd: proj ? proj.path : caller ? projectOfPath(caller.cwd) : cfg.selectedProject, from: payload.from,
      });
      value = { id: t.id, agent: agent === 'auto' ? 'the least busy subscription' : cfg.agents[agent].label };
      setTimeout(tickTasks, 50);
    } else if (kind === 'task-done') {
      const t = payload.id ? taskById(payload.id)
        : tasks().find((x) => x.cardId === payload.card && (x.status === 'running' || x.status === 'review'))
          || tasks().find((x) => x.cardId === payload.card && x.status !== 'done');
      if (!t) throw new Error('No task is assigned to this agent.');
      finishTask(t, payload.blocked ? 'blocked' : 'done', payload.summary);
      save(); renderTasks();
      value = { text: t.text, status: t.status };
    }
  } catch (err) {
    value = { error: err.message };
  }
  ab.bridgeAnswer(reqId, value);
});

// ---------- Startup ----------
function initTasks() {
  if (cfg.taskAuto == null) cfg.taskAuto = true;
  // tasks left "running" at quit: their card resumes; if the card is gone, send them to review
  for (const t of tasks()) if (t.status === 'running' && (!t.cardId || !cardData(t.cardId))) t.status = 'review';
  document.body.classList.toggle('tasks-open', !!cfg.tasksOpen);
  renderTaskOptions();
  renderTasks();
  refreshBridgeStatus().then(updateProgress);
  setInterval(tickTasks, 1000);
  $('#taskProgress').addEventListener('click', (e) => { if (e.target.closest('[data-x="connect"]')) openSkills('connect'); });

  $('#tasksClose').onclick = () => toggleTasks(false);
  $('#taskAdd').onclick = addFromComposer;
  $('#taskPlan').onclick = planWithAI;
  $('#taskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addFromComposer(); }
  });
  $('#taskAuto').onchange = (e) => { cfg.taskAuto = e.target.checked; save(); tickTasks(); };
  $('#taskWorktree').onchange = (e) => { cfg.taskWorktrees = e.target.checked; save(); };
  $('#taskRoute').onchange = (e) => { cfg.taskRoute = e.target.checked; save(); };
  $('#taskParallel').onchange = (e) => { cfg.maxParallel = clamp(+e.target.value || 3, 1, 12); e.target.value = cfg.maxParallel; save(); tickTasks(); };
  $('#taskPerAgent').onchange = (e) => { cfg.perAgentParallel = clamp(+e.target.value || 2, 1, 6); e.target.value = cfg.perAgentParallel; save(); tickTasks(); };
  $('#taskAutoAgents').addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    autoAgents();
    cfg.autoAgents = cfg.autoAgents.includes(k) ? cfg.autoAgents.filter((x) => x !== k) : [...cfg.autoAgents, k];
    save(); renderTaskOptions();
  });
  $('#taskFilter').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f) {
      taskFilter = f;
      $('#taskFilter').querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === f));
      renderTasks();
    }
  });
  $('#taskClear').onclick = () => { cfg.tasks = tasks().filter((t) => t.status !== 'done'); save(); renderTasks(); };
  $('#taskSummary').onclick = dailySummary;
}
