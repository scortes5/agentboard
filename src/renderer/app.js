// AgentBoard — board UI (renderer)
/* global Terminal, FitAddon, WebLinksAddon */
'use strict';

/* global ab */ // exposed by preload.js as window.ab
const $ = (s, el = document) => el.querySelector(s);

const MIN_ZOOM = 0.3, MAX_ZOOM = 2;
const HEAD_H = 32;            // card header height (does not scale)
const DEFAULT_W = 720, DEFAULT_H = 440;
const BUSY_MS = 1500;         // recent output => "working"

let cfg = null;
let platform = 'darwin';
let agentAvailable = {};
const runtime = new Map();     // id -> { el, term, fit, statusEl, gitEl, lastData, busySince, alive }
let zTop = 1;
let focusedId = null;

const board = $('#board');
const world = $('#world');

// ---------- Utilities ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const basename = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMac = () => platform === 'darwin';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let saveTimer = null;
function save() {
  syncGroups();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ab.saveConfig(cfg), 400);
}
function saveNow() {
  syncGroups();
  clearTimeout(saveTimer);
  return ab.saveConfig(cfg);
}

function cardData(id) { return cfg.cards.find((c) => c.id === id); }
function agentOf(card) { return cfg.agents[card.agent] || cfg.agents.shell; }

// ---------- Viewport (semantic zoom: we scale position, size and font size;
// no CSS transform, so text stays sharp and xterm's mouse handling works) ----------
// The dot grid moves with the board.
function paintBackground() {
  const { x, y, zoom } = cfg.viewport;
  const g = 24 * zoom;
  board.style.backgroundSize = `${g}px ${g}px, 100% 100%, 100% 100%`;
  board.style.backgroundPosition = `${x}px ${y}px, 0 0, 0 0`;
}

// Board area not covered by the toolbar, the dock or the side panels (they float on top).
function visibleRect() {
  const r = board.getBoundingClientRect();
  const left = cfg.sidebarOpen ? 248 : 0, top = 52, bottom = 66, right = cfg.tasksOpen ? 352 : 0;
  return { left, top, width: r.width - left - right, height: r.height - top - bottom };
}

function applyViewport() {
  const { zoom } = cfg.viewport;
  paintBackground();
  $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
  for (const c of cfg.cards) layoutCard(c);
  scheduleFitAll();
  drawMinimap();
}

function layoutCard(c) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  const { x, y, zoom } = cfg.viewport;
  Object.assign(rt.el.style, {
    left: `${c.x * zoom + x}px`,
    top: `${c.y * zoom + y}px`,
    width: `${c.w * zoom}px`,
    height: `${c.h * zoom + HEAD_H * (1 - zoom)}px`,
  });
  if (rt.term) {
    const fs = Math.max(4, Math.round((cfg.fontSizePreview || cfg.fontSize) * zoom * 10) / 10);
    if (rt.term.options.fontSize !== fs) rt.term.options.fontSize = fs;
  }
  if (rt.noteEl) rt.noteEl.style.fontSize = `${Math.max(6, 13 * zoom)}px`;
}

function zoomAt(newZoom, sx, sy) {
  const vp = cfg.viewport;
  newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  // keep the world point under the cursor fixed
  const wx = (sx - vp.x) / vp.zoom, wy = (sy - vp.y) / vp.zoom;
  vp.zoom = newZoom;
  vp.x = sx - wx * newZoom;
  vp.y = sy - wy * newZoom;
  applyViewport(); save();
}

function zoomCenter(factor) {
  const v = visibleRect();
  zoomAt(cfg.viewport.zoom * factor, v.left + v.width / 2, v.top + v.height / 2);
}

function fitAll() {
  const v = visibleRect();
  const cards = shownCards();
  if (!cards.length) { cfg.viewport = { x: v.left + 40, y: v.top + 20, zoom: 1 }; applyViewport(); save(); return; }
  const minX = Math.min(...cards.map((c) => c.x)), minY = Math.min(...cards.map((c) => c.y));
  const maxX = Math.max(...cards.map((c) => c.x + c.w)), maxY = Math.max(...cards.map((c) => c.y + c.h));
  const pad = 30;
  const zoom = clamp(Math.min((v.width - pad * 2) / (maxX - minX), (v.height - pad * 2) / (maxY - minY)), MIN_ZOOM, 1);
  cfg.viewport = {
    zoom,
    x: v.left + (v.width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: v.top + (v.height - (maxY - minY) * zoom) / 2 - minY * zoom,
  };
  applyViewport(); save();
}

function focusCardView(c) {
  if (!inSpace(c)) switchSpace(spaceOf(c), { keepView: true });
  const v = visibleRect();
  const zoom = clamp(Math.min((v.width - 40) / c.w, (v.height - 30) / c.h), MIN_ZOOM, 1.4);
  cfg.viewport = { zoom, x: v.left + (v.width - c.w * zoom) / 2 - c.x * zoom, y: v.top + (v.height - c.h * zoom) / 2 - c.y * zoom };
  applyViewport(); save();
}

// Arrange in a grid. With groups: each group lays out its cards inside and fits
// around them; groups go in a row and loose cards below.
function gridLayout(cards, x0, y0, cols) {
  const gap = 28;
  const colW = Math.max(...cards.map((c) => c.w)), rowH = Math.max(...cards.map((c) => c.h));
  cards.forEach((c, i) => { c.x = x0 + (i % cols) * (colW + gap); c.y = y0 + Math.floor(i / cols) * (rowH + gap); });
  return { w: Math.min(cols, cards.length) * (colW + gap) - gap, h: Math.ceil(cards.length / cols) * (rowH + gap) - gap };
}

function arrange() {
  const groups = shownCards().filter((c) => c.type === 'group');
  const items = shownCards().filter((c) => c.type !== 'group');
  if (!items.length && !groups.length) return;
  syncGroups();
  let x = 0, maxH = 0;
  for (const g of groups) {
    const members = items.filter((c) => c.groupId === g.id);
    const pad = 24, head = 18;
    g.x = x; g.y = 0;
    if (members.length) {
      const size = gridLayout(members, x + pad, head + 6, Math.ceil(Math.sqrt(members.length)));
      g.w = size.w + pad * 2; g.h = size.h + head + 6 + pad;
    }
    x += g.w + 60; maxH = Math.max(maxH, g.h);
  }
  const loose = items.filter((c) => !groups.length || !c.groupId);
  if (loose.length) gridLayout(loose, 0, groups.length ? maxH + 90 : 0, Math.ceil(Math.sqrt(loose.length)));
  fitAll();
}

// ---------- Terminal fitting (debounced) ----------
const fitQueue = new Set();
let fitTimer = null;
function scheduleFit(id) { fitQueue.add(id); clearTimeout(fitTimer); fitTimer = setTimeout(flushFits, 60); }
function scheduleFitAll() { for (const c of cfg.cards) fitQueue.add(c.id); clearTimeout(fitTimer); fitTimer = setTimeout(flushFits, 80); }
function flushFits() {
  for (const id of fitQueue) {
    const rt = runtime.get(id);
    if (!rt || !rt.term || !rt.fit || rt.el.style.display === 'none') continue;
    try {
      rt.fit.fit();
      if (rt.alive) ab.ptyResize(id, rt.term.cols, rt.term.rows);
    } catch {}
  }
  fitQueue.clear();
}

// ---------- Cards ----------
// opts: { cwd, title, args, env, startCmd, text, x, y, w, h }
function newCard(type, agentKey, opts = {}) {
  if (type === 'term' && !('cwd' in opts) && !cfg.selectedProject) {
    const any = cfg.projects[0];
    if (!any) { addProject().then((ok) => ok && newCard(type, agentKey, opts)); return; }
    cfg.selectedProject = any.path;
  }
  const v = visibleRect();
  const r = { width: v.left * 2 + v.width, height: v.top * 2 + v.height }; // center of the visible area
  const vp = cfg.viewport;
  const offset = (cfg.cards.length % 8) * 30;
  const w = opts.w || (type === 'note' ? 360 : type === 'group' ? DEFAULT_W * 2 + 76 : DEFAULT_W);
  const h = opts.h || (type === 'note' ? 280 : type === 'group' ? DEFAULT_H + 76 : DEFAULT_H);
  const c = {
    id: uid(), type, agent: agentKey || 'shell',
    cwd: type === 'term' ? ('cwd' in opts ? opts.cwd : cfg.selectedProject) : null,
    title: opts.title || (type === 'note' ? 'Note' : type === 'group' ? 'Group' : (cfg.agents[agentKey] || cfg.agents.shell).label),
    args: opts.args || '',
    env: opts.env || null,
    startCmd: opts.startCmd || '',
    x: opts.x ?? (r.width / 2 - vp.x) / vp.zoom - w / 2 + offset,
    y: opts.y ?? (r.height / 2 - vp.y) / vp.zoom - h / 2 + offset,
    w, h, text: opts.text || '',
  };
  if (type !== 'term') c.space = opts.space ?? currentSpace();
  if (type === 'group') c.color = opts.color || GROUP_COLORS[cfg.cards.filter((x) => x.type === 'group').length % GROUP_COLORS.length];
  if (type === 'term' && isClaude(cfg.agents[c.agent])) c.sessionId = newSessionId();
  if (opts.prompt) c.prompt = opts.prompt;
  if (opts.parent) c.parent = opts.parent;
  if (opts.taskId) c.taskId = opts.taskId;
  cfg.cards.push(c);
  mountCard(c, { resume: false });
  if (!inSpace(c)) runtime.get(c.id).el.style.display = 'none';
  if (!opts.noFocus) focusCard(c.id);
  save();
  updateEmpty();
  renderSidebar();
  return c;
}

function duplicateCard(c) {
  newCard(c.type, c.agent, {
    cwd: c.cwd, args: c.args, env: c.env, text: c.text, title: `${c.title} (copy)`,
    x: c.x + c.w + 28, y: c.y, w: c.w, h: c.h,
  });
}

function mountCard(c, { resume }) {
  if (c.type === 'group') return mountGroup(c);
  // Without "resume on open": each Claude card starts a new session
  if (resume && !cfg.resumeOnOpen && c.sessionId) { c.sessionId = newSessionId(); c.sessionUsed = false; }
  const agent = agentOf(c);
  const el = document.createElement('div');
  el.className = 'card' + (c.type === 'note' ? ' note-card' : '');
  el.style.setProperty('--agent', c.type === 'note' ? '' : agent.color);
  el.style.zIndex = ++zTop;
  el.innerHTML = `
    <div class="card-head">
      <span class="status"></span>
      <span class="title">${esc(c.title)}</span>
      ${c.type === 'term' ? `<span class="proj" title="${esc(c.cwd || 'Home folder')}">${esc(basename(c.cwd) || '~')}</span>` : ''}
      <span class="spacer"></span>
      ${c.type === 'term' ? `<span class="gitpill hidden"></span>
        <button class="card-btn" data-act="open" title="Open the project folder in Finder">${icon('folder', 14)}</button>
        <button class="card-btn" data-act="restart" title="Restart the agent (resumes its session)">${icon('refresh', 14)}</button>` : ''}
      <button class="card-btn" data-act="edit" title="${c.type === 'term' ? 'Change name, agent, project or arguments; send context to another agent' : 'Edit or duplicate the note'}">${icon('more', 14)}</button>
      <button class="card-btn" data-act="zoom" title="Focus this card (fills the view)">${icon('focus', 14)}</button>
      <button class="card-btn" data-act="close" title="Close the card and stop its process">${icon('close', 14)}</button>
    </div>
    <div class="card-body"></div>
    <div class="resize"></div>`;
  world.appendChild(el);

  const rt = { el, statusEl: $('.status', el), gitEl: $('.gitpill', el), lastData: 0, busySince: 0, alive: false };
  runtime.set(c.id, rt);
  const body = $('.card-body', el);

  if (c.type === 'note') {
    const ta = document.createElement('textarea');
    ta.className = 'note';
    ta.placeholder = 'Notes, prompts, to-dos…';
    ta.value = c.text || '';
    ta.addEventListener('input', () => { c.text = ta.value; save(); });
    body.appendChild(ta);
    rt.noteEl = ta;
    rt.statusEl.classList.add('hidden');
  } else {
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono'),
      fontSize: cfg.fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: termTheme(c),
      lineHeight: ui().lineHeight,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => window.open(url)));
    term.open(body);
    term.attachCustomKeyEventHandler((e) => clipboardKeys(e, term));
    term.onData((d) => ab.ptyWrite(c.id, d));
    term.textarea && term.textarea.addEventListener('focus', () => focusCard(c.id, false));
    rt.term = term; rt.fit = fit;
    layoutCard(c);
    requestAnimationFrame(() => startPty(c, resume));
  }

  layoutCard(c);
  wireCard(c, el);
}

