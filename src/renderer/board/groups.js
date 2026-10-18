// AgentBoard — groups: frames that gather a team of agents on the board.
'use strict';

// ---------- Groups (board sections) ----------
// A group is a frame behind the cards. A card belongs to the group that contains
// its center; moving the frame moves its cards.
const GROUP_COLORS = ['#ff6b3d', '#6c9cf5', '#3fbf8f', '#c49cf0', '#e7b05a', '#5fd0c8', '#f06a8a'];
const groupsList = () => cfg.cards.filter((c) => c.type === 'group');
const centerIn = (c, g) => { const x = c.x + c.w / 2, y = c.y + c.h / 2; return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h; };
function groupAt(c) {
  let best = null;
  const sp = spaceOf(c);
  for (const g of groupsList()) {
    if (spaceOf(g) && sp && spaceOf(g) !== sp) continue; // each project has its own groups
    if (centerIn(c, g) && (!best || g.w * g.h < best.w * best.h)) best = g;
  }
  return best;
}
const membersOf = (g) => cfg.cards.filter((c) => c.type !== 'group' && c.groupId === g.id);
function syncGroups() {
  if (!cfg) return;
  for (const c of cfg.cards) if (c.type !== 'group') c.groupId = groupAt(c)?.id || null;
}
function groupName(c) { const g = c.groupId && cardData(c.groupId); return g ? g.title : ''; }

// Project a path belongs to (task worktrees count as their project).
function projectOfPath(p) {
  if (!p) return '';
  const norm = (x) => x.replace(/[\\/]+$/, '');
  let best = null;
  for (const pr of cfg.projects) {
    const root = norm(pr.path);
    if ((p === root || p.startsWith(root + '/') || p.startsWith(root + '\\')) && (!best || root.length > best.length)) best = root;
  }
  return best ? cfg.projects.find((x) => norm(x.path) === best).path : p;
}

function newGroup(opts = {}) {
  const n = groupsList().length + 1;
  return newCard('group', null, { title: opts.title || `Group ${n}`, noFocus: true, ...opts });
}

// Find a group by name, or create it to the right of everything else.
function ensureGroup(name, space = currentSpace()) {
  const g = groupsList().find((x) => x.title.toLowerCase() === name.toLowerCase() && (!spaceOf(x) || !space || spaceOf(x) === space));
  if (g) return g;
  const same = cfg.cards.filter((c) => spaceOf(c) === space);
  const right = same.length ? Math.max(...same.map((c) => c.x + c.w)) + 80 : 0;
  const top = same.length ? Math.min(...same.map((c) => c.y)) : 0;
  return newGroup({ title: name, x: right, y: top, space });
}

// Spot for a loose card that does not land inside a group.
function looseSpot(w = DEFAULT_W, h = DEFAULT_H) {
  const groups = groupsList();
  if (!groups.length) return {};
  const others = cfg.cards.filter((c) => c.type !== 'group' && !c.groupId);
  const y = Math.max(...groups.map((g) => g.y + g.h)) + 90;
  const x0 = Math.min(...groups.map((g) => g.x));
  const x = others.filter((c) => c.y >= y - 1).reduce((m, c) => Math.max(m, c.x + c.w + 28), x0);
  return { x, y };
}

// First free slot inside the group; if none fits, the group grows downward.
function slotIn(g, w = DEFAULT_W, h = DEFAULT_H) {
  const pad = 24, head = 24, gap = 24;
  const cols = Math.max(1, Math.floor((g.w - pad * 2 + gap) / (w + gap)));
  const members = membersOf(g);
  const overlaps = (x, y) => members.some((m) => x < m.x + m.w && x + w > m.x && y < m.y + m.h && y + h > m.y);
  for (let i = 0; i < 200; i++) {
    const x = g.x + pad + (i % cols) * (w + gap), y = g.y + head + Math.floor(i / cols) * (h + gap);
    if (overlaps(x, y)) continue;
    if (y + h + pad > g.y + g.h) { g.h = y + h + pad - g.y; layoutCard(g); }
    return { x, y };
  }
  return { x: g.x + pad, y: g.y + head };
}

function mountGroup(c) {
  const el = document.createElement('div');
  el.className = 'frame';
  el.style.setProperty('--gcolor', c.color || GROUP_COLORS[0]);
  el.style.zIndex = 0;
  el.innerHTML = `
    <div class="frame-head">
      <span class="frame-title">${esc(c.title)}</span>
      <span class="frame-meta"></span>
      <span class="spacer"></span>
      <button class="card-btn" data-act="task" title="New task for this group: its agent opens inside the frame">${icon('plus', 13)} Task</button>
      <button class="card-btn" data-act="edit" title="Change the name or color, or fit the frame to its cards">${icon('more', 14)}</button>
      <button class="card-btn" data-act="close" title="Remove the group (its cards stay on the board)">${icon('close', 14)}</button>
    </div>
    <div class="resize"></div>`;
  world.prepend(el);
  runtime.set(c.id, { el, metaEl: $('.frame-meta', el) });
  layoutCard(c);
  wireGroup(c, el);
}

