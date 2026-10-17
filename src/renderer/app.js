// AgentBoard — UI del tablero (renderer)
/* global Terminal, FitAddon, WebLinksAddon */
'use strict';

/* global ab */ // expuesto por preload.js como window.ab
const $ = (s, el = document) => el.querySelector(s);

const MIN_ZOOM = 0.3, MAX_ZOOM = 2;
const HEAD_H = 32;            // alto de la cabecera de una tarjeta (no escala)
const DEFAULT_W = 720, DEFAULT_H = 440;
const BUSY_MS = 1500;         // salida reciente => "trabajando"

let cfg = null;
let platform = 'darwin';
let agentAvailable = {};
const runtime = new Map();     // id -> { el, term, fit, statusEl, gitEl, lastData, busySince, alive }
let zTop = 1;
let focusedId = null;

const board = $('#board');
const world = $('#world');

// ---------- Utilidades ----------
const uid = () => Math.random().toString(36).slice(2, 10);
const basename = (p) => (p || '').split(/[\\/]/).filter(Boolean).pop() || p;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMac = () => platform === 'darwin';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => ab.saveConfig(cfg), 400);
}

function cardData(id) { return cfg.cards.find((c) => c.id === id); }
function agentOf(card) { return cfg.agents[card.agent] || cfg.agents.shell; }

// ---------- Viewport (zoom semántico: escalamos posición, tamaño y fuente;
// sin transform CSS, así el texto queda nítido y el mouse de xterm funciona) ----------
function applyViewport() {
  const { x, y, zoom } = cfg.viewport;
  const g = 24 * zoom;
  board.style.backgroundSize = `${g}px ${g}px`;
  board.style.backgroundPosition = `${x}px ${y}px`;
  $('#zoomLabel').textContent = Math.round(zoom * 100) + '%';
  for (const c of cfg.cards) layoutCard(c);
  scheduleFitAll();
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
    const fs = Math.max(4, Math.round(cfg.fontSize * zoom * 10) / 10);
    if (rt.term.options.fontSize !== fs) rt.term.options.fontSize = fs;
  }
  if (rt.noteEl) rt.noteEl.style.fontSize = `${Math.max(6, 13 * zoom)}px`;
}

function zoomAt(newZoom, sx, sy) {
  const vp = cfg.viewport;
  newZoom = clamp(newZoom, MIN_ZOOM, MAX_ZOOM);
  // mantener fijo el punto del mundo bajo el cursor
  const wx = (sx - vp.x) / vp.zoom, wy = (sy - vp.y) / vp.zoom;
  vp.zoom = newZoom;
  vp.x = sx - wx * newZoom;
  vp.y = sy - wy * newZoom;
  applyViewport(); save();
}

function zoomCenter(factor) {
  const r = board.getBoundingClientRect();
  zoomAt(cfg.viewport.zoom * factor, r.width / 2, r.height / 2);
}

function fitAll() {
  if (!cfg.cards.length) { cfg.viewport = { x: 0, y: 0, zoom: 1 }; applyViewport(); save(); return; }
  const r = board.getBoundingClientRect();
  const minX = Math.min(...cfg.cards.map((c) => c.x)), minY = Math.min(...cfg.cards.map((c) => c.y));
  const maxX = Math.max(...cfg.cards.map((c) => c.x + c.w)), maxY = Math.max(...cfg.cards.map((c) => c.y + c.h));
  const pad = 40;
  const zoom = clamp(Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY)), MIN_ZOOM, 1);
  cfg.viewport = {
    zoom,
    x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom,
  };
  applyViewport(); save();
}

function focusCardView(c) {
  const r = board.getBoundingClientRect();
  const zoom = clamp(Math.min((r.width - 60) / c.w, (r.height - 60) / c.h), MIN_ZOOM, 1.4);
  cfg.viewport = { zoom, x: (r.width - c.w * zoom) / 2 - c.x * zoom, y: (r.height - c.h * zoom) / 2 - c.y * zoom };
  applyViewport(); save();
}

function arrange() {
  const n = cfg.cards.length;
  if (!n) return;
  const cols = Math.ceil(Math.sqrt(n));
  const gap = 28;
  const colW = Math.max(...cfg.cards.map((c) => c.w));
  const rowH = Math.max(...cfg.cards.map((c) => c.h));
  cfg.cards.forEach((c, i) => {
    c.x = (i % cols) * (colW + gap);
    c.y = Math.floor(i / cols) * (rowH + gap);
  });
  fitAll();
}