// ---------- Each card's command ----------
// Every Claude card has its own session id: when the app reopens or the card restarts
// it returns to ITS conversation (--resume <id>), even with several Claudes in the
// same project. Other agents use their "resume args" (e.g. codex resume --last).
const isClaude = (a) => !!a && /(^|[\\/])claude(\.cmd|\.exe)?$/i.test((a.command || '').trim().split(/\s+/)[0] || '');
function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const usesPowerShell = () => platform === 'win32' && (!cfg.shell || /pwsh|powershell/i.test(cfg.shell));
const usesCmd = () => platform === 'win32' && /(^|\\)cmd(\.exe)?(\s|$)/i.test(cfg.shell || '');
function shellQuote(s) {
  if (usesPowerShell()) return "'" + s.replace(/'/g, "''") + "'";
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
function orElse(a, b) { return usesPowerShell() ? `${a}; if (-not $?) { ${b} }` : `${a} || ${b}`; }
// How an agent receives its first task: as an argument (independent of when the
// TUI finishes starting) or pasted into the terminal (unknown CLIs, cmd.exe).
function promptMode(a) {
  if (usesCmd()) return 'paste';
  return a.taskPrompt || ({ claude: 'arg', codex: 'arg', gemini: '-i' })[(a.command || '').trim().split(/\s+/)[0]] || 'paste';
}

function commandFor(c, resume) {
  if (c.startCmd) return resume ? '' : c.startCmd; // e.g. a login card: not repeated on reopen
  const a = agentOf(c);
  if (!a.command) return '';
  const session = c.sessionId && isClaude(a);
  const parts = [a.command, c.args];
  if (session) parts.push(c.sessionUsed ? `--resume ${c.sessionId}` : `--session-id ${c.sessionId}`);
  else if (resume && cfg.resumeOnOpen) parts.push(a.resumeArgs);
  const mode = promptMode(a);
  if (c.prompt && !c.promptSent && mode !== 'paste') {
    parts.push((mode === 'arg' ? '' : mode + ' ') + shellQuote(c.prompt.replace(/\s*\n\s*/g, ' ').trim()));
  }
  const cmd = parts.filter(Boolean).join(' ');
  // if the saved session no longer exists (nothing was ever typed), open a new one with the same id
  if (session && c.sessionUsed) return orElse(cmd, [a.command, c.args, `--session-id ${c.sessionId}`].filter(Boolean).join(' '));
  return cmd;
}

async function startPty(c, resume) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  try { rt.fit.fit(); } catch {}
  $('.overlay', rt.el)?.remove();
  const command = commandFor(c, resume);
  const env = { ...(agentOf(c).env || {}), ...(c.env || {}) }; // e.g. CLAUDE_CONFIG_DIR of an extra account
  const res = await ab.ptyCreate({ id: c.id, cwd: c.cwd, command, env: Object.keys(env).length ? env : undefined, cols: rt.term.cols, rows: rt.term.rows });
  if (!res.ok) { showOverlay(c, res.error); return; }
  rt.alive = true;
  rt.lastData = Date.now();
  if (focusedId === c.id) rt.term.focus();
  let dirty = false;
  if (c.sessionId && !c.sessionUsed && isClaude(agentOf(c))) { c.sessionUsed = true; dirty = true; }
  if (c.prompt && !c.promptSent) {
    c.promptSent = true; dirty = true;
    if (promptMode(agentOf(c)) === 'paste') {
      await waitReady(c.id);
      await ab.ptyPaste(c.id, c.prompt);
    }
  }
  if (dirty) save();
}

// Wait for the CLI to finish starting: some output, then ~1.5 s of silence.
async function waitReady(id, maxMs = 20000) {
  await waitAlive(id);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() - t0 < maxMs) {
    const rt = runtime.get(id);
    if (!rt) return;
    if (Date.now() - rt.lastData > 1500) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function restartCard(c) {
  const rt = runtime.get(c.id);
  if (!rt || !rt.term) return;
  ab.ptyKill(c.id);
  rt.alive = false;
  rt.term.reset();
  startPty(c, false);
}

function showOverlay(c, msg) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  $('.overlay', rt.el)?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div>${esc(msg)}</div><button class="primary" title="Open the agent again in this card">Restart</button>`;
  $('button', ov).onclick = () => restartCard(c);
  $('.card-body', rt.el).appendChild(ov);
}

function closeCard(c) {
  const rt = runtime.get(c.id);
  if (rt?.alive && !confirm(`Close "${c.title}"? Its process will be stopped.`)) return;
  if (c.type !== 'group') ab.ptyKill(c.id);
  rt?.term?.dispose();
  rt?.el.remove();
  runtime.delete(c.id);
  cfg.cards = cfg.cards.filter((x) => x.id !== c.id);
  if (focusedId === c.id) focusedId = null;
  save(); updateEmpty(); renderSidebar();
}

function focusCard(id, focusTerm = true) {
  if (focusedId && focusedId !== id) runtime.get(focusedId)?.el.classList.remove('focused');
  focusedId = id;
  markSidebarFocus();
  const rt = runtime.get(id);
  if (!rt) return;
  rt.el.classList.add('focused');
  if (+rt.el.style.zIndex < zTop) rt.el.style.zIndex = ++zTop;
  if (focusTerm) (rt.term || rt.noteEl)?.focus();
}

// Copy/paste inside the terminal.
// Mac: ⌘C copies the selection; ⌘V is handled by the Edit menu (native paste event).
// Windows: Ctrl+C copies ONLY when there is a selection (otherwise it interrupts as usual);
// Ctrl+V uses the native paste; Ctrl+Shift+C/V also work.
function clipboardKeys(e, term) {
  if (e.type !== 'keydown') return true;
  const k = e.key.toLowerCase();
  if (isMac()) {
    if (e.metaKey && k === 'c') { if (term.hasSelection()) ab.copy(term.getSelection()); return false; }
    if (e.metaKey && (k === 'v' || k === 'a')) { if (k === 'a') term.selectAll(); return false; }
    if (e.metaKey && k === 'k') { term.clear(); return false; }
    return true;
  }
  if (e.ctrlKey && k === 'c' && (e.shiftKey || term.hasSelection())) {
    if (term.hasSelection()) { ab.copy(term.getSelection()); term.clearSelection(); }
    return false;
  }
  if (e.ctrlKey && e.shiftKey && k === 'v') { e.preventDefault(); ab.paste().then((t) => term.paste(t)); return false; }
  if (e.ctrlKey && k === 'v') return false; // let the native paste through
  return true;
}

// Drag, resize, buttons
function wireCard(c, el) {
  const head = $('.card-head', el);
  const titleEl = $('.title', el);

  el.addEventListener('pointerdown', () => focusCard(c.id, false), true);

  head.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button, .gitpill') || titleEl.isContentEditable) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
    head.setPointerCapture(e.pointerId);
    const move = (ev) => {
      c.x = start.cx + (ev.clientX - start.x) / cfg.viewport.zoom;
      c.y = start.cy + (ev.clientY - start.y) / cfg.viewport.zoom;
      layoutCard(c);
    };
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); save(); renderSidebar(); focusCard(c.id); };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  head.addEventListener('dblclick', (e) => {
    if (e.target === titleEl) return;
    if (!e.target.closest('button, .gitpill')) focusCardView(c);
  });

  titleEl.addEventListener('dblclick', () => {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    document.getSelection().selectAllChildren(titleEl);
  });
  const commitTitle = () => {
    titleEl.contentEditable = 'false';
    c.title = titleEl.textContent.trim() || c.title;
    titleEl.textContent = c.title;
    save(); renderSidebar();
  };
  titleEl.addEventListener('blur', commitTitle);
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); titleEl.blur(); } });

  const handle = $('.resize', el);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, w: c.w, h: c.h };
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      c.w = Math.max(280, start.w + (ev.clientX - start.x) / cfg.viewport.zoom);
      c.h = Math.max(160, start.h + (ev.clientY - start.y) / cfg.viewport.zoom);
      layoutCard(c); scheduleFit(c.id);
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); save(); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) {
      const act = btn.dataset.act;
      if (act === 'close') closeCard(c);
      else if (act === 'restart') restartCard(c);
      else if (act === 'zoom') focusCardView(c);
      else if (act === 'edit') editMenu(c, btn);
      else if (act === 'open') ab.openPath(c.cwd);
      return;
    }
    if (e.target.closest('.gitpill')) branchMenu(c, e.target.closest('.gitpill'));
  });
}

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
    <div class="row"><button data-x="fit" title="Resize the frame around its cards">Fit to Cards</button><button data-x="ok" class="primary">Apply</button></div>`;
  openPopover(pop, anchor, 290);
  let color = c.color;
  pop.addEventListener('click', (e) => {
    const col = e.target.closest('[data-col]')?.dataset.col;
    if (col) { color = col; pop.querySelectorAll('[data-col]').forEach((b) => b.classList.toggle('on', b.dataset.col === col)); return; }
    const x = e.target.closest('[data-x]')?.dataset.x;
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

// ---------- PTY data ----------
ab.onPtyData((id, data) => {
  const rt = runtime.get(id);
  if (!rt || !rt.term) return;
  rt.term.write(data);
  const now = Date.now();
  if (now - rt.lastData > BUSY_MS) rt.busySince = now;
  rt.lastData = now;
});

ab.onPtyExit((id, code) => {
  const rt = runtime.get(id);
  const c = cardData(id);
  if (!rt || !c) return;
  rt.alive = false;
  showOverlay(c, `The process exited (code ${code}).`);
});

// Status: working / waiting / stopped + notify when an agent finishes
setInterval(() => {
  if (!cfg) return;
  const now = Date.now();
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.term) continue;
    const s = rt.statusEl;
    const busy = rt.alive && now - rt.lastData < BUSY_MS;
    const wasBusy = s.classList.contains('busy');
    rt.status = !rt.alive ? 'dead' : busy ? 'busy' : 'idle';
    s.className = 'status ' + rt.status;
    rt.el.classList.toggle('busy', busy);
    s.title = STATUS_LABEL[rt.status];
    const sideDot = sideItems.get(c.id)?.querySelector('.status');
    if (sideDot) { sideDot.className = 'status ' + rt.status; sideDot.title = s.title; }
    // Notify if it worked for >8 s and you are not looking at it
    if (wasBusy && !busy && rt.lastData - rt.busySince > 8000 && (!document.hasFocus() || focusedId !== c.id)) {
      try { new Notification(`${c.title} finished`, { body: basename(c.cwd), silent: false }); } catch {}
    }
  }
  updateGroupMeta();
  updateSpaceBadges();
  updateSideCounts();
  drawMinimap();
}, 500);

// ---------- Git ----------
const gitCache = {}; // cwd -> last status (the diagram uses it too)
async function refreshGit() {
  if (!cfg) return;
  const cwds = [...new Set(cfg.cards.filter((c) => c.type === 'term').map((c) => c.cwd))];
  const results = {};
  await Promise.all(cwds.map(async (cwd) => { results[cwd] = await ab.gitStatus(cwd); }));
  Object.assign(gitCache, results);
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.gitEl) continue;
    const g = results[c.cwd];
    if (!g) { rt.gitEl.classList.add('hidden'); continue; }
    rt.gitEl.classList.remove('hidden');
    rt.gitEl.innerHTML = `${icon('branch', 12)} ${esc(g.branch)}`
      + (g.changes ? ` <span class="dirty">${g.changes} change${g.changes === 1 ? '' : 's'}</span>` : '')
      + (g.ahead ? ` <span class="ab">↑${g.ahead}</span>` : '')
      + (g.behind ? ` <span class="ab">↓${g.behind}</span>` : '');
    rt.gitEl.title = `${g.changes} uncommitted changes · ${g.ahead} ahead · ${g.behind} behind — click to switch branch`;
  }
}
setInterval(refreshGit, 4000);

