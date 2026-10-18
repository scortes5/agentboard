// AgentBoard — diagram view: packages per project → groups → agents
// (like a UML component diagram), with each agent's task, status, branch and last
// output, and arrows showing who handed work to whom.
'use strict';
/* global cfg, $, esc, basename, runtime, cardData, agentOf, focusCardView, focusCard, terminalTail, gitCache,
   projectOfPath, groupsList, STATUS_LABEL, openTasks, ab, icon */

const links = [];               // { from, to, kind, at } — messages, tasks and agents opened by others
const LINK_TTL = 30 * 60_000;
let dgProject = '*';
let dgTimer = null;

const diagramOpen = () => !$('#diagram').classList.contains('hidden');

function addLink(from, to, kind) {
  if (!from || !to || from === to) return;
  const prev = links.find((l) => l.from === from && l.to === to && l.kind === kind);
  if (prev) prev.at = Date.now(); else links.push({ from, to, kind, at: Date.now() });
}

ab.onBridgeEvent((ev) => {
  if (ev.kind === 'send') addLink(ev.from, ev.to, 'asked');
  else if (ev.kind === 'start') addLink(ev.from, ev.to, 'opened');
  else if (ev.kind === 'read') addLink(ev.from, ev.to, 'reads');
  if (diagramOpen()) renderDiagram();
});