// ---------- Fit de terminales (debounced) ----------
const fitQueue = new Set();
let fitTimer = null;
function scheduleFit(id) { fitQueue.add(id); clearTimeout(fitTimer); fitTimer = setTimeout(flushFits, 60); }
function scheduleFitAll() { for (const c of cfg.cards) fitQueue.add(c.id); clearTimeout(fitTimer); fitTimer = setTimeout(flushFits, 80); }
function flushFits() {
  for (const id of fitQueue) {
    const rt = runtime.get(id);
    if (!rt || !rt.term || !rt.fit) continue;
    try {
      rt.fit.fit();
      if (rt.alive) ab.ptyResize(id, rt.term.cols, rt.term.rows);
    } catch {}
  }
  fitQueue.clear();
}

// ---------- Tarjetas ----------
function newCard(type, agentKey) {
  if (type === 'term' && !cfg.selectedProject) {
    const any = cfg.projects[0];
    if (!any) { addProject().then((ok) => ok && newCard(type, agentKey)); return; }
    cfg.selectedProject = any.path;
  }
  const r = board.getBoundingClientRect();
  const vp = cfg.viewport;
  const offset = (cfg.cards.length % 8) * 30;
  const w = type === 'note' ? 360 : DEFAULT_W, h = type === 'note' ? 280 : DEFAULT_H;
  const c = {
    id: uid(), type, agent: agentKey || 'shell',
    cwd: type === 'term' ? cfg.selectedProject : null,
    title: type === 'note' ? 'Nota' : (cfg.agents[agentKey] || cfg.agents.shell).label,
    x: (r.width / 2 - vp.x) / vp.zoom - w / 2 + offset,
    y: (r.height / 2 - vp.y) / vp.zoom - h / 2 + offset,
    w, h, text: '',
  };
  cfg.cards.push(c);
  mountCard(c, { resume: false });
  focusCard(c.id);
  save();
  updateEmpty();
}