async function branchMenu(c, anchor) {
  closePopover();
  const [branches, status] = await Promise.all([ab.gitBranches(c.cwd), ab.gitStatus(c.cwd)]);
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = branches.map((b) =>
    `<button data-b="${esc(b)}" class="${b === status?.branch ? 'current' : ''}">${esc(b)}${b === status?.branch ? ' (current)' : ''}</button>`).join('')
    + '<hr/><input id="newBranch" placeholder="New branch… (Enter)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text);font:12px var(--font-mono)"/>';
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - 230) + 'px';
  pop.style.top = r.bottom + 4 + 'px';
  document.body.appendChild(pop);

  pop.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (!b) return;
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, b, false))) alert(`Could not switch to "${b}". Are there uncommitted changes?`);
    refreshGit();
  });
  const input = $('#newBranch', pop);
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const name = input.value.trim();
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, name, true))) alert(`Could not create the branch "${name}".`);
    refreshGit();
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function outside(e) { if (!pop.contains(e.target)) { closePopover(); document.removeEventListener('pointerdown', outside, true); } }
}
function closePopover() { document.querySelectorAll('.popover').forEach((p) => p.remove()); }

// ---------- Board pan / zoom ----------
board.addEventListener('pointerdown', (e) => {
  const onBackground = e.target === board || e.target === world;
  if (!(onBackground && e.button === 0) && e.button !== 1) return;
  e.preventDefault();
  if (onBackground && focusedId) { runtime.get(focusedId)?.el.classList.remove('focused'); focusedId = null; markSidebarFocus(); }
  const start = { x: e.clientX, y: e.clientY, vx: cfg.viewport.x, vy: cfg.viewport.y };
  board.classList.add('panning');
  board.setPointerCapture(e.pointerId);
  const move = (ev) => {
    cfg.viewport.x = start.vx + ev.clientX - start.x;
    cfg.viewport.y = start.vy + ev.clientY - start.y;
    applyViewportFast();
  };
  const up = () => {
    board.classList.remove('panning');
    board.removeEventListener('pointermove', move);
    board.removeEventListener('pointerup', up);
    save();
  };
  board.addEventListener('pointermove', move);
  board.addEventListener('pointerup', up);
});

// pan without re-fitting (the size does not change)
function applyViewportFast() {
  const { x, y } = cfg.viewport;
  paintBackground();
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (rt) { rt.el.style.left = `${c.x * cfg.viewport.zoom + x}px`; rt.el.style.top = `${c.y * cfg.viewport.zoom + y}px`; }
  }
  drawMinimap();
}

board.addEventListener('wheel', (e) => {
  const r = board.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {           // trackpad pinch or ⌘/Ctrl + wheel
    e.preventDefault();
    zoomAt(cfg.viewport.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    return;
  }
  if (e.target.closest('.card-body')) return;  // the terminal/note scrolls on its own
  e.preventDefault();
  cfg.viewport.x -= e.deltaX;
  cfg.viewport.y -= e.deltaY;
  applyViewportFast(); save();
}, { passive: false });

window.addEventListener('resize', scheduleFitAll);

// Position a popover under `anchor` and close it on an outside click.
function openPopover(pop, anchor, width = 230) {
  const r = anchor.getBoundingClientRect();
  pop.style.left = clamp(r.right - width, 8, innerWidth - width - 8) + 'px';
  pop.style.top = Math.min(r.bottom + 4, innerHeight - 40) + 'px';
  document.body.appendChild(pop);
  const outside = (e) => {
    if (!pop.isConnected) return document.removeEventListener('pointerdown', outside, true);
    if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', outside, true); }
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

// ---------- Edit card ----------
function editMenu(c, anchor) {
  closePopover();
  const isTerm = c.type === 'term';
  const projects = [...cfg.projects];
  if (isTerm && c.cwd && !projects.some((p) => p.path === c.cwd)) projects.push({ path: c.cwd, name: basename(c.cwd) });

  const pop = document.createElement('div');
  pop.className = 'popover edit';
  pop.innerHTML = `
    <label>Name <input name="title" value="${esc(c.title)}" /></label>
    ${isTerm ? `
      <label>Agent <select name="agent">${Object.entries(cfg.agents).map(([k, a]) =>
        `<option value="${esc(k)}" ${k === c.agent ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
      <label>Project <select name="cwd"><option value="" ${c.cwd ? '' : 'selected'}>Home folder (~)</option>${projects.map((p) =>
        `<option value="${esc(p.path)}" ${p.path === c.cwd ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Extra arguments <input name="args" value="${esc(c.args || '')}" placeholder="e.g. --model opus" /></label>
      ${agentOf(c).lightArgs ? `<label class="switch" title="Adds ${esc(agentOf(c).lightArgs)} to the arguments"><input type="checkbox" name="light" ${c.args && c.args.includes(agentOf(c).lightArgs) ? 'checked' : ''} /> Saving mode (cheaper model)</label>` : ''}
      ${agentOf(c).command ? `<label class="switch"><input type="checkbox" name="bridge" ${c.bridge !== false ? 'checked' : ''} /> Other agents can message it</label>` : ''}
      <div class="hint"></div>` : ''}
    <div class="row">
      ${isTerm ? '<button data-x="handoff" title="Send the selection or the last lines to another agent, with an instruction">Send to…</button>' : ''}
      <button data-x="dup" title="Create a copy of this card next to it">Duplicate</button>
      <button data-x="cancel">Cancel</button>
      <button data-x="ok" class="primary">Apply</button>
    </div>`;
  openPopover(pop, anchor, 280);

  const field = (n) => pop.querySelector(`[name=${n}]`);
  const draft = () => ({ agent: field('agent').value, cwd: field('cwd').value || null, args: field('args').value.trim() });
  const changed = (d) => d.agent !== c.agent || d.cwd !== c.cwd || d.args !== (c.args || '');
  const updateHint = () => {
    if (!isTerm) return;
    const d = draft();
    const cmd = commandFor({ ...c, ...d, startCmd: changed(d) ? '' : c.startCmd }, false) || '(shell only)';
    $('.hint', pop).innerHTML = `Command: <code>${esc(cmd)}</code>${changed(d) ? '<br/>Applying restarts the agent.' : ''}`;
  };
  pop.addEventListener('input', (e) => {
    if (e.target.name === 'light') {
      const la = (cfg.agents[field('agent').value] || {}).lightArgs || '';
      const rest = field('args').value.replace(la, '').trim();
      field('args').value = e.target.checked ? [la, rest].filter(Boolean).join(' ') : rest;
    }
    if (e.target.name !== 'bridge') updateHint();
  });
  updateHint();

  const apply = () => {
    let title = field('title').value.trim() || c.title;
    let restart = false;
    if (isTerm) {
      const d = draft();
      restart = changed(d);
      if (restart) {
        // if it had the default name, follow the new agent
        if (title === agentOf(c).label && d.agent !== c.agent) title = cfg.agents[d.agent].label;
        const newSession = d.agent !== c.agent || d.cwd !== c.cwd;
        Object.assign(c, d, { startCmd: '' });
        if (!isClaude(agentOf(c))) { delete c.sessionId; delete c.sessionUsed; }
        else if (newSession || !c.sessionId) { c.sessionId = newSessionId(); c.sessionUsed = false; }
      }
      if (field('bridge')) c.bridge = field('bridge').checked;
    }
    c.title = title;
    closePopover();
    refreshCardHead(c);
    save(); renderSidebar(); refreshGit();
    if (restart) restartCard(c);
  };

  pop.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'ok') apply();
    else if (x === 'cancel') closePopover();
    else if (x === 'dup') { closePopover(); duplicateCard(c); }
    else if (x === 'handoff') { closePopover(); handoffMenu(c, anchor); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); }
  });
  field('title').focus();
  field('title').select();
}

function refreshCardHead(c) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  $('.title', rt.el).textContent = c.title;
  if (c.type !== 'term') return;
  const a = agentOf(c);
  rt.el.style.setProperty('--agent', a.color);
  const proj = $('.proj', rt.el);
  proj.textContent = basename(c.cwd) || '~';
  proj.title = c.cwd || 'Home folder';
  if (rt.term) rt.term.options.theme = termTheme(c);
}

// ---------- Agent list ----------
const STATUS_LABEL = { busy: 'Working', idle: 'Waiting', dead: 'Stopped' };
const NOTES_KEY = '\u0000notes';
const sideItems = new Map(); // id -> button in the list

function renderSidebar() {
  const list = $('#sideList');
  const q = $('#sideFilter').value.trim().toLowerCase();
  sideItems.clear();
  list.innerHTML = '';

  const groups = new Map();
  for (const c of cfg.cards) {
    if (c.type === 'group') continue;
    const a = agentOf(c);
    if (q && !`${c.title} ${a.label} ${c.cwd || ''} ${groupName(c)}`.toLowerCase().includes(q)) continue;
    const key = c.type === 'note' ? NOTES_KEY : projectOfPath(c.cwd);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  if (!groups.size) {
    list.innerHTML = `<div class="side-empty">${cfg.cards.length ? 'No results.' : 'No agents on the board yet.'}</div>`;
    updateSideCounts();
    return;
  }

  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || 'Home folder';
  const projOrder = (p) => { const i = cfg.projects.findIndex((x) => x.path === p); return i < 0 ? 999 : i; };
  const entries = [...groups].sort(([a], [b]) => (a === NOTES_KEY) - (b === NOTES_KEY) || projOrder(a) - projOrder(b));
  for (const [key, cards] of entries) {
    const h = document.createElement('div');
    h.className = 'side-group';
    h.textContent = key === NOTES_KEY ? 'Notes' : projName(key);
    if (key !== NOTES_KEY) h.title = key || 'Home folder';
    list.appendChild(h);
    cards.sort((x, y) => groupName(x).localeCompare(groupName(y)));
    let lastGroup = null;
    for (const c of cards) {
      const a = agentOf(c);
      const gname = groupName(c);
      if (gname !== lastGroup && (gname || lastGroup)) {
        const sub = document.createElement('div');
        sub.className = 'side-sub';
        sub.textContent = gname || 'No group';
        list.appendChild(sub);
      }
      lastGroup = gname;
      const st = runtime.get(c.id)?.status || '';
      const b = document.createElement('button');
      b.className = 'side-item';
      b.style.setProperty('--agent', c.type === 'note' ? 'var(--warn)' : a.color);
      b.innerHTML = (c.type === 'term' ? `<span class="status ${st}" title="${STATUS_LABEL[st] || ''}"></span>` : '')
        + `<span class="name">${esc(c.title)}</span><span class="kind">${c.type === 'note' ? 'note' : esc(a.label)}</span>`;
      b.title = c.type === 'note' ? 'Go to the note' : `Go to the ${c.title} card (${a.label})`;
      b.onclick = () => { focusCardView(c); focusCard(c.id); };
      list.appendChild(b);
      sideItems.set(c.id, b);
    }
  }
  markSidebarFocus();
  updateSideCounts();
}

function markSidebarFocus() {
  for (const [id, el] of sideItems) el.classList.toggle('focused', id === focusedId);
}

function updateSideCounts() {
  const terms = cfg.cards.filter((c) => c.type === 'term');
  const busy = terms.filter((c) => runtime.get(c.id)?.status === 'busy').length;
  $('#sideCounts').textContent = terms.length ? `${terms.length} · ${busy} working` : '';
}

function toggleSidebar(force) {
  cfg.sidebarOpen = force ?? !cfg.sidebarOpen;
  document.body.classList.toggle('sidebar-open', !!cfg.sidebarOpen);
  drawMinimap(); save();
}

$('#sideFilter').addEventListener('input', renderSidebar);
$('#sidebarBtn').onclick = () => toggleSidebar();

// ---------- Minimap ----------
const mini = $('#minimap');
const mctx = mini.getContext('2d');
let miniDrag = null; // transform frozen while dragging

function miniTransform() {
  const r = board.getBoundingClientRect();
  const vp = cfg.viewport;
  const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom };
  let x0 = view.x, y0 = view.y, x1 = view.x + view.w, y1 = view.y + view.h;
  for (const c of shownCards()) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x + c.w); y1 = Math.max(y1, c.y + c.h);
  }
  const pad = 60;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = mini.clientWidth, H = mini.clientHeight;
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  return { s, ox: (W - (x1 - x0) * s) / 2 - x0 * s, oy: (H - (y1 - y0) * s) / 2 - y0 * s, view };
}