function since(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

function lastLine(c) {
  const lines = terminalTail(c, 14).split('\n').map((l) => l.replace(/[│╭╮╰╯─┃━]+/g, ' ').trim())
    .filter((l) => l.length > 2 && !/^[>\s?]*$/.test(l) && !/^\[(AgentBoard task|Tarea AgentBoard)/.test(l));
  const l = lines.pop() || '';
  return l.length > 110 ? l.slice(0, 108) + '…' : l;
}

function nodeHtml(c) {
  const a = agentOf(c);
  const rt = runtime.get(c.id);
  const st = rt?.status || 'dead';
  const task = (cfg.tasks || []).find((t) => t.cardId === c.id && t.status !== 'done')
    || (cfg.tasks || []).find((t) => t.cardId === c.id);
  const g = gitCache[c.cwd];
  const busyFor = st === 'busy' && rt?.busySince ? ` · ${since(Date.now() - rt.busySince)}` : '';
  const attrs = [
    task ? `<div class="dg-attr"><i>task</i> ${esc(task.text.length > 90 ? task.text.slice(0, 88) + '…' : task.text)}</div>` : '',
    `<div class="dg-attr"><i>status</i> <span class="st-${st}">${STATUS_LABEL[st] || st}${busyFor}</span>${task ? ` · ${esc(task.status)}` : ''}</div>`,
    g ? `<div class="dg-attr"><i>branch</i> ${esc(g.branch)}${g.changes ? ` <span class="dirty">${g.changes} change${g.changes === 1 ? '' : 's'}</span>` : ''}</div>` : '',
    c.args ? `<div class="dg-attr"><i>args</i> <code>${esc(c.args)}</code></div>` : '',
  ].join('');
  const out = lastLine(c);
  return `<button class="dg-node st-${st}" data-id="${esc(c.id)}" style="--agent:${esc(a.color)}" title="Click to go to the card">
    <div class="dg-node-head"><span class="status ${st}"></span><span class="stereo">«${esc(a.label)}»</span></div>
    <div class="dg-node-name">${esc(c.title)}</div>
    <div class="dg-attrs">${attrs}</div>
    ${out ? `<div class="dg-ops">› ${esc(out)}</div>` : ''}
  </button>`;
}

function queueHtml(list, label) {
  if (!list.length || !$('#dgShowTasks').checked) return '';
  const items = list.slice(0, 5).map((t) => {
    const a = t.agent !== 'auto' ? cfg.agents[t.agent] : null;
    return `<li><span class="tdot st-${t.status}"></span>${esc(t.text.length > 70 ? t.text.slice(0, 68) + '…' : t.text)}${a ? ` <em>@${esc(a.label)}</em>` : ''}</li>`;
  }).join('');
  return `<div class="dg-note"><div class="dg-note-title">${esc(label)} · ${list.length}</div><ul>${items}</ul>${list.length > 5 ? `<div class="muted small">+${list.length - 5} more</div>` : ''}</div>`;
}

let dgPressed = false; // do not redraw during a click (the click would be lost)

function renderDiagram() {
  if (dgPressed) return;
  const box = $('#dgContent');
  const showIdle = $('#dgShowIdle').checked;
  const terms = cfg.cards.filter((c) => c.type === 'term');
  const projects = new Map(); // path -> { name, cards }
  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || 'Home folder';
  for (const p of cfg.projects) projects.set(p.path, { name: p.name, cards: [] });
  for (const c of terms) {
    const key = projectOfPath(c.cwd) || '';
    if (!projects.has(key)) projects.set(key, { name: projName(key), cards: [] });
    projects.get(key).cards.push(c);
  }
  const pending = (cfg.tasks || []).filter((t) => t.status === 'pending');
  for (const t of pending) {
    const key = projectOfPath(t.cwd) || '';
    if (!projects.has(key)) projects.set(key, { name: projName(key), cards: [] });
  }

  // tabs: one diagram per project, or all of them together
  const used = [...projects].filter(([k, p]) => p.cards.length || pending.some((t) => (projectOfPath(t.cwd) || '') === k));
  if (dgProject !== '*' && !used.some(([k]) => k === dgProject)) dgProject = '*';
  $('#dgTabs').innerHTML = [['*', { name: 'All', cards: terms }], ...used].map(([k, p]) =>
    `<button type="button" data-p="${esc(k)}" class="${k === dgProject ? 'active' : ''}" title="${k === '*' ? 'Show every project' : 'Show only this project'}">${esc(p.name)}<span class="n">${p.cards.length}</span></button>`).join('');

  const shown = used.filter(([k]) => dgProject === '*' || k === dgProject);
  if (!shown.length) {
    box.innerHTML = `<div class="dg-empty"><h2>No agents yet.</h2><p>Open agents on the board or write tasks in <a href="#" data-open-tasks>Tasks</a>: this view shows each project, its groups and what each agent is doing.</p></div>`;
    $('#dgEdges').innerHTML = '';
    return;
  }

  const groups = groupsList();
  box.innerHTML = shown.map(([key, p]) => {
    const byGroup = new Map();
    for (const c of p.cards) {
      if (!showIdle && runtime.get(c.id)?.status !== 'busy' && !(cfg.tasks || []).some((t) => t.cardId === c.id && t.status !== 'done')) continue;
      const gid = c.groupId || '';
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid).push(c);
    }
    const projPending = pending.filter((t) => (projectOfPath(t.cwd) || '') === key);
    // groups with queued tasks even if they have no agents yet
    for (const t of projPending) {
      const g = t.group && groups.find((x) => x.title.toLowerCase() === t.group.toLowerCase());
      if (g && !byGroup.has(g.id)) byGroup.set(g.id, []);
    }
    const order = [...byGroup.keys()].sort((a, b) => (a === '') - (b === ''));
    const busy = p.cards.filter((c) => runtime.get(c.id)?.status === 'busy').length;
    const subs = order.map((gid) => {
      const g = gid && cardData(gid);
      const cards = byGroup.get(gid);
      const gPending = projPending.filter((t) => g ? t.group.toLowerCase() === g.title.toLowerCase() : !t.group || !groups.some((x) => x.title.toLowerCase() === t.group.toLowerCase()));
      const gBusy = cards.filter((c) => runtime.get(c.id)?.status === 'busy').length;
      return `<div class="dg-sub" style="--gcolor:${esc(g?.color || '#8f8577')}">
        <div class="dg-sub-tab">«group» <b>${esc(g ? g.title : 'No group')}</b> <span class="muted">${cards.length} agent${cards.length === 1 ? '' : 's'}${gBusy ? ` · ${gBusy} working` : ''}</span>
          ${g ? `<button class="card-btn" data-task-group="${esc(g.title)}" title="New task for this group: its agent opens inside the frame">${icon('plus', 12)} Task</button>` : ''}</div>
        <div class="dg-nodes">${cards.map(nodeHtml).join('')}${queueHtml(gPending, 'Queue')}</div>
      </div>`;
    }).join('');
    return `<div class="dg-pkg">
      <div class="dg-pkg-tab">«project» <b>${esc(p.name)}</b> <span class="muted">${p.cards.length} agents · ${busy} working</span></div>
      <div class="dg-pkg-body">${subs || '<div class="muted small">No active agents.</div>'}</div>
    </div>`;
  }).join('');
  drawEdges();
}

function drawEdges() {
  const svg = $('#dgEdges');
  const canvas = $('#dgCanvas');
  const base = canvas.getBoundingClientRect();
  const now = Date.now();
  for (let i = links.length - 1; i >= 0; i--) if (now - links[i].at > LINK_TTL) links.splice(i, 1);
  // tasks one agent created for another (add_task)
  const all = [...links];
  for (const t of cfg.tasks || []) if (t.from && t.cardId) all.push({ from: t.from, to: t.cardId, kind: 'task' });
  const pos = (id) => {
    const el = canvas.querySelector(`.dg-node[data-id="${CSS.escape(id)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left + canvas.scrollLeft, y: r.top - base.top + canvas.scrollTop, w: r.width, h: r.height };
  };
  svg.setAttribute('width', canvas.scrollWidth);
  svg.setAttribute('height', canvas.scrollHeight);
  const paths = [];
  for (const l of all) {
    const a = pos(l.from), b = pos(l.to);
    if (!a || !b) continue;
    const ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    // leave/enter through the nearest edge
    const horiz = Math.abs(bx - ax) > Math.abs(by - ay);
    const sx = horiz ? (bx > ax ? a.x + a.w : a.x) : ax, sy = horiz ? ay : (by > ay ? a.y + a.h : a.y);
    const ex = horiz ? (bx > ax ? b.x : b.x + b.w) : bx, ey = horiz ? by : (by > ay ? b.y : b.y + b.h);
    const k = horiz ? Math.max(40, Math.abs(ex - sx) / 2) : Math.max(40, Math.abs(ey - sy) / 2);
    const c1 = horiz ? `${sx + Math.sign(ex - sx) * k} ${sy}` : `${sx} ${sy + Math.sign(ey - sy) * k}`;
    const c2 = horiz ? `${ex - Math.sign(ex - sx) * k} ${ey}` : `${ex} ${ey - Math.sign(ey - sy) * k}`;
    const fresh = now - (l.at || now) < 60_000;
    paths.push(`<path d="M${sx} ${sy} C${c1} ${c2} ${ex} ${ey}" class="dg-edge ${fresh ? 'fresh' : ''}" marker-end="url(#dgArrow)"/>`
      + `<text x="${(sx + ex) / 2}" y="${(sy + ey) / 2 - 6}" class="dg-edge-label">${esc(l.kind)}</text>`);
  }
  svg.innerHTML = `<defs><marker id="dgArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M0 0 L10 5 L0 10 z" class="dg-arrow"/></marker></defs>${paths.join('')}`;
}

function toggleDiagram(force) {
  const open = force ?? !diagramOpen();
  $('#diagram').classList.toggle('hidden', !open);
  document.body.classList.toggle('diagram-open', open);
  clearInterval(dgTimer);
  if (open) { renderDiagram(); dgTimer = setInterval(renderDiagram, 1500); }
}

function initDiagram() {
  $('#dgClose').onclick = () => toggleDiagram(false);
  $('#dgTabs').addEventListener('click', (e) => {
    const p = e.target.closest('[data-p]')?.dataset.p;
    if (p != null) { dgProject = p; renderDiagram(); }
  });
  $('#dgShowTasks').onchange = renderDiagram;
  $('#dgShowIdle').onchange = renderDiagram;
  $('#dgContent').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-tasks]')) { e.preventDefault(); toggleDiagram(false); openTasks(); return; }
    const tg = e.target.closest('[data-task-group]');
    if (tg) { e.stopPropagation(); toggleDiagram(false); openTasks(`#${tg.dataset.taskGroup.replace(/\s+/g, '-')} `); return; }
    const node = e.target.closest('.dg-node');
    const c = node && cardData(node.dataset.id);
    if (c) { toggleDiagram(false); focusCardView(c); focusCard(c.id); }
  });
  $('#dgCanvas').addEventListener('scroll', drawEdges);
  $('#dgContent').addEventListener('pointerdown', () => { dgPressed = true; });
  window.addEventListener('pointerup', () => { setTimeout(() => { dgPressed = false; }, 50); });
  window.addEventListener('resize', () => { if (diagramOpen()) drawEdges(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && diagramOpen() && !document.querySelector('dialog[open]')) toggleDiagram(false); });
}