function mountCard(c, { resume }) {
  const agent = agentOf(c);
  const el = document.createElement('div');
  el.className = 'card' + (c.type === 'note' ? ' note-card' : '');
  el.style.setProperty('--agent', c.type === 'note' ? '' : agent.color);
  el.style.zIndex = ++zTop;
  el.innerHTML = `
    <div class="card-head">
      <span class="status"></span>
      <span class="title">${esc(c.title)}</span>
      ${c.type === 'term' ? `<span class="proj" title="${esc(c.cwd)}">${esc(basename(c.cwd))}</span>` : ''}
      <span class="spacer"></span>
      ${c.type === 'term' ? `<span class="gitpill hidden"></span>
        <button class="card-btn" data-act="open" title="Abrir carpeta">⌂</button>
        <button class="card-btn" data-act="restart" title="Reiniciar">↻</button>` : ''}
      <button class="card-btn" data-act="zoom" title="Enfocar">⤢</button>
      <button class="card-btn" data-act="close" title="Cerrar">✕</button>
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
    ta.placeholder = 'Notas, prompts, TODOs…';
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
      theme: { background: '#12151b', foreground: '#e6e8ec', cursor: agent.color, selectionBackground: '#3a4150' },
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

function commandFor(c, resume) {
  const a = agentOf(c);
  if (!a.command) return '';
  const args = [c.args, resume && cfg.resumeOnOpen ? a.resumeArgs : ''].filter(Boolean).join(' ');
  return args ? `${a.command} ${args}` : a.command;
}

async function startPty(c, resume) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  try { rt.fit.fit(); } catch {}
  $('.overlay', rt.el)?.remove();
  const res = await ab.ptyCreate({ id: c.id, cwd: c.cwd, command: commandFor(c, resume), cols: rt.term.cols, rows: rt.term.rows });
  if (!res.ok) { showOverlay(c, res.error); return; }
  rt.alive = true;
  rt.lastData = Date.now();
  if (focusedId === c.id) rt.term.focus();
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
  ov.innerHTML = `<div>${esc(msg)}</div><button class="primary">↻ Reiniciar</button>`;
  $('button', ov).onclick = () => restartCard(c);
  $('.card-body', rt.el).appendChild(ov);
}

function closeCard(c) {
  const rt = runtime.get(c.id);
  if (rt?.alive && !confirm(`¿Cerrar "${c.title}"? Se terminará el proceso.`)) return;
  ab.ptyKill(c.id);
  rt?.term?.dispose();
  rt?.el.remove();
  runtime.delete(c.id);
  cfg.cards = cfg.cards.filter((x) => x.id !== c.id);
  save(); updateEmpty();
}

function focusCard(id, focusTerm = true) {
  if (focusedId && focusedId !== id) runtime.get(focusedId)?.el.classList.remove('focused');
  focusedId = id;
  const rt = runtime.get(id);
  if (!rt) return;
  rt.el.classList.add('focused');
  if (+rt.el.style.zIndex < zTop) rt.el.style.zIndex = ++zTop;
  if (focusTerm) (rt.term || rt.noteEl)?.focus();
}

// Copiar/pegar dentro de la terminal.
// Mac: ⌘C copia la selección; ⌘V lo maneja el menú Editar (evento paste nativo).
// Windows: Ctrl+C copia SOLO si hay selección (si no, interrumpe como siempre);
// Ctrl+V usa el paste nativo; Ctrl+Shift+C/V también funcionan.
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
  if (e.ctrlKey && e.shiftKey && k === 'v') { e.preventDefault(); term.paste(ab.paste()); return false; }
  if (e.ctrlKey && k === 'v') return false; // deja pasar el paste nativo
  return true;
}

// Arrastrar, redimensionar, botones
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
    const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); save(); focusCard(c.id); };
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
    save();
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
      else if (act === 'open') ab.openPath(c.cwd);
      return;
    }
    if (e.target.closest('.gitpill')) branchMenu(c, e.target.closest('.gitpill'));
  });
}

// ---------- Datos de los PTY ----------
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
  showOverlay(c, `El proceso terminó (código ${code}).`);
});

// Estado: trabajando / esperando / terminado + aviso cuando un agente termina
setInterval(() => {
  const now = Date.now();
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.term) continue;
    const s = rt.statusEl;
    const busy = rt.alive && now - rt.lastData < BUSY_MS;
    const wasBusy = s.classList.contains('busy');
    s.className = 'status ' + (!rt.alive ? 'dead' : busy ? 'busy' : 'idle');
    s.title = !rt.alive ? 'Terminado' : busy ? 'Trabajando' : 'Esperando';
    // Avisar si trabajó >8 s y ya no lo estás mirando
    if (wasBusy && !busy && rt.lastData - rt.busySince > 8000 && (!document.hasFocus() || focusedId !== c.id)) {
      try { new Notification(`${c.title} terminó`, { body: basename(c.cwd), silent: false }); } catch {}
    }
  }
}, 500);

// ---------- Git ----------
async function refreshGit() {
  const cwds = [...new Set(cfg.cards.filter((c) => c.type === 'term').map((c) => c.cwd))];
  const results = {};
  await Promise.all(cwds.map(async (cwd) => { results[cwd] = await ab.gitStatus(cwd); }));
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.gitEl) continue;
    const g = results[c.cwd];
    if (!g) { rt.gitEl.classList.add('hidden'); continue; }
    rt.gitEl.classList.remove('hidden');
    rt.gitEl.innerHTML = `⎇ ${esc(g.branch)}`
      + (g.changes ? ` <span class="dirty">●${g.changes}</span>` : '')
      + (g.ahead ? ` <span class="ab">↑${g.ahead}</span>` : '')
      + (g.behind ? ` <span class="ab">↓${g.behind}</span>` : '');
    rt.gitEl.title = `${g.changes} cambios sin commit · ${g.ahead} adelante · ${g.behind} atrás — clic para cambiar de rama`;
  }
}
setInterval(refreshGit, 4000);

async function branchMenu(c, anchor) {
  closePopover();
  const [branches, status] = await Promise.all([ab.gitBranches(c.cwd), ab.gitStatus(c.cwd)]);
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = branches.map((b) =>
    `<button data-b="${esc(b)}" class="${b === status?.branch ? 'current' : ''}">${b === status?.branch ? '● ' : '  '}${esc(b)}</button>`).join('')
    + '<hr/><input id="newBranch" placeholder="Nueva rama… (Enter)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text);font:12px var(--font-mono)"/>';
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - 230) + 'px';
  pop.style.top = r.bottom + 4 + 'px';
  document.body.appendChild(pop);

  pop.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (!b) return;
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, b, false))) alert(`No pude cambiar a "${b}". ¿Hay cambios sin commit?`);
    refreshGit();
  });
  const input = $('#newBranch', pop);
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const name = input.value.trim();
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, name, true))) alert(`No pude crear la rama "${name}".`);
    refreshGit();
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  function outside(e) { if (!pop.contains(e.target)) { closePopover(); document.removeEventListener('pointerdown', outside, true); } }
}
function closePopover() { document.querySelectorAll('.popover').forEach((p) => p.remove()); }

// ---------- Pan / zoom del tablero ----------
board.addEventListener('pointerdown', (e) => {
  const onBackground = e.target === board || e.target === world;
  if (!(onBackground && e.button === 0) && e.button !== 1) return;
  e.preventDefault();
  if (onBackground && focusedId) { runtime.get(focusedId)?.el.classList.remove('focused'); focusedId = null; }
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

// pan sin re-fit (el tamaño no cambia)
function applyViewportFast() {
  const { x, y } = cfg.viewport;
  board.style.backgroundPosition = `${x}px ${y}px`;
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (rt) { rt.el.style.left = `${c.x * cfg.viewport.zoom + x}px`; rt.el.style.top = `${c.y * cfg.viewport.zoom + y}px`; }
  }
}

board.addEventListener('wheel', (e) => {
  const r = board.getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {           // pinch del trackpad o ⌘/Ctrl + rueda
    e.preventDefault();
    zoomAt(cfg.viewport.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    return;
  }
  if (e.target.closest('.card-body')) return;  // la terminal/nota hace su propio scroll
  e.preventDefault();
  cfg.viewport.x -= e.deltaX;
  cfg.viewport.y -= e.deltaY;
  applyViewportFast(); save();
}, { passive: false });

window.addEventListener('resize', scheduleFitAll);

// ---------- Barra superior ----------
function renderProjects() {
  const sel = $('#project');
  sel.innerHTML = cfg.projects.length
    ? cfg.projects.map((p) => `<option value="${esc(p.path)}" title="${esc(p.path)}">${esc(p.name)}</option>`).join('')
    : '<option value="">— agrega una carpeta —</option>';
  if (cfg.selectedProject) sel.value = cfg.selectedProject;
}

async function addProject() {
  const dir = await ab.pickFolder();
  if (!dir) return false;
  if (!cfg.projects.some((p) => p.path === dir)) cfg.projects.push({ path: dir, name: basename(dir) });
  cfg.selectedProject = dir;
  renderProjects(); save();
  return true;
}

function renderAgentButtons() {
  const box = $('#agentButtons');
  const mod = isMac() ? '⇧⌘' : 'Ctrl+Shift+';
  const shortcuts = { claude: 1, codex: 2, gemini: 3, shell: 4 };
  box.innerHTML = '';
  for (const [key, a] of Object.entries(cfg.agents)) {
    const b = document.createElement('button');
    const missing = agentAvailable[key] === false;
    b.className = 'agent-btn' + (missing ? ' missing' : '');
    b.innerHTML = `<span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}`;
    b.title = missing
      ? `"${a.command}" no está en el PATH de este computador`
      : `Abrir ${a.label} en el proyecto${shortcuts[key] ? ` (${mod}${shortcuts[key]})` : ''}`;
    b.onclick = () => newCard('term', key);
    box.appendChild(b);
  }
}

function updateEmpty() { $('#empty').classList.toggle('hidden', cfg.cards.length > 0); }

$('#project').addEventListener('change', (e) => { cfg.selectedProject = e.target.value || null; save(); });
$('#addProject').onclick = addProject;
$('#addNote').onclick = () => newCard('note');
$('#arrange').onclick = arrange;
$('#fit').onclick = fitAll;
$('#settingsBtn').onclick = openSettings;

ab.onMenu((action) => {
  if (action.startsWith('new:')) {
    const k = action.slice(4);
    if (k === 'note') newCard('note');
    else if (cfg.agents[k]) newCard('term', k);
  } else if (action === 'arrange') arrange();
  else if (action === 'fit') fitAll();
  else if (action === 'zoom:in') zoomCenter(1.2);
  else if (action === 'zoom:out') zoomCenter(1 / 1.2);
  else if (action === 'settings') openSettings();
});

// ---------- Ajustes ----------
function agentRow(key, a) {
  const row = document.createElement('div');
  row.className = 'agent-row';
  row.dataset.key = key;
  const builtin = ['claude', 'codex', 'gemini', 'shell'].includes(key);
  row.innerHTML = `
    <input type="color" name="color" value="${esc(a.color)}" />
    <input name="label" value="${esc(a.label)}" placeholder="Nombre" />
    <input name="command" value="${esc(a.command)}" placeholder="${key === 'shell' ? '(solo shell)' : 'comando'}" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="resumeArgs" value="${esc(a.resumeArgs)}" placeholder="args al reanudar" ${key === 'shell' ? 'disabled' : ''}/>
    ${builtin ? '<span></span>' : '<button type="button" class="card-btn" title="Eliminar">✕</button>'}`;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  return row;
}

function projectRow(p) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = p.path;
  row.innerHTML = `<input name="name" value="${esc(p.name)}" /><span class="path" title="${esc(p.path)}">${esc(p.path)}</span>
    <button type="button" class="card-btn" title="Quitar de la lista">✕</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