function drawMinimap() {
  if (!cfg) return;
  const show = shownCards().length > 0;
  mini.classList.toggle('hidden', !show);
  if (!show) return;
  const dpr = window.devicePixelRatio || 1;
  const W = mini.clientWidth, H = mini.clientHeight;
  if (mini.width !== Math.round(W * dpr)) { mini.width = Math.round(W * dpr); mini.height = Math.round(H * dpr); }
  const cur = miniTransform();
  const t = miniDrag || cur;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, W, H);
  for (const c of shownCards()) {
    if (c.type === 'group') {
      mctx.globalAlpha = 0.7; mctx.strokeStyle = c.color || '#ff6b3d'; mctx.lineWidth = 1;
      mctx.strokeRect(t.ox + c.x * t.s + 0.5, t.oy + c.y * t.s + 0.5, c.w * t.s, c.h * t.s);
      continue;
    }
    const st = runtime.get(c.id)?.status;
    mctx.globalAlpha = c.id === focusedId ? 1 : st === 'dead' ? 0.3 : 0.65;
    mctx.fillStyle = c.type === 'note' ? '#d29922' : agentOf(c).color;
    mctx.fillRect(t.ox + c.x * t.s, t.oy + c.y * t.s, Math.max(2, c.w * t.s), Math.max(2, c.h * t.s));
  }
  mctx.globalAlpha = 1;
  mctx.strokeStyle = '#e6e8ec';
  mctx.lineWidth = 1;
  const v = cur.view;
  mctx.strokeRect(t.ox + v.x * t.s + 0.5, t.oy + v.y * t.s + 0.5, v.w * t.s, v.h * t.s);
}

mini.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation();
  miniDrag = miniTransform();
  mini.setPointerCapture(e.pointerId);
  const go = (ev) => {
    const m = mini.getBoundingClientRect();
    const wx = (ev.clientX - m.left - miniDrag.ox) / miniDrag.s;
    const wy = (ev.clientY - m.top - miniDrag.oy) / miniDrag.s;
    const r = board.getBoundingClientRect();
    cfg.viewport.x = r.width / 2 - wx * cfg.viewport.zoom;
    cfg.viewport.y = r.height / 2 - wy * cfg.viewport.zoom;
    applyViewportFast();
  };
  go(e);
  const up = () => {
    miniDrag = null;
    mini.removeEventListener('pointermove', go);
    mini.removeEventListener('pointerup', up);
    save(); drawMinimap();
  };
  mini.addEventListener('pointermove', go);
  mini.addEventListener('pointerup', up);
});

// ---------- Agents and models ----------
let catalog = [];

// Add (or show again) a catalog agent in the bottom bar.
function ensureAgent(item, show = true) {
  const cur = cfg.agents[item.key];
  if (!cur) {
    cfg.agents[item.key] = { label: item.label.replace(/ CLI$/, ''), command: item.command, resumeArgs: item.resumeArgs, color: item.color };
  }
  if (show) delete cfg.agents[item.key].hidden;
  return item.key;
}

function setPinned(item, pinned) {
  if (pinned) ensureAgent(item);
  else if (cfg.agents[item.key]) cfg.agents[item.key].hidden = true;
  save(); renderAgentButtons();
}

async function openAccounts() {
  $('#accounts').showModal();
  await renderAccounts();
}

async function renderAccounts() {
  $('#catalogRows').innerHTML = '<span class="muted small">Checking what you have installed…</span>';
  $('#localRows').innerHTML = '<span class="muted small">Looking for local models…</span>';
  const [cat, local, avail] = await Promise.all([ab.catalogStatus(), ab.localModels(), ab.checkAgents()]);
  catalog = cat;
  agentAvailable = avail;
  renderAgentButtons();
  renderCatalog();
  renderLocal(local);
  renderClaudeAccounts();
}

// ---------- Multiple Claude accounts ----------
// Each extra account is an agent with its own CLAUDE_CONFIG_DIR: separate login,
// history and skills. The task queue treats them as different subscriptions.
const ACCOUNT_COLORS = ['#f0a070', '#d97757', '#f4c77d', '#e8875f', '#c96442'];
async function renderClaudeAccounts() {
  const box = $('#claudeAccounts');
  const extra = Object.entries(cfg.agents).filter(([, a]) => isClaude(a) && a.env?.CLAUDE_CONFIG_DIR);
  const status = await ab.claudeAccountStatus(extra.map(([, a]) => a.env.CLAUDE_CONFIG_DIR));
  const main = catalog.find((i) => i.key === 'claude');
  box.innerHTML = [
    `<div class="hub-row"><span class="dot" style="background:${esc(cfg.agents.claude?.color || '#e8875f')};color:${esc(cfg.agents.claude?.color || '#e8875f')}"></span>
      <span class="meta"><strong>${esc(cfg.agents.claude?.label || 'Claude')}</strong><small>Main account · <code>~/.claude</code></small></span>
      <span class="badge ${main?.loggedIn ? 'ok' : 'no'}">${main?.loggedIn ? 'Signed in' : 'Signed out'}</span><span></span></div>`,
    ...extra.map(([k, a]) => `<div class="hub-row" data-k="${esc(k)}"><span class="dot" style="background:${esc(a.color)};color:${esc(a.color)}"></span>
      <span class="meta"><strong>${esc(a.label)}</strong><small><code>${esc(a.env.CLAUDE_CONFIG_DIR)}</code></small></span>
      <span class="badge ${status[a.env.CLAUDE_CONFIG_DIR] ? 'ok' : 'no'}">${status[a.env.CLAUDE_CONFIG_DIR] ? 'In use' : 'Sign-in needed'}</span>
      <span class="acts"><button type="button" data-x="login" title="Open this account in a card; the first time, sign in with /login">Open or Sign In</button><button type="button" class="icon" data-x="remove" title="Remove from AgentBoard (keeps the folder and the session)">${icon('close', 13)}</button></span></div>`),
  ].join('');
}

$('#claudeAccounts').addEventListener('click', (e) => {
  const row = e.target.closest('[data-k]');
  const x = e.target.closest('[data-x]')?.dataset.x;
  if (!row || !x) return;
  const k = row.dataset.k;
  if (x === 'login') { $('#accounts').close(); newCard('term', k, { title: `${cfg.agents[k].label}` }); }
  if (x === 'remove' && confirm(`Remove "${cfg.agents[k].label}" from AgentBoard? Its folder and session stay on disk.`)) {
    delete cfg.agents[k];
    cfg.autoAgents = (cfg.autoAgents || []).filter((a) => a !== k);
    save(); renderAgentButtons(); renderClaudeAccounts();
  }
});

$('#addClaudeAccount').onclick = async () => {
  const input = $('#claudeAccountName');
  const name = input.value.trim();
  if (!name) return input.focus();
  const r = await ab.claudeAccountDir(name);
  if (!r.ok) return toast(esc(r.error));
  const key = `claude-${r.value.slug}`;
  if (cfg.agents[key]) return toast('An account with that name already exists.');
  const base = cfg.agents.claude || {};
  const n = Object.values(cfg.agents).filter((a) => a.env?.CLAUDE_CONFIG_DIR).length;
  cfg.agents[key] = {
    label: `Claude · ${name}`, command: 'claude', resumeArgs: '--continue',
    lightArgs: base.lightArgs || '--model haiku', heavyArgs: base.heavyArgs || '--model opus',
    color: ACCOUNT_COLORS[n % ACCOUNT_COLORS.length], env: { CLAUDE_CONFIG_DIR: r.value.dir },
  };
  cfg.autoAgents = [...new Set([...(cfg.autoAgents || ['claude']), key])];
  input.value = '';
  await saveNow();
  renderAgentButtons(); renderClaudeAccounts();
  $('#accounts').close();
  newCard('term', key, { title: `${cfg.agents[key].label} · sign in` });
  toast(`Sign in with your other account in this card (<code>/login</code>). From then on, "auto" spreads tasks across your accounts.`, 7000);
};

function renderCatalog() {
  const box = $('#catalogRows');
  box.innerHTML = '';
  for (const item of catalog) {
    if (item.key === 'ollama') continue; // listed under "Local Models"
    const row = document.createElement('div');
    row.className = 'hub-row';
    const pinned = !!cfg.agents[item.key] && !cfg.agents[item.key].hidden;
    const [cls, badge] = !item.installed ? ['no', 'Not installed']
      : item.loggedIn === true ? ['ok', 'Signed in']
      : item.loggedIn === false ? ['no', 'Signed out'] : ['', 'Installed'];
    const detail = !item.installed ? `<code>${esc(item.install)}</code>`
      : item.where ? `${esc(item.plan)} · session in ${esc(item.where)}` : `${esc(item.plan)} · sign in inside the CLI`;
    const action = !item.installed ? 'Install' : item.loggedIn === false ? 'Sign In' : 'Open';
    row.innerHTML = `
      <span class="dot" style="background:${esc(item.color)};color:${esc(item.color)}"></span>
      <span class="meta"><strong>${esc(item.label)}</strong><small title="${esc(item.install)}">${detail}</small></span>
      <span class="badge ${cls}">${badge}</span>
      <span class="acts">
        <label class="pin" title="Show it in the bottom bar"><input type="checkbox" ${pinned ? 'checked' : ''}/> bar</label>
        <button type="button" title="${action === 'Install' ? 'Open a terminal with the install command' : action === 'Sign In' ? 'Open the CLI to sign in with your account' : 'Open this agent in the current project'}">${action}</button>
      </span>`;
    $('input', row).onchange = (e) => setPinned(item, e.target.checked);
    $('button', row).onclick = () => {
      $('#accounts').close();
      if (!item.installed) {
        newCard('term', 'shell', { cwd: null, title: `Install ${item.label}`, startCmd: item.install });
      } else if (item.loggedIn === false) {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key, { cwd: null, title: `Sign in · ${item.label}`, startCmd: item.login });
      } else {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key);
      }
    };
    box.appendChild(row);
  }
}