function wireGroup(c, el) {
  const head = $('.frame-head', el);
  const titleEl = $('.frame-title', el);
  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button') || titleEl.isContentEditable) return;
    e.preventDefault();
    syncGroups();
    const members = membersOf(c).map((m) => ({ m, x: m.x, y: m.y }));
    const start = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / cfg.viewport.zoom, dy = (ev.clientY - start.y) / cfg.viewport.zoom;
      c.x = start.cx + dx; c.y = start.cy + dy; layoutCard(c);
      for (const o of members) { o.m.x = o.x + dx; o.m.y = o.y + dy; layoutCard(o.m); }
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); save(); renderSidebar(); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });
  titleEl.addEventListener('dblclick', () => {
    titleEl.contentEditable = 'true'; titleEl.focus(); document.getSelection().selectAllChildren(titleEl);
  });
  titleEl.addEventListener('blur', () => {
    titleEl.contentEditable = 'false';
    c.title = titleEl.textContent.trim() || c.title; titleEl.textContent = c.title;
    save(); renderSidebar();
  });
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); titleEl.blur(); } });
  const handle = $('.resize', el);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: c.w, h: c.h };
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      c.w = Math.max(320, start.w + (ev.clientX - start.x) / cfg.viewport.zoom);
      c.h = Math.max(200, start.h + (ev.clientY - start.y) / cfg.viewport.zoom);
      layoutCard(c);
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); save(); renderSidebar(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  el.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeCard(c);
    else if (act === 'edit') groupMenu(c, e.target.closest('button'));
    else if (act === 'task') openTasks(`#${c.title.replace(/\s+/g, '-')} `);
  });
}

function groupMenu(c, anchor) {
  closePopover();
  const pop = document.createElement('div');
  pop.className = 'popover edit';
  pop.innerHTML = `
    <label>Name <input name="title" value="${esc(c.title)}" /></label>
    <label>Color <div class="swatches">${GROUP_COLORS.map((col) => `<button type="button" data-col="${col}" class="${col === c.color ? 'on' : ''}" style="background:${col}"></button>`).join('')}</div></label>
    <div class="hint">Cards whose center sits inside the frame belong to the group. Write <code>#${esc(c.title.replace(/\s+/g, '-'))}</code> in a task to open its agent here.</div>
    <div class="row"><button data-x="closeall" title="Close every card inside this group and stop their processes">Close Its Cards</button><button data-x="fit" title="Resize the frame around its cards">Fit to Cards</button><button data-x="ok" class="primary">Apply</button></div>`;
  openPopover(pop, anchor, 290);
  let color = c.color;
  pop.addEventListener('click', (e) => {
    const col = e.target.closest('[data-col]')?.dataset.col;
    if (col) { color = col; pop.querySelectorAll('[data-col]').forEach((b) => b.classList.toggle('on', b.dataset.col === col)); return; }
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'closeall') {
      closePopover();
      const m = membersOf(c);
      if (!m.length) return toast('This group has no cards.');
      if (closeCards(m)) toast(`Closed ${m.length} card${m.length === 1 ? '' : 's'}.`);
      return;
    }
    if (x === 'fit') {
      const m = membersOf(c);
      if (m.length) {
        const pad = 24, head = 24;
        const x0 = Math.min(...m.map((q) => q.x)), y0 = Math.min(...m.map((q) => q.y));
        const x1 = Math.max(...m.map((q) => q.x + q.w)), y1 = Math.max(...m.map((q) => q.y + q.h));
        Object.assign(c, { x: x0 - pad, y: y0 - head, w: x1 - x0 + pad * 2, h: y1 - y0 + head + pad });
      }
    }
    if (x === 'ok' || x === 'fit') {
      c.title = $('[name=title]', pop).value.trim() || c.title;
      c.color = color;
      const rt = runtime.get(c.id);
      $('.frame-title', rt.el).textContent = c.title;
      rt.el.style.setProperty('--gcolor', c.color);
      layoutCard(c); closePopover(); save(); renderSidebar();
    }
  });
  $('[name=title]', pop).focus();
}

function updateGroupMeta() {
  for (const g of groupsList()) {
    const rt = runtime.get(g.id);
    if (!rt) continue;
    const m = membersOf(g).filter((c) => c.type === 'term');
    const busy = m.filter((c) => runtime.get(c.id)?.status === 'busy').length;
    const queued = (cfg.tasks || []).filter((t) => t.status === 'pending' && t.group && t.group.toLowerCase() === g.title.toLowerCase()).length;
    const notes = membersOf(g).length - m.length;
    const txt = m.length ? `${m.length} agent${m.length === 1 ? '' : 's'}${busy ? ` · ${busy} working` : ''}`
      : notes ? `${notes} note${notes === 1 ? '' : 's'}` : 'empty';
    const full = queued ? `${txt} · ${queued} queued` : txt;
    if (rt.metaEl.textContent !== full) rt.metaEl.textContent = full;
    rt.el.classList.toggle('busy', busy > 0);
  }
}