async function openSettings() {
  const dlg = $('#settings');
  const f = $('#settingsForm');
  f.machineName.value = cfg.machineName;
  f.shell.value = cfg.shell;
  f.fontSize.value = cfg.fontSize;
  f.resumeOnOpen.checked = cfg.resumeOnOpen;
  const rows = $('#agentRows'); rows.innerHTML = '';
  for (const [k, a] of Object.entries(cfg.agents)) rows.appendChild(agentRow(k, a));
  const prow = $('#projectRows'); prow.innerHTML = '';
  cfg.projects.forEach((p) => prow.appendChild(projectRow(p)));
  if (!cfg.projects.length) prow.innerHTML = '<span class="muted small">Sin proyectos todavía.</span>';
  dlg.showModal();
}

$('#addAgent').onclick = () => {
  $('#agentRows').appendChild(agentRow('custom-' + uid(), { label: '', command: '', resumeArgs: '', color: '#b07cf5' }));
};
$('#revealCfg').onclick = (e) => { e.preventDefault(); ab.revealConfig(); };

$('#settings').addEventListener('close', async () => {
  if ($('#settings').returnValue !== 'ok') return;
  const f = $('#settingsForm');
  cfg.machineName = f.machineName.value.trim() || cfg.machineName;
  cfg.shell = f.shell.value.trim();
  cfg.fontSize = clamp(+f.fontSize.value || 13, 9, 24);
  cfg.resumeOnOpen = f.resumeOnOpen.checked;

  const agents = {};
  for (const row of document.querySelectorAll('#agentRows .agent-row')) {
    const get = (n) => row.querySelector(`[name=${n}]`).value.trim();
    const key = row.dataset.key;
    if (key !== 'shell' && !get('command')) continue;
    agents[key] = { label: get('label') || get('command') || key, command: key === 'shell' ? '' : get('command'), resumeArgs: key === 'shell' ? '' : get('resumeArgs'), color: get('color') };
  }
  if (!agents.shell) agents.shell = { label: 'Terminal', command: '', resumeArgs: '', color: '#8a8f98' };
  cfg.agents = agents;

  const names = new Map([...document.querySelectorAll('#projectRows .project-row')].map((r) => [r.dataset.path, r.querySelector('[name=name]').value.trim()]));
  cfg.projects = cfg.projects.filter((p) => names.has(p.path)).map((p) => ({ ...p, name: names.get(p.path) || basename(p.path) }));
  if (!cfg.projects.some((p) => p.path === cfg.selectedProject)) cfg.selectedProject = cfg.projects[0]?.path || null;

  await ab.saveConfig(cfg);
  $('#machine').textContent = cfg.machineName;
  renderProjects();
  agentAvailable = await ab.checkAgents();
  renderAgentButtons();
  applyViewport();
});

// ---------- Arranque ----------
(async function init() {
  const res = await ab.loadConfig();
  cfg = res.config;
  platform = res.platform;
  document.body.classList.toggle('mac', isMac());
  $('#cfgPath').textContent = res.configPath;
  $('#machine').textContent = cfg.machineName;

  renderProjects();
  renderAgentButtons();
  ab.checkAgents().then((r) => { agentAvailable = r; renderAgentButtons(); });

  // Sin texto en el placeholder vacío de Windows
  if (!isMac()) $('#empty').innerHTML = $('#empty').innerHTML.replace(/⇧⌘/g, 'Ctrl+Shift+');

  for (const c of cfg.cards) mountCard(c, { resume: true });
  applyViewport();
  updateEmpty();
  refreshGit();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