// Ways to use a local model. Names come from the local server: only safe
// characters are accepted because they end up on the command line.
const SAFE_MODEL = /^[\w.:/@+-]+$/;
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const HARNESSES = {
  ollama: [
    { id: 'chat', label: 'Chat (ollama run)', agent: 'ollama', args: (m) => `run ${m}` },
    { id: 'codex', label: 'Codex (--oss)', agent: 'codex', args: (m) => `--oss -m ${m}` },
    { id: 'aider', label: 'Aider', agent: 'aider', args: (m) => `--model ollama_chat/${m}`, env: { OLLAMA_API_BASE: OLLAMA_BASE } },
  ],
  lmstudio: [
    { id: 'aider', label: 'Aider', agent: 'aider', args: (m) => `--model lm_studio/${m}`,
      env: { LM_STUDIO_API_BASE: 'http://127.0.0.1:1234/v1', LM_STUDIO_API_KEY: 'dummy-api-key' } },
  ],
};

function launchLocal(provider, model, harnessId) {
  const h = HARNESSES[provider].find((x) => x.id === harnessId);
  const item = catalog.find((i) => i.key === h.agent);
  if (item) ensureAgent(item, false);
  $('#accounts').close();
  newCard('term', h.agent, { title: `${model} · ${h.label.split(' (')[0]}`, args: h.args(model), env: h.env || null });
  renderAgentButtons();
}

function modelRow(provider, model) {
  const row = document.createElement('div');
  row.className = 'hub-row';
  const opts = HARNESSES[provider].map((h) => {
    const ok = catalog.find((i) => i.key === h.agent)?.installed !== false;
    return `<option value="${h.id}" ${ok ? '' : 'disabled'}>${esc(h.label)}${ok ? '' : ' — not installed'}</option>`;
  }).join('');
  row.innerHTML = `
    <span class="dot" style="background:var(--text);color:var(--text)"></span>
    <span class="meta"><strong>${esc(model)}</strong><small>${provider === 'ollama' ? 'Ollama' : 'LM Studio'} · runs on your machine</small></span>
    <select title="How to open this model">${opts}</select>
    <span class="acts"><button type="button" title="Open the model in a new card">Open</button></span>`;
  $('button', row).onclick = () => launchLocal(provider, model, $('select', row).value);
  return row;
}

function renderLocal(local) {
  const box = $('#localRows');
  box.innerHTML = '';
  const head = (name, badgeCls, badge) => {
    const h = document.createElement('div');
    h.className = 'local-head';
    h.innerHTML = `<strong>${name}</strong><span class="badge ${badgeCls}">${badge}</span>`;
    box.appendChild(h);
  };
  const note = (html) => { const n = document.createElement('div'); n.className = 'local-note'; n.innerHTML = html; box.appendChild(n); return n; };

  // Ollama
  const o = local.ollama;
  const oModels = o.models.filter((x) => SAFE_MODEL.test(x));
  head('Ollama', o.running ? 'ok' : 'no', o.running ? `Running · ${oModels.length} models` : o.installed ? 'Stopped' : 'Not installed');
  if (!o.installed) {
    note('Download it from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a> and refresh.');
  } else if (!o.running) {
    const n = note('Ollama is installed but not running. ');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Start Ollama'; b.title = 'Run ollama serve in a new card';
    b.onclick = () => { $('#accounts').close(); newCard('term', 'shell', { cwd: null, title: 'ollama serve', startCmd: 'ollama serve' }); };
    n.appendChild(b);
  }
  if (o.installed) {
    if (o.running && !oModels.length) note('You have no models yet. Download one below.');
    for (const m of oModels) box.appendChild(modelRow('ollama', m));
    const pull = document.createElement('div');
    pull.className = 'pull-row';
    pull.innerHTML = `<input placeholder="Download a model, e.g. qwen3-coder, gpt-oss:20b, llama3.2" /><button type="button" title="Run ollama pull in a new card">Download</button>`;
    const go = () => {
      const m = $('input', pull).value.trim();
      if (!SAFE_MODEL.test(m)) { $('input', pull).focus(); return; }
      $('#accounts').close();
      newCard('term', 'shell', { cwd: null, title: `ollama pull ${m}`, startCmd: `ollama pull ${m}` });
    };
    $('button', pull).onclick = go;
    $('input', pull).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    box.appendChild(pull);
  }

  // LM Studio
  const l = local.lmstudio;
  const lModels = l.models.filter((x) => SAFE_MODEL.test(x));
  head('LM Studio', l.running ? 'ok' : '', l.running ? `Server running · ${lModels.length} models` : 'Server stopped');
  if (!l.running) note('Open LM Studio → Developer → start the local server (port 1234) and refresh.');
  for (const m of lModels) box.appendChild(modelRow('lmstudio', m));
}

$('#accountsBtn').onclick = openAccounts;
$('#moreAgents').onclick = openAccounts;
$('#accountsRefresh').onclick = renderAccounts;

// ---------- Notifications ----------
function toast(html, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function ping(id) {
  const el = runtime.get(id)?.el;
  if (!el) return;
  el.classList.remove('pinged');
  void el.offsetWidth; // restart the animation
  el.classList.add('pinged');
}

// ---------- Send to… (hand context to another agent) ----------
// Cards that can receive text: running agents, never plain terminals.
const canReceive = (c) => c.type === 'term' && !c.startCmd && !!agentOf(c).command && c.bridge !== false && runtime.get(c.id)?.alive;

function terminalTail(c, n = 40) {
  const term = runtime.get(c.id)?.term;
  if (!term) return '';
  if (term.hasSelection()) return term.getSelection().trim();
  const b = term.buffer.active;
  const end = b.baseY + b.cursorY;
  const lines = [];
  for (let i = Math.max(0, end - n * 3); i <= end; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().split('\n').slice(-n).join('\n');
}

function handoffMenu(c, anchor) {
  closePopover();
  const targets = cfg.cards.filter((x) => x.id !== c.id && canReceive(x));
  const fresh = Object.entries(cfg.agents).filter(([, a]) => a.command && !a.hidden);
  const pop = document.createElement('div');
  pop.className = 'popover handoff';
  pop.innerHTML = `
    <label>To
      <select name="to">
        ${targets.map((x) => `<option value="card:${esc(x.id)}">${esc(x.title)} · ${esc(agentOf(x).label)}</option>`).join('')}
        ${fresh.map(([k, a]) => `<option value="new:${esc(k)}">New ${esc(a.label)} in ${esc(basename(c.cwd) || '~')}</option>`).join('')}
      </select></label>
    <label>Instruction <input name="ask" value="Continue with this:" /></label>
    <label>Context (selection or last lines) <textarea name="ctx"></textarea></label>
    <div class="row"><button data-x="cancel">Cancel</button><button data-x="send" class="primary" title="Paste the instruction and context into the chosen agent">Send</button></div>`;
  $('[name=ctx]', pop).value = terminalTail(c);
  openPopover(pop, anchor, 380);
  $('[name=ask]', pop).focus();

  pop.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'cancel') return closePopover();
    if (x !== 'send') return;
    const to = $('[name=to]', pop).value;
    const ctx = $('[name=ctx]', pop).value.trim();
    const text = `${$('[name=ask]', pop).value.trim()}\n\n[Context from ${c.title} (${agentOf(c).label})]\n${ctx}`.trim();
    closePopover();
    if (to.startsWith('card:')) {
      const target = cardData(to.slice(5));
      await ab.ptyPaste(target.id, text);
      ping(target.id);
      toast(`${esc(c.title)} <b>→</b> ${esc(target.title)}`);
      addLink(c.id, target.id, 'sent context');
    } else {
      const target = newCard('term', to.slice(4), { cwd: c.cwd, x: c.x + c.w + 28, y: c.y });
      addLink(c.id, target.id, 'sent context');
      toast(`Opening ${esc(target.title)} and sending it the context…`);
      await waitAlive(target.id);
      await new Promise((r) => setTimeout(r, 3500)); // let the CLI finish starting
      await ab.ptyPaste(target.id, text);
      ping(target.id);
    }
  });
}

async function waitAlive(id, ms = 8000) {
  const t0 = Date.now();
  while (!runtime.get(id)?.alive && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
}

// ---------- Agent bridge events ----------
ab.onBridgeEvent((ev) => {
  const from = cardData(ev.from)?.title || 'An agent';
  const to = cardData(ev.to)?.title || 'another agent';
  if (ev.kind === 'send') { ping(ev.to); toast(`${esc(from)} <b>→</b> ${esc(to)}`); }
  else if (ev.kind === 'start') { toast(`${esc(from)} opened <b>${esc(to)}</b>`); }
});

ab.onBridgeNewCard(async ({ reqId, agent, cwd, title, light, from }) => {
  // light: subagent on the cheap model; parent: who asked for it (drawn as a link in the diagram)
  const c = cfg.agents[agent] ? newCard('term', agent, { cwd, ...(title ? { title } : {}), args: light ? (cfg.agents[agent].lightArgs || '') : '', parent: from }) : null;
  if (c) await saveNow(); // the bridge reads the saved board
  ab.bridgeCardCreated(reqId, c ? c.id : null);
});

// ---------- Skills and agents ----------
const PROVIDERS = {
  claude: { label: 'Claude Code', color: () => cfg.agents.claude?.color || '#e8875f' },
  codex: { label: 'Codex', color: () => cfg.agents.codex?.color || '#3fbf8f' },
  gemini: { label: 'Gemini CLI', color: () => cfg.agents.gemini?.color || '#6c9cf5' },
};
const KIND_LABEL = { skill: 'skill', command: 'command', extension: 'extension' };
let skillItems = [];
let agentDefs = [];
let skillProvider = 'all';
let editingAgent = null;

function showTab(name) {
  for (const b of document.querySelectorAll('#skills .tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('#skills section[data-pane]')) s.classList.toggle('hidden', s.dataset.pane !== name);
}

async function openSkills(tab = 'skills') {
  showTab(tab);
  $('#skills').showModal();
  await refreshSkills();
}

async function refreshSkills() {
  $('#skillRows').innerHTML = '<div class="empty-note">Reading your skills…</div>';
  const [items, defs, bridge, avail] = await Promise.all([ab.skillsScan(), ab.agentsList(), ab.bridgeStatus(), ab.checkAgents()]);
  skillItems = items; agentDefs = defs; agentAvailable = avail;
  renderSkillList(); renderAgentDefs(); renderConnect(bridge);
  renderPack(await ab.packStatus());
}

// Token-saving skills bundled with AgentBoard
function renderPack(pack) {
  const label = { ok: 'installed', old: 'outdated' };
  $('#packRows').innerHTML = pack.map((p) => `
    <div class="hub-row skill">
      <span class="dot" style="background:var(--accent);color:var(--accent)"></span>
      <div class="meta"><strong>${esc(p.name)}</strong><span class="desc">${esc(p.description)}</span></div>
      <div class="acts">${Object.keys(PROVIDERS).map((k) => `<span class="badge ${p.installed[k] === 'ok' ? 'ok' : 'no'}" title="${esc(PROVIDERS[k].label)}">${esc(PROVIDERS[k].label)}: ${label[p.installed[k]] || 'not installed'}</span>`).join('')}</div>
      <span></span>
    </div>`).join('') || '<div class="empty-note">The skills-pack folder was not found.</div>';
}
$('#packInstall').onclick = async () => {
  const r = await ab.packInstall(Object.keys(PROVIDERS));
  if (!r.ok) return toast(`Could not install: ${esc(r.error)}`);
  toast(`Token-saving skills installed (${r.value.length}). Restart open agents so they pick them up.`, 5000);
  renderPack(await ab.packStatus());
};

function renderSkillList() {
  const count = (p) => skillItems.filter((x) => p === 'all' || x.provider === p).length;
  $('#skillProviders').innerHTML = ['all', ...Object.keys(PROVIDERS)].map((p) =>
    `<button type="button" data-p="${p}" class="${p === skillProvider ? 'active' : ''}">${p === 'all' ? 'All' : esc(PROVIDERS[p].label)}<span class="n">${count(p)}</span></button>`).join('');

  const q = $('#skillFilter').value.trim().toLowerCase();
  const list = skillItems.filter((x) => (skillProvider === 'all' || x.provider === skillProvider)
    && (!q || `${x.name} ${x.description} ${x.scope}`.toLowerCase().includes(q)));
  const box = $('#skillRows');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-note">${q ? 'No results.'
      : skillProvider === 'claude' ? 'No Claude Code skills found on this computer (<code>~/.claude/skills</code>, your projects or active plugins). Skills you enable on claude.ai live in your web account, not on disk. You can copy a Codex skill here.'
      : skillProvider === 'gemini' ? 'No Gemini CLI skills, commands or extensions found on this computer.'
      : 'No skills found on this computer.'}</div>`;
    return;
  }
  for (const prov of Object.keys(PROVIDERS)) {
    const items = list.filter((x) => x.provider === prov);
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'group-title';
    h.innerHTML = `<span class="dot" style="background:${esc(PROVIDERS[prov].color())}"></span>${esc(PROVIDERS[prov].label)} · ${items.length}`;
    box.appendChild(h);
    for (const s of items) box.appendChild(skillRow(s));
  }
}

function skillRow(s) {
  const row = document.createElement('div');
  row.className = 'hub-row skill';
  const others = Object.keys(PROVIDERS).filter((p) => p !== s.provider);
  row.innerHTML = `
    <span class="dot" style="background:${esc(PROVIDERS[s.provider].color())};color:${esc(PROVIDERS[s.provider].color())}"></span>
    <span class="meta"><strong>${esc(s.name)}<span class="tag">${KIND_LABEL[s.kind] || s.kind}</span></strong>
      <span class="desc" title="${esc(s.description)}">${esc(s.description) || '<i>No description</i>'}</span></span>
    <span class="badge">${esc(s.scope)}</span>
    <span class="acts">
      ${s.kind === 'skill' ? `<select class="copy" title="Copy this skill to another subscription">
        <option value="">Copy to…</option>${others.map((p) => `<option value="${p}">${esc(PROVIDERS[p].label)}</option>`).join('')}</select>` : ''}
      <button type="button" class="icon" title="Show in Finder">${icon('folder', 14)}</button>
    </span>`;
  $('button', row).onclick = () => ab.skillsReveal(s.path);
  const sel = $('select', row);
  if (sel) sel.onchange = async () => {
    const target = sel.value;
    sel.value = '';
    if (!target) return;
    const r = await ab.skillsCopy(s.path, target);
    if (r.ok) { toast(`Skill <b>${esc(s.name)}</b> copied to ${esc(PROVIDERS[target].label)}`); await refreshSkills(); }
    else toast(esc(r.error), 4500);
  };
  return row;
}

$('#skillProviders').addEventListener('click', (e) => {
  const p = e.target.closest('[data-p]')?.dataset.p;
  if (p) { skillProvider = p; renderSkillList(); }
});
$('#skillFilter').addEventListener('input', renderSkillList);

function renderAgentDefs() {
  const box = $('#agentDefRows');
  box.innerHTML = agentDefs.length ? '' : '<div class="empty-note">You have no agents of your own yet. Create one with <b>New Agent</b>.</div>';
  for (const a of agentDefs) {
    const row = document.createElement('div');
    row.className = 'hub-row skill';
    row.innerHTML = `
      <span class="dot" style="background:${esc(PROVIDERS.claude.color())};color:${esc(PROVIDERS.claude.color())}"></span>
      <span class="meta"><strong>${esc(a.name)}${a.model ? `<span class="tag">${esc(a.model)}</span>` : ''}</strong>
        <span class="desc">${esc(a.description) || '<i>No description</i>'}</span></span>
      <span class="badge">${esc(a.scope)}</span>
      <span class="acts"><button type="button" data-a="edit" title="Edit this subagent">Edit</button><button type="button" data-a="del" class="icon" title="Move to the Trash">${icon('trash', 14)}</button></span>`;
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'edit') openAgentForm(a);
      if (act === 'del' && confirm(`Move "${a.name}" to the Trash?`)) {
        const r = await ab.agentsDelete(a.file);
        if (r.ok) { toast(`<b>${esc(a.name)}</b> moved to the Trash`); await refreshSkills(); } else toast(esc(r.error), 4500);
      }
    });
    box.appendChild(row);
  }
}

function openAgentForm(a = null) {
  editingAgent = a;
  const f = $('#skillsForm');
  f.adProject.innerHTML = '<option value="">User (all projects)</option>'
    + cfg.projects.map((p) => `<option value="${esc(p.path)}">Project · ${esc(p.name)}</option>`).join('');
  f.adName.value = a?.name || '';
  f.adProject.value = a?.project || '';
  f.adDescription.value = a?.description || '';
  f.adModel.value = a?.model || '';
  f.adTools.value = a?.tools || '';
  f.adPrompt.value = a?.prompt || '';
  $('#agentFormError').textContent = '';
  $('#agentForm').classList.remove('hidden');
  $('#newAgentDef').classList.add('hidden');
  f.adName.focus();
}

function closeAgentForm() {
  editingAgent = null;
  $('#agentForm').classList.add('hidden');
  $('#newAgentDef').classList.remove('hidden');
}

$('#newAgentDef').onclick = () => openAgentForm();
$('#agentFormCancel').onclick = closeAgentForm;
$('#agentFormSave').onclick = async () => {
  const f = $('#skillsForm');
  const r = await ab.agentsSave({
    file: editingAgent?.file || null,
    name: f.adName.value.trim(), project: f.adProject.value || null,
    description: f.adDescription.value, model: f.adModel.value, tools: f.adTools.value, prompt: f.adPrompt.value,
  });
  if (!r.ok) { $('#agentFormError').textContent = r.error; return; }
  toast(`Agent <b>${esc(f.adName.value.trim())}</b> saved`);
  closeAgentForm();
  await refreshSkills();
};

function renderConnect(bridge) {
  const box = $('#mcpRows');
  box.innerHTML = '';
  for (const key of Object.keys(PROVIDERS)) {
    const installed = agentAvailable[key] !== false;
    const on = bridge.connected[key];
    const row = document.createElement('div');
    row.className = 'hub-row';
    row.innerHTML = `
      <span class="dot" style="background:${esc(PROVIDERS[key].color())};color:${esc(PROVIDERS[key].color())}"></span>
      <span class="meta"><strong>${esc(PROVIDERS[key].label)}</strong>
        <small>${!installed ? 'Not installed' : on ? 'Can see and message the other agents on the board' : 'Does not know the other agents yet'}</small></span>
      <span class="badge ${on ? 'ok' : ''}">${on ? 'Connected' : 'Not connected'}</span>
      <span class="acts"><button type="button" ${installed ? '' : 'disabled'} title="${on ? 'Remove the AgentBoard MCP server from this CLI' : 'Register the AgentBoard MCP server in this CLI'}">${on ? 'Disconnect' : 'Connect'}</button></span>`;
    $('button', row).onclick = () => {
      $('#skills').close();
      newCard('term', 'shell', { cwd: null, title: `${on ? 'Disconnect' : 'Connect'} ${PROVIDERS[key].label}`, startCmd: bridge.commands[key][on ? 'remove' : 'add'] });
      toast(on ? 'Disconnecting…' : 'Connecting… Restart the agents that were already open so they see the connection.', 5000);
    };
    box.appendChild(row);
  }

  const list = $('#boardAgentRows');
  const agents = cfg.cards.filter((c) => c.type === 'term' && agentOf(c).command && !c.startCmd);
  list.innerHTML = agents.length ? '' : '<div class="empty-note">No agents are open on the board.</div>';
  for (const c of agents) {
    const st = runtime.get(c.id)?.status || '';
    const row = document.createElement('div');
    row.className = 'hub-row';
    row.style.setProperty('--agent', agentOf(c).color);
    row.innerHTML = `
      <span class="status ${st}" title="${STATUS_LABEL[st] || ''}"></span>
      <span class="meta"><strong>${esc(c.title)}</strong><small>${esc(agentOf(c).label)} · ${esc(basename(c.cwd) || '~')}</small></span>
      <label class="switch"><input type="checkbox" ${c.bridge !== false ? 'checked' : ''}/> accepts messages</label>
      <span class="acts"><button type="button" title="Go to this agent's card">Go</button></span>`;
    $('input', row).onchange = (e) => { c.bridge = e.target.checked; save(); };
    $('button', row).onclick = () => { $('#skills').close(); focusCardView(c); focusCard(c.id); };
    list.appendChild(row);
  }
}

$('#skillsBtn').onclick = () => openSkills();
$('#skillsRefresh').onclick = refreshSkills;
$('#skills .tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) showTab(t); });
// Enter in a field must not close the dialog (it is a <form method="dialog">).
$('#skillsForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });

// ---------- Toolbar ----------
// ---------- Spaces: one tab per project (like an IDE) ----------
// Every tab keeps running; the tab only decides which cards you see and where the
// next agent opens. "All" shows the whole board.
const spaceOf = (c) => (c.type === 'term' ? projectOfPath(c.cwd) : (c.space ?? ''));
const currentSpace = () => (cfg.activeSpace && cfg.activeSpace !== '*' ? cfg.activeSpace : (cfg.selectedProject || ''));
function inSpace(c) {
  const a = cfg.activeSpace || '*';
  if (a === '*') return true;
  const sp = spaceOf(c);
  return sp === a || (c.type !== 'term' && !sp);
}
const shownCards = () => cfg.cards.filter(inSpace);

function switchSpace(key, { keepView = false } = {}) {
  const prev = cfg.activeSpace || '*';
  if (prev === key) return;
  cfg.viewports = cfg.viewports || {};
  cfg.viewports[prev] = { ...cfg.viewport };
  cfg.activeSpace = key;
  if (key !== '*') cfg.selectedProject = key;
  for (const c of cfg.cards) { const rt = runtime.get(c.id); if (rt) rt.el.style.display = inSpace(c) ? '' : 'none'; }
  const saved = cfg.viewports[key];
  if (saved && !keepView) { cfg.viewport = { ...saved }; applyViewport(); } else if (!keepView) fitAll(); else applyViewport();
  renderSpaces(); updateEmpty(); renderSidebar(); drawMinimap();
  document.title = key === '*' ? 'AgentBoard' : `${spaceName(key)} — AgentBoard`;
  if (typeof renderTaskOptions === 'function') renderTaskOptions();
  save();
}
const spaceName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || 'Home folder';

function renderSpaces() {
  const box = $('#spaceTabs');
  const active = cfg.activeSpace || '*';
  const tabs = [['*', 'All'], ...cfg.projects.map((p) => [p.path, p.name])];
  box.innerHTML = tabs.map(([k, name]) => `<button type="button" data-space="${esc(k)}" class="${k === active ? 'active' : ''}" title="${esc(k === '*' ? 'All projects' : k)}">
    <span class="sp-name">${esc(name)}</span><span class="sp-badge" data-badge="${esc(k)}"></span></button>`).join('')
    || '<span class="muted small">Add a project →</span>';
  updateSpaceBadges();
}

function updateSpaceBadges() {
  const counts = {};
  for (const c of cfg.cards) {
    if (c.type !== 'term') continue;
    const sp = spaceOf(c);
    counts[sp] = counts[sp] || { n: 0, busy: 0 };
    counts[sp].n++;
    if (runtime.get(c.id)?.status === 'busy') counts[sp].busy++;
  }
  const all = Object.values(counts).reduce((a, x) => ({ n: a.n + x.n, busy: a.busy + x.busy }), { n: 0, busy: 0 });
  for (const el of document.querySelectorAll('#spaceTabs [data-badge]')) {
    const k = el.dataset.badge;
    const x = k === '*' ? all : counts[k] || { n: 0, busy: 0 };
    const txt = x.n ? String(x.n) : '';
    if (el.textContent !== txt) el.textContent = txt;
    el.classList.toggle('busy', x.busy > 0);
    el.title = x.n ? `${x.n} agent${x.n === 1 ? '' : 's'} · ${x.busy} working` : '';
  }
}
const renderProjects = renderSpaces;

async function addProject() {
  const dir = await ab.pickFolder();
  if (!dir) return false;
  if (!cfg.projects.some((p) => p.path === dir)) cfg.projects.push({ path: dir, name: basename(dir) });
  cfg.selectedProject = dir;
  renderSpaces(); switchSpace(dir); save();
  return true;
}

function renderAgentButtons() {
  const box = $('#agentButtons');
  const mod = isMac() ? '⇧⌘' : 'Ctrl+Shift+';
  const shortcuts = { claude: 1, codex: 2, gemini: 3, shell: 4 };
  box.innerHTML = '';
  for (const [key, a] of Object.entries(cfg.agents)) {
    if (a.hidden) continue;
    const b = document.createElement('button');
    const missing = agentAvailable[key] === false;
    b.className = 'chip' + (missing ? ' missing' : '');
    b.innerHTML = `<span class="dot" style="background:${esc(a.color)};color:${esc(a.color)}"></span>${esc(a.label)}`;
    b.title = missing
      ? `"${a.command}" is not on this computer's PATH`
      : `Open ${a.label} in the project${shortcuts[key] ? ` (${mod}${shortcuts[key]})` : ''}`;
    b.onclick = () => newCard('term', key);
    box.appendChild(b);
  }
}

function updateEmpty() { $('#empty').classList.toggle('hidden', shownCards().length > 0); }

$('#spaceTabs').addEventListener('click', (e) => { const k = e.target.closest('[data-space]')?.dataset.space; if (k) switchSpace(k); });
$('#addProject').onclick = addProject;
$('#addNote').onclick = () => newCard('note');
$('#addGroup').onclick = () => newGroup();
$('#tasksBtn').onclick = () => toggleTasks();
$('#diagramBtn').onclick = () => toggleDiagram();
$('#paletteBtn').onclick = () => openPalette();
$('#arrange').onclick = arrange;
$('#fit').onclick = fitAll;
$('#settingsBtn').onclick = openSettings;

ab.onMenu((action) => {
  if (action.startsWith('new:')) {
    const k = action.slice(4);
    if (k === 'note') newCard('note');
    else if (k === 'group') newGroup();
    else if (cfg.agents[k]) newCard('term', k);
  } else if (action === 'arrange') arrange();
  else if (action === 'fit') fitAll();
  else if (action === 'zoom:in') zoomCenter(1.2);
  else if (action === 'zoom:out') zoomCenter(1 / 1.2);
  else if (action === 'settings') openSettings();
  else if (action === 'sidebar') toggleSidebar();
  else if (action === 'accounts') openAccounts();
  else if (action === 'skills') openSkills();
  else if (action === 'tasks') toggleTasks();
  else if (action === 'diagram') toggleDiagram();
  else if (action === 'palette') openPalette();
  else if (action === 'shortcuts') openSettings('keys');
  else if (action === 'flows') toggleFlows();
  else if (action === 'space:next' || action === 'space:prev' || action === 'space:all') {
    const keys = ['*', ...cfg.projects.map((p) => p.path)];
    if (action === 'space:all') switchSpace('*');
    else {
      const i = keys.indexOf(cfg.activeSpace || '*');
      switchSpace(keys[(i + (action === 'space:next' ? 1 : -1) + keys.length) % keys.length]);
    }
  }
  else if (action === 'quick-task') { if (diagramOpen()) toggleDiagram(false); openTasks(); }
});

// ---------- Settings rows ----------
function agentRow(key, a) {
  const row = document.createElement('div');
  row.className = 'agent-row';
  row.dataset.key = key;
  const builtin = ['claude', 'codex', 'gemini', 'shell'].includes(key);
  row.innerHTML = `
    <input type="color" name="color" value="${esc(a.color)}" />
    <input name="label" value="${esc(a.label)}" placeholder="Name" />
    <input name="command" value="${esc(a.command)}" placeholder="${key === 'shell' ? '(shell only)' : 'command'}" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="resumeArgs" value="${esc(a.resumeArgs)}" placeholder="resume args" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="lightArgs" value="${esc(a.lightArgs || '')}" placeholder="light args (!)" title="Tasks marked with ! (cheaper model)" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="heavyArgs" value="${esc(a.heavyArgs || '')}" placeholder="heavy args (!!)" title="Tasks marked with !! (most capable model)" ${key === 'shell' ? 'disabled' : ''}/>
    ${builtin ? '<span></span>' : `<button type="button" class="card-btn" title="Delete this custom agent">${icon('close', 13)}</button>`}`;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  return row;
}

function projectRow(p) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = p.path;
  row.innerHTML = `<input name="name" value="${esc(p.name)}" /><span class="path" title="${esc(p.path)}">${esc(p.path)}</span>
    <button type="button" class="card-btn" title="Remove the project from the list (keeps the folder)">${icon('close', 13)}</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

// ---------- Appearance ----------
// cfg.ui = { theme: auto|light|dark, accent, uiSize, font: system|geist, termTheme: auto|light|dark, lineHeight }
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#8e8e93'];
const TERM_THEMES = {
  dark: {
    background: '#1c1c1e', foreground: '#f2f2f7', cursorAccent: '#1c1c1e', selectionBackground: 'rgba(10,132,255,.35)',
    black: '#3a3a3c', red: '#ff6961', green: '#4ade80', yellow: '#ffd60a', blue: '#64a8ff', magenta: '#d18cff', cyan: '#64d2ff', white: '#e5e5ea',
    brightBlack: '#8e8e93', brightRed: '#ff8a80', brightGreen: '#86efac', brightYellow: '#ffe066', brightBlue: '#8cc2ff', brightMagenta: '#e0b0ff', brightCyan: '#9ae6ff', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1d1d1f', cursorAccent: '#ffffff', selectionBackground: 'rgba(0,122,255,.22)',
    black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#a05a00', blue: '#0040dd', magenta: '#8944ab', cyan: '#0071a4', white: '#6e6e73',
    brightBlack: '#8e8e93', brightRed: '#ff3b30', brightGreen: '#34c759', brightYellow: '#c27c0e', brightBlue: '#007aff', brightMagenta: '#af52de', brightCyan: '#0a95c4', brightWhite: '#3a3a3c',
  },
};
const ui = () => ({ theme: 'auto', accent: ACCENTS[0], uiSize: 13, font: 'system', termTheme: 'auto', lineHeight: 1.15, ...(cfg.ui || {}) });
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = (mode) => (mode === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : mode);
function termTheme(c, u = lastUi || ui()) {
  const t = TERM_THEMES[resolvedTheme(u.termTheme === 'auto' ? u.theme : u.termTheme)];
  return { ...t, cursor: agentOf(c).color };
}
function hexRgb(h) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || ''); return m ? m.slice(1).map((x) => parseInt(x, 16)).join(', ') : '10, 132, 255'; }

let lastUi = null; // last applied appearance (includes the Settings preview)
function applyAppearance(u = ui()) {
  lastUi = u;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(u.theme);
  root.dataset.font = u.font;
  root.style.setProperty('--accent', u.accent);
  root.style.setProperty('--accent-rgb', hexRgb(u.accent));
  root.style.setProperty('--ui-scale', `${u.uiSize}px`);
  ab.setTheme(u.theme);
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt?.term) continue;
    rt.term.options.theme = termTheme(c, u);
    rt.term.options.lineHeight = u.lineHeight;
    rt.term.options.fontFamily = getComputedStyle(root).getPropertyValue('--font-mono');
  }
  applyViewport();
}
// the system switched light/dark (or we did, via nativeTheme): re-apply what is on screen
darkMQ.addEventListener('change', () => applyAppearance(lastUi || ui()));

// ---------- Settings ----------
let shortcutDefs = [];
let draftKeys = {};
let draftUi = null;

function showSettingsSection(sec) {
  for (const b of document.querySelectorAll('.set-nav [data-sec]')) b.classList.toggle('active', b.dataset.sec === sec);
  for (const x of document.querySelectorAll('.set-body > section')) x.classList.toggle('hidden', x.dataset.sec !== sec);
}
$('.set-nav').addEventListener('click', (e) => { const s = e.target.closest('[data-sec]')?.dataset.sec; if (s) showSettingsSection(s); });

// "CmdOrCtrl+Shift+T" → "⇧⌘T" (Mac) / "Ctrl+Shift+T"
function prettyKey(acc) {
  if (!acc) return '—';
  if (!isMac()) return acc.replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ');
  const sym = { CmdOrCtrl: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Right: '→', Left: '←', Up: '↑', Down: '↓', Space: 'Space', Plus: '+' };
  const parts = acc.split('+').map((p) => sym[p] || p);
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const mods = parts.filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return mods.join('') + parts.filter((p) => !order.includes(p)).join('');
}
// Pressed key → Electron accelerator
function accelFromEvent(e) {
  const k = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null;
  const map = { ' ': 'Space', ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus' };
  let key = map[k] || (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : k.length === 1 ? k.toUpperCase() : k);
  const mods = [];
  if (isMac() ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl');
  if (isMac() && e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length && !/^F\d+$/.test(key)) return null; // without a modifier it is not a shortcut
  return [...mods, key].join('+');
}

function renderKeyRows() {
  const box = $('#keyRows');
  const sections = [...new Set(shortcutDefs.map((x) => x.section))];
  const used = {};
  for (const d of shortcutDefs) { const k = d.id in draftKeys ? draftKeys[d.id] : d.key; if (k) (used[k] = used[k] || []).push(d.label); }
  box.innerHTML = sections.map((sec) => `<h3>${esc(sec)}</h3><div class="set-group">${shortcutDefs.filter((d) => d.section === sec).map((d) => {
    const key = d.id in draftKeys ? draftKeys[d.id] : d.key;
    const clash = key && used[key].length > 1;
    return `<div class="set-row">${esc(d.label)}<span class="key-cell">${key !== d.key ? `<button type="button" class="card-btn" data-reset="${esc(d.id)}" title="Restore ${esc(prettyKey(d.key))}">${icon('refresh', 13)}</button>` : ''}
      <button type="button" class="keycap ${clash ? 'clash' : ''}" data-key="${esc(d.id)}" title="${clash ? 'Also used by: ' + esc(used[key].filter((l) => l !== d.label).join(', ')) : 'Click to change'}">${esc(prettyKey(key))}</button></span></div>`;
  }).join('')}</div>`).join('');
}
$('#keyRows').addEventListener('click', (e) => {
  const r = e.target.closest('[data-reset]');
  if (r) { delete draftKeys[r.dataset.reset]; renderKeyRows(); return; }
  const b = e.target.closest('[data-key]');
  if (!b) return;
  b.classList.add('recording'); b.textContent = 'Press keys…';
  const onKey = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === 'Escape') return done();
    if (ev.key === 'Backspace' || ev.key === 'Delete') { draftKeys[b.dataset.key] = ''; return done(); }
    const acc = accelFromEvent(ev);
    if (!acc) return;
    draftKeys[b.dataset.key] = acc; done();
  };
  const done = () => { window.removeEventListener('keydown', onKey, true); renderKeyRows(); };
  window.addEventListener('keydown', onKey, true);
});
$('#keysReset').onclick = () => { draftKeys = {}; renderKeyRows(); };

// Appearance: live preview
function renderAppearanceForm() {
  const f = $('#settingsForm');
  const u = draftUi;
  for (const [id, key] of [['themeSeg', 'theme'], ['fontSeg', 'font'], ['termSeg', 'termTheme']]) {
    for (const b of $('#' + id).querySelectorAll('[data-v]')) b.classList.toggle('active', b.dataset.v === u[key]);
  }
  $('#accentSwatches').innerHTML = ACCENTS.map((c) => `<button type="button" data-accent="${c}" class="${c === u.accent ? 'on' : ''}" style="background:${c}"></button>`).join('')
    + `<input type="color" id="accentCustom" value="${esc(u.accent)}" title="Custom color" />`;
  f.uiSize.value = u.uiSize; $('#uiSizeOut').textContent = `${u.uiSize}px`;
  f.lineHeight.value = u.lineHeight; $('#lineHeightOut').textContent = (+u.lineHeight).toFixed(2);
  $('#fontSizeOut').textContent = `${f.fontSize.value}px`;
}
function previewUi(patch) { Object.assign(draftUi, patch); applyAppearance(draftUi); renderAppearanceForm(); }
for (const [id, key] of [['themeSeg', 'theme'], ['fontSeg', 'font'], ['termSeg', 'termTheme']]) {
  $('#' + id).addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) previewUi({ [key]: v }); });
}
$('#accentSwatches').addEventListener('click', (e) => { const c = e.target.closest('[data-accent]')?.dataset.accent; if (c) previewUi({ accent: c }); });
$('#accentSwatches').addEventListener('input', (e) => { if (e.target.id === 'accentCustom') { Object.assign(draftUi, { accent: e.target.value }); applyAppearance(draftUi); } });
$('#settingsForm').uiSize.addEventListener('input', (e) => previewUi({ uiSize: +e.target.value }));
$('#settingsForm').lineHeight.addEventListener('input', (e) => previewUi({ lineHeight: +e.target.value }));
$('#settingsForm').fontSize.addEventListener('input', (e) => {
  $('#fontSizeOut').textContent = `${e.target.value}px`;
  cfg.fontSizePreview = +e.target.value; for (const c of cfg.cards) layoutCard(c);
});

// Advanced: settings as JSON (without cards, tasks or flows)
const BULKY = ['cards', 'tasks', 'flows', 'viewport', 'viewports', 'version'];
function settingsJson() {
  const o = {};
  for (const [k, v] of Object.entries(cfg)) if (!BULKY.includes(k) && k !== 'fontSizePreview') o[k] = v;
  return JSON.stringify(o, null, 2);
}
$('#cfgJsonApply').onclick = async () => {
  let obj;
  try { obj = JSON.parse($('#cfgJson').value); } catch (err) { $('#cfgJsonError').textContent = 'Invalid JSON: ' + err.message; return; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { $('#cfgJsonError').textContent = 'It must be an object { … }.'; return; }
  if (obj.agents && typeof obj.agents !== 'object') { $('#cfgJsonError').textContent = '"agents" must be an object.'; return; }
  for (const k of Object.keys(cfg)) if (!BULKY.includes(k) && !(k in obj)) delete cfg[k]; // removed keys
  for (const [k, v] of Object.entries(obj)) if (!BULKY.includes(k)) cfg[k] = v;
  if (!cfg.agents?.shell) cfg.agents = { ...(cfg.agents || {}), shell: { label: 'Terminal', command: '', resumeArgs: '', color: '#8e8e93' } };
  await ab.saveConfig(cfg);
  $('#settings').close('cancel');
  location.reload(); // re-read everything; terminals resume
};

async function openSettings(section = 'general') {
  const dlg = $('#settings');
  const f = $('#settingsForm');
  f.machineName.value = cfg.machineName;
  f.shell.value = cfg.shell;
  f.fontSize.value = cfg.fontSize;
  f.resumeOnOpen.checked = cfg.resumeOnOpen;
  f.keepRunning.checked = cfg.keepRunning !== false;
  f.quickKey.value = cfg.quickKey ?? 'Control+Alt+Space';
  f.taskAuto.checked = !!cfg.taskAuto;
  f.maxParallel.value = cfg.maxParallel || 3;
  f.perAgentParallel.value = cfg.perAgentParallel || 2;
  f.taskWorktrees.checked = !!cfg.taskWorktrees;
  const rows = $('#agentRows'); rows.innerHTML = '';
  for (const [k, a] of Object.entries(cfg.agents)) rows.appendChild(agentRow(k, a));
  const prow = $('#projectRows'); prow.innerHTML = '';
  cfg.projects.forEach((p) => prow.appendChild(projectRow(p)));
  if (!cfg.projects.length) prow.innerHTML = '<span class="muted small">No projects yet.</span>';
  shortcutDefs = await ab.shortcutsList();
  draftKeys = { ...(cfg.shortcuts || {}) };
  renderKeyRows();
  draftUi = ui();
  renderAppearanceForm();
  $('#cfgJson').value = settingsJson();
  $('#cfgJsonError').textContent = '';
  showSettingsSection(section);
  dlg.showModal();
}

$('#addAgent').onclick = () => {
  $('#agentRows').appendChild(agentRow('custom-' + uid(), { label: '', command: '', resumeArgs: '', color: '#bf5af2' }));
};
$('#revealCfg').onclick = (e) => { e.preventDefault(); ab.revealConfig(); };

$('#settings').addEventListener('close', async () => {
  delete cfg.fontSizePreview;
  if ($('#settings').returnValue !== 'ok') { applyAppearance(); for (const c of cfg.cards) layoutCard(c); return; }
  const f = $('#settingsForm');
  cfg.machineName = f.machineName.value.trim() || cfg.machineName;
  cfg.shell = f.shell.value.trim();
  cfg.fontSize = clamp(+f.fontSize.value || 13, 9, 24);
  cfg.resumeOnOpen = f.resumeOnOpen.checked;
  cfg.keepRunning = f.keepRunning.checked;
  cfg.quickKey = f.quickKey.value.trim();
  cfg.taskAuto = f.taskAuto.checked;
  cfg.maxParallel = clamp(+f.maxParallel.value || 3, 1, 12);
  cfg.perAgentParallel = clamp(+f.perAgentParallel.value || 2, 1, 6);
  cfg.taskWorktrees = f.taskWorktrees.checked;
  cfg.ui = { ...draftUi };
  cfg.shortcuts = Object.fromEntries(Object.entries(draftKeys).filter(([id, k]) => shortcutDefs.find((d) => d.id === id)?.key !== k));

  const agents = {};
  for (const row of document.querySelectorAll('#agentRows .agent-row')) {
    const get = (n) => row.querySelector(`[name=${n}]`).value.trim();
    const key = row.dataset.key;
    if (key !== 'shell' && !get('command')) continue;
    agents[key] = { ...(cfg.agents[key] || {}), label: get('label') || get('command') || key, command: key === 'shell' ? '' : get('command'), resumeArgs: key === 'shell' ? '' : get('resumeArgs'), lightArgs: key === 'shell' ? '' : get('lightArgs'), heavyArgs: key === 'shell' ? '' : get('heavyArgs'), color: get('color') };
  }
  if (!agents.shell) agents.shell = { label: 'Terminal', command: '', resumeArgs: '', color: '#8e8e93' };
  cfg.agents = agents;

  const names = new Map([...document.querySelectorAll('#projectRows .project-row')].map((r) => [r.dataset.path, r.querySelector('[name=name]').value.trim()]));
  cfg.projects = cfg.projects.filter((p) => names.has(p.path)).map((p) => ({ ...p, name: names.get(p.path) || basename(p.path) }));
  if (!cfg.projects.some((p) => p.path === cfg.selectedProject)) cfg.selectedProject = cfg.projects[0]?.path || null;
  if (cfg.activeSpace && cfg.activeSpace !== '*' && !cfg.projects.some((p) => p.path === cfg.activeSpace)) cfg.activeSpace = '*';

  await ab.saveConfig(cfg);
  ab.rebuildMenu();
  ab.applyQuickKey().then((r) => { if (!r.ok) toast(esc(r.error), 5000); });
  $('#machine').textContent = cfg.machineName;
  applyAppearance();
  renderSpaces();
  for (const c of cfg.cards) { refreshCardHead(c); const rt = runtime.get(c.id); if (rt) rt.el.style.display = inSpace(c) ? '' : 'none'; }
  renderSidebar();
  if (typeof renderTaskOptions === 'function') renderTaskOptions();
  agentAvailable = await ab.checkAgents();
  renderAgentButtons();
  applyViewport();
});

// ---------- Startup ----------
// Boards saved by Spanish-language versions (before 0.4) used Spanish values.
const LEGACY_TASK_STATUS = { pendiente: 'pending', en_curso: 'running', revisar: 'review', hecho: 'done', bloqueado: 'blocked' };
const LEGACY_MODE = { ligero: 'light', potente: 'heavy' };
function migrateLegacy(c) {
  for (const t of c.tasks || []) if (LEGACY_TASK_STATUS[t.status]) t.status = LEGACY_TASK_STATUS[t.status];
  for (const f of c.flows || []) {
    for (const n of f.nodes || []) if (n.config && LEGACY_MODE[n.config.mode]) n.config.mode = LEGACY_MODE[n.config.mode];
    for (const e of f.edges || []) if (e.branch === 'si') e.branch = 'yes';
    if (f.lastRun) f.lastRun.results = {};
  }
}

(async function init() {
  const res = await ab.loadConfig();
  // tasks.js and diagram.js load after this file
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  cfg = res.config;
  migrateLegacy(cfg);
  platform = res.platform;
  document.body.classList.toggle('mac', isMac());
  $('#cfgPath').textContent = res.configPath;
  $('#machine').textContent = cfg.machineName;

  renderProjects();
  renderAgentButtons();
  ab.checkAgents().then((r) => { agentAvailable = r; renderAgentButtons(); });

  // Windows shortcuts in the empty-board hint
  if (!isMac()) $('#empty').innerHTML = $('#empty').innerHTML.replace(/⇧⌘/g, 'Ctrl+Shift+');

  applyAppearance();
  renderSpaces();
  document.title = cfg.activeSpace && cfg.activeSpace !== '*' ? `${spaceName(cfg.activeSpace)} — AgentBoard` : 'AgentBoard';
  document.body.classList.toggle('sidebar-open', !!cfg.sidebarOpen);
  // groups first, so they sit behind the cards
  for (const c of [...cfg.cards].sort((a, b) => (b.type === 'group') - (a.type === 'group'))) {
    mountCard(c, { resume: true });
    if (!inSpace(c)) runtime.get(c.id).el.style.display = 'none';
  }
  applyViewport();
  updateEmpty();
  renderSidebar();
  initTasks();
  initDiagram();
  initFlows();
  refreshGit();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
