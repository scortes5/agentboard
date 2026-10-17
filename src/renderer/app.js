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

// ---------- Viewport (zoom semántico: escalamos posición, tamaño y fuente;
// sin transform CSS, así el texto queda nítido y el mouse de xterm funciona) ----------
// La trama de puntos se mueve con el tablero; los brillos de fondo quedan fijos.
function paintBackground() {
  const { x, y, zoom } = cfg.viewport;
  const g = 24 * zoom;
  board.style.backgroundSize = `${g}px ${g}px, 100% 100%, 100% 100%`;
  board.style.backgroundPosition = `${x}px ${y}px, 0 0, 0 0`;
}

// Zona del tablero que no tapan la barra, el dock ni el panel (los paneles flotan encima).
function visibleRect() {
  const r = board.getBoundingClientRect();
  const left = cfg.sidebarOpen ? 276 : 0, top = 68, bottom = 72, right = cfg.tasksOpen ? 372 : 0;
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
  const v = visibleRect();
  zoomAt(cfg.viewport.zoom * factor, v.left + v.width / 2, v.top + v.height / 2);
}

function fitAll() {
  const v = visibleRect();
  if (!cfg.cards.length) { cfg.viewport = { x: v.left + 40, y: v.top + 20, zoom: 1 }; applyViewport(); save(); return; }
  const minX = Math.min(...cfg.cards.map((c) => c.x)), minY = Math.min(...cfg.cards.map((c) => c.y));
  const maxX = Math.max(...cfg.cards.map((c) => c.x + c.w)), maxY = Math.max(...cfg.cards.map((c) => c.y + c.h));
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
  const v = visibleRect();
  const zoom = clamp(Math.min((v.width - 40) / c.w, (v.height - 30) / c.h), MIN_ZOOM, 1.4);
  cfg.viewport = { zoom, x: v.left + (v.width - c.w * zoom) / 2 - c.x * zoom, y: v.top + (v.height - c.h * zoom) / 2 - c.y * zoom };
  applyViewport(); save();
}

// Ordena en grilla. Con grupos: cada grupo ordena sus tarjetas adentro y se ajusta
// a ellas; los grupos van en fila y las tarjetas sueltas debajo.
function gridLayout(cards, x0, y0, cols) {
  const gap = 28;
  const colW = Math.max(...cards.map((c) => c.w)), rowH = Math.max(...cards.map((c) => c.h));
  cards.forEach((c, i) => { c.x = x0 + (i % cols) * (colW + gap); c.y = y0 + Math.floor(i / cols) * (rowH + gap); });
  return { w: Math.min(cols, cards.length) * (colW + gap) - gap, h: Math.ceil(cards.length / cols) * (rowH + gap) - gap };
}

function arrange() {
  const groups = cfg.cards.filter((c) => c.type === 'group');
  const items = cfg.cards.filter((c) => c.type !== 'group');
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
// opts: { cwd, title, args, env, startCmd, text, x, y, w, h }
function newCard(type, agentKey, opts = {}) {
  if (type === 'term' && !('cwd' in opts) && !cfg.selectedProject) {
    const any = cfg.projects[0];
    if (!any) { addProject().then((ok) => ok && newCard(type, agentKey, opts)); return; }
    cfg.selectedProject = any.path;
  }
  const v = visibleRect();
  const r = { width: v.left * 2 + v.width, height: v.top * 2 + v.height }; // centro del área visible
  const vp = cfg.viewport;
  const offset = (cfg.cards.length % 8) * 30;
  const w = opts.w || (type === 'note' ? 360 : type === 'group' ? DEFAULT_W * 2 + 76 : DEFAULT_W);
  const h = opts.h || (type === 'note' ? 280 : type === 'group' ? DEFAULT_H + 76 : DEFAULT_H);
  const c = {
    id: uid(), type, agent: agentKey || 'shell',
    cwd: type === 'term' ? ('cwd' in opts ? opts.cwd : cfg.selectedProject) : null,
    title: opts.title || (type === 'note' ? 'Nota' : type === 'group' ? 'Grupo' : (cfg.agents[agentKey] || cfg.agents.shell).label),
    args: opts.args || '',
    env: opts.env || null,
    startCmd: opts.startCmd || '',
    x: opts.x ?? (r.width / 2 - vp.x) / vp.zoom - w / 2 + offset,
    y: opts.y ?? (r.height / 2 - vp.y) / vp.zoom - h / 2 + offset,
    w, h, text: opts.text || '',
  };
  if (type === 'group') c.color = opts.color || GROUP_COLORS[cfg.cards.filter((x) => x.type === 'group').length % GROUP_COLORS.length];
  if (type === 'term' && isClaude(cfg.agents[c.agent])) c.sessionId = newSessionId();
  if (opts.prompt) c.prompt = opts.prompt;
  if (opts.taskId) c.taskId = opts.taskId;
  cfg.cards.push(c);
  mountCard(c, { resume: false });
  if (!opts.noFocus) focusCard(c.id);
  save();
  updateEmpty();
  renderSidebar();
  return c;
}

function duplicateCard(c) {
  newCard(c.type, c.agent, {
    cwd: c.cwd, args: c.args, env: c.env, text: c.text, title: `${c.title} (copia)`,
    x: c.x + c.w + 28, y: c.y, w: c.w, h: c.h,
  });
}

function mountCard(c, { resume }) {
  if (c.type === 'group') return mountGroup(c);
  // Sin "reanudar al abrir": cada tarjeta de Claude parte una sesión nueva
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
      ${c.type === 'term' ? `<span class="proj" title="${esc(c.cwd || 'Carpeta personal')}">${esc(basename(c.cwd) || '~')}</span>` : ''}
      <span class="spacer"></span>
      ${c.type === 'term' ? `<span class="gitpill hidden"></span>
        <button class="card-btn" data-act="open" title="Abrir carpeta">⌂</button>
        <button class="card-btn" data-act="restart" title="Reiniciar">↻</button>` : ''}
      <button class="card-btn" data-act="edit" title="Editar agente">⋯</button>
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
      theme: {
        background: '#15120e', foreground: '#f1e9dd', cursor: agent.color, cursorAccent: '#15120e',
        selectionBackground: 'rgba(255,107,61,.28)',
        black: '#2a241e', red: '#f0715a', green: '#7cc68a', yellow: '#e7b05a', blue: '#7aa2f7', magenta: '#c49cf0', cyan: '#5fd0c8', white: '#d8cfc2',
        brightBlack: '#6b6156', brightRed: '#ff8f78', brightGreen: '#9bd9a7', brightYellow: '#f4c77d', brightBlue: '#9bbcff', brightMagenta: '#d8b8ff', brightCyan: '#86e3dc', brightWhite: '#f1e9dd',
      },
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

// ---------- Comando de cada tarjeta ----------
// Cada tarjeta de Claude tiene su propio id de sesión: al reabrir la app o reiniciar
// la tarjeta vuelve a SU conversación (--resume <id>), aunque haya varios Claude en
// el mismo proyecto. Las demás usan su "args al reanudar" (ej. codex resume --last).
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
// Cómo recibe un agente la tarea inicial: como argumento (no depende de cuándo
// termina de arrancar la TUI) o pegada en la terminal (CLIs desconocidos, cmd.exe).
function promptMode(a) {
  if (usesCmd()) return 'paste';
  return a.taskPrompt || ({ claude: 'arg', codex: 'arg', gemini: '-i' })[(a.command || '').trim().split(/\s+/)[0]] || 'paste';
}

function commandFor(c, resume) {
  if (c.startCmd) return resume ? '' : c.startCmd; // ej. tarjeta de login: no se repite al reabrir
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
  // si la sesión guardada ya no existe (nunca se escribió nada), abre una nueva con el mismo id
  if (session && c.sessionUsed) return orElse(cmd, [a.command, c.args, `--session-id ${c.sessionId}`].filter(Boolean).join(' '));
  return cmd;
}

async function startPty(c, resume) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  try { rt.fit.fit(); } catch {}
  $('.overlay', rt.el)?.remove();
  const command = commandFor(c, resume);
  const res = await ab.ptyCreate({ id: c.id, cwd: c.cwd, command, env: c.env || undefined, cols: rt.term.cols, rows: rt.term.rows });
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

// Espera a que el CLI termine de arrancar: salida y luego ~1,5 s de silencio.
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
  ov.innerHTML = `<div>${esc(msg)}</div><button class="primary">↻ Reiniciar</button>`;
  $('button', ov).onclick = () => restartCard(c);
  $('.card-body', rt.el).appendChild(ov);
}

function closeCard(c) {
  const rt = runtime.get(c.id);
  if (rt?.alive && !confirm(`¿Cerrar "${c.title}"? Se terminará el proceso.`)) return;
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

// ---------- Grupos (secciones del tablero) ----------
// Un grupo es un marco detrás de las tarjetas. Una tarjeta pertenece al grupo que
// contiene su centro; al mover el marco se mueven sus tarjetas.
const GROUP_COLORS = ['#ff6b3d', '#6c9cf5', '#3fbf8f', '#c49cf0', '#e7b05a', '#5fd0c8', '#f06a8a'];
const groupsList = () => cfg.cards.filter((c) => c.type === 'group');
const centerIn = (c, g) => { const x = c.x + c.w / 2, y = c.y + c.h / 2; return x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h; };
function groupAt(c) {
  let best = null;
  for (const g of groupsList()) if (centerIn(c, g) && (!best || g.w * g.h < best.w * best.h)) best = g;
  return best;
}
const membersOf = (g) => cfg.cards.filter((c) => c.type !== 'group' && c.groupId === g.id);
function syncGroups() {
  if (!cfg) return;
  for (const c of cfg.cards) if (c.type !== 'group') c.groupId = groupAt(c)?.id || null;
}
function groupName(c) { const g = c.groupId && cardData(c.groupId); return g ? g.title : ''; }

// Proyecto al que pertenece una ruta (los worktrees de tareas cuentan como su proyecto).
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
  return newCard('group', null, { title: opts.title || `Grupo ${n}`, noFocus: true, ...opts });
}

// Busca un grupo por nombre o lo crea a la derecha de todo lo que hay.
function ensureGroup(name) {
  const g = groupsList().find((x) => x.title.toLowerCase() === name.toLowerCase());
  if (g) return g;
  const right = cfg.cards.length ? Math.max(...cfg.cards.map((c) => c.x + c.w)) + 80 : 0;
  const top = cfg.cards.length ? Math.min(...cfg.cards.map((c) => c.y)) : 0;
  return newGroup({ title: name, x: right, y: top });
}

// Lugar para una tarjeta suelta que no caiga dentro de un grupo.
function looseSpot(w = DEFAULT_W, h = DEFAULT_H) {
  const groups = groupsList();
  if (!groups.length) return {};
  const others = cfg.cards.filter((c) => c.type !== 'group' && !c.groupId);
  const y = Math.max(...groups.map((g) => g.y + g.h)) + 90;
  const x0 = Math.min(...groups.map((g) => g.x));
  const x = others.filter((c) => c.y >= y - 1).reduce((m, c) => Math.max(m, c.x + c.w + 28), x0);
  return { x, y };
}

// Primer hueco libre dentro del grupo; si no cabe, el grupo crece hacia abajo.
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
      <button class="card-btn" data-act="task" title="Nueva tarea para este grupo">＋ Tarea</button>
      <button class="card-btn" data-act="edit" title="Editar grupo">⋯</button>
      <button class="card-btn" data-act="close" title="Quitar el grupo (las tarjetas se quedan)">✕</button>
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
    <label>Nombre <input name="title" value="${esc(c.title)}" /></label>
    <label>Color <div class="swatches">${GROUP_COLORS.map((col) => `<button type="button" data-col="${col}" class="${col === c.color ? 'on' : ''}" style="background:${col}"></button>`).join('')}</div></label>
    <div class="hint">Las tarjetas cuyo centro queda dentro del marco son del grupo. Escribe <code>#${esc(c.title.replace(/\s+/g, '-'))}</code> en una tarea para que su agente se abra aquí.</div>
    <div class="row"><button data-x="fit">Ajustar a sus tarjetas</button><button data-x="ok" class="primary">Aplicar</button></div>`;
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
    const queued = (cfg.tasks || []).filter((t) => t.status === 'pendiente' && t.group && t.group.toLowerCase() === g.title.toLowerCase()).length;
    const txt = m.length ? `${m.length} agente${m.length === 1 ? '' : 's'}${busy ? ` · ${busy} trabajando` : ''}` : 'vacío';
    const full = queued ? `${txt} · ${queued} en cola` : txt;
    if (rt.metaEl.textContent !== full) rt.metaEl.textContent = full;
    rt.el.classList.toggle('busy', busy > 0);
  }
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
    // Avisar si trabajó >8 s y ya no lo estás mirando
    if (wasBusy && !busy && rt.lastData - rt.busySince > 8000 && (!document.hasFocus() || focusedId !== c.id)) {
      try { new Notification(`${c.title} terminó`, { body: basename(c.cwd), silent: false }); } catch {}
    }
  }
  updateGroupMeta();
  updateSideCounts();
  drawMinimap();
}, 500);

// ---------- Git ----------
const gitCache = {}; // cwd -> último estado (lo usa también el diagrama)
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

// pan sin re-fit (el tamaño no cambia)
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

// Posiciona un popover bajo `anchor` y lo cierra al hacer clic fuera.
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

// ---------- Editar tarjeta ----------
function editMenu(c, anchor) {
  closePopover();
  const isTerm = c.type === 'term';
  const projects = [...cfg.projects];
  if (isTerm && c.cwd && !projects.some((p) => p.path === c.cwd)) projects.push({ path: c.cwd, name: basename(c.cwd) });

  const pop = document.createElement('div');
  pop.className = 'popover edit';
  pop.innerHTML = `
    <label>Nombre <input name="title" value="${esc(c.title)}" /></label>
    ${isTerm ? `
      <label>Agente <select name="agent">${Object.entries(cfg.agents).map(([k, a]) =>
        `<option value="${esc(k)}" ${k === c.agent ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
      <label>Proyecto <select name="cwd"><option value="" ${c.cwd ? '' : 'selected'}>Carpeta personal (~)</option>${projects.map((p) =>
        `<option value="${esc(p.path)}" ${p.path === c.cwd ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Argumentos extra <input name="args" value="${esc(c.args || '')}" placeholder="ej. --model opus" /></label>
      ${agentOf(c).command ? `<label class="switch"><input type="checkbox" name="bridge" ${c.bridge !== false ? 'checked' : ''} /> Otros agentes pueden escribirle</label>` : ''}
      <div class="hint"></div>` : ''}
    <div class="row">
      ${isTerm ? '<button data-x="handoff">Pasar a…</button>' : ''}
      <button data-x="dup">Duplicar</button>
      <button data-x="cancel">Cancelar</button>
      <button data-x="ok" class="primary">Aplicar</button>
    </div>`;
  openPopover(pop, anchor, 280);

  const field = (n) => pop.querySelector(`[name=${n}]`);
  const draft = () => ({ agent: field('agent').value, cwd: field('cwd').value || null, args: field('args').value.trim() });
  const changed = (d) => d.agent !== c.agent || d.cwd !== c.cwd || d.args !== (c.args || '');
  const updateHint = () => {
    if (!isTerm) return;
    const d = draft();
    const cmd = commandFor({ ...c, ...d, startCmd: changed(d) ? '' : c.startCmd }, false) || '(solo shell)';
    $('.hint', pop).innerHTML = `Comando: <code>${esc(cmd)}</code>${changed(d) ? '<br/>Al aplicar se reinicia el agente.' : ''}`;
  };
  pop.addEventListener('input', (e) => { if (e.target.name !== 'bridge') updateHint(); });
  updateHint();

  const apply = () => {
    let title = field('title').value.trim() || c.title;
    let restart = false;
    if (isTerm) {
      const d = draft();
      restart = changed(d);
      if (restart) {
        // si tenía el nombre por defecto, sigue al nuevo agente
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
  proj.title = c.cwd || 'Carpeta personal';
  if (rt.term) rt.term.options.theme = { ...rt.term.options.theme, cursor: a.color };
}

// ---------- Panel de agentes ----------
const STATUS_LABEL = { busy: 'Trabajando', idle: 'Esperando', dead: 'Terminado' };
const NOTES_KEY = '\u0000notas';
const sideItems = new Map(); // id -> botón en la lista

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
    list.innerHTML = `<div class="side-empty">${cfg.cards.length ? 'Sin resultados.' : 'Aún no hay agentes en el tablero.'}</div>`;
    updateSideCounts();
    return;
  }

  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || 'Carpeta personal';
  const projOrder = (p) => { const i = cfg.projects.findIndex((x) => x.path === p); return i < 0 ? 999 : i; };
  const entries = [...groups].sort(([a], [b]) => (a === NOTES_KEY) - (b === NOTES_KEY) || projOrder(a) - projOrder(b));
  for (const [key, cards] of entries) {
    const h = document.createElement('div');
    h.className = 'side-group';
    h.textContent = key === NOTES_KEY ? 'Notas' : projName(key);
    if (key !== NOTES_KEY) h.title = key || 'Carpeta personal';
    list.appendChild(h);
    cards.sort((x, y) => groupName(x).localeCompare(groupName(y)));
    let lastGroup = null;
    for (const c of cards) {
      const a = agentOf(c);
      const gname = groupName(c);
      if (gname !== lastGroup && (gname || lastGroup)) {
        const sub = document.createElement('div');
        sub.className = 'side-sub';
        sub.textContent = gname ? '▢ ' + gname : 'Sin grupo';
        list.appendChild(sub);
      }
      lastGroup = gname;
      const st = runtime.get(c.id)?.status || '';
      const b = document.createElement('button');
      b.className = 'side-item';
      b.style.setProperty('--agent', c.type === 'note' ? 'var(--warn)' : a.color);
      b.innerHTML = (c.type === 'term' ? `<span class="status ${st}" title="${STATUS_LABEL[st] || ''}"></span>` : '')
        + `<span class="name">${esc(c.title)}</span><span class="kind">${c.type === 'note' ? 'nota' : esc(a.label)}</span>`;
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
  $('#sideCounts').textContent = terms.length ? `${terms.length} · ${busy} trabajando` : '';
}

function toggleSidebar(force) {
  cfg.sidebarOpen = force ?? !cfg.sidebarOpen;
  document.body.classList.toggle('sidebar-open', !!cfg.sidebarOpen);
  drawMinimap(); save();
}

$('#sideFilter').addEventListener('input', renderSidebar);
$('#sidebarBtn').onclick = () => toggleSidebar();

// ---------- Minimapa ----------
const mini = $('#minimap');
const mctx = mini.getContext('2d');
let miniDrag = null; // transformación congelada mientras se arrastra

function miniTransform() {
  const r = board.getBoundingClientRect();
  const vp = cfg.viewport;
  const view = { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: r.width / vp.zoom, h: r.height / vp.zoom };
  let x0 = view.x, y0 = view.y, x1 = view.x + view.w, y1 = view.y + view.h;
  for (const c of cfg.cards) {
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
  const show = cfg.cards.length > 0;
  mini.classList.toggle('hidden', !show);
  if (!show) return;
  const dpr = window.devicePixelRatio || 1;
  const W = mini.clientWidth, H = mini.clientHeight;
  if (mini.width !== Math.round(W * dpr)) { mini.width = Math.round(W * dpr); mini.height = Math.round(H * dpr); }
  const cur = miniTransform();
  const t = miniDrag || cur;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, W, H);
  for (const c of cfg.cards) {
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

// ---------- Agentes y modelos ----------
let catalog = [];

// Agrega (o vuelve a mostrar) un agente del catálogo en la barra de abajo.
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
  $('#catalogRows').innerHTML = '<span class="muted small">Revisando qué tienes instalado…</span>';
  $('#localRows').innerHTML = '<span class="muted small">Buscando modelos locales…</span>';
  const [cat, local, avail] = await Promise.all([ab.catalogStatus(), ab.localModels(), ab.checkAgents()]);
  catalog = cat;
  agentAvailable = avail;
  renderAgentButtons();
  renderCatalog();
  renderLocal(local);
}

function renderCatalog() {
  const box = $('#catalogRows');
  box.innerHTML = '';
  for (const item of catalog) {
    if (item.key === 'ollama') continue; // va en "Modelos locales"
    const row = document.createElement('div');
    row.className = 'hub-row';
    const pinned = !!cfg.agents[item.key] && !cfg.agents[item.key].hidden;
    const [cls, badge] = !item.installed ? ['no', 'No instalado']
      : item.loggedIn === true ? ['ok', 'Sesión iniciada']
      : item.loggedIn === false ? ['no', 'Sin sesión'] : ['', 'Instalado'];
    const detail = !item.installed ? `<code>${esc(item.install)}</code>`
      : item.where ? `${esc(item.plan)} · sesión en ${esc(item.where)}` : `${esc(item.plan)} · inicia sesión dentro del CLI`;
    const action = !item.installed ? 'Instalar' : item.loggedIn === false ? 'Iniciar sesión' : 'Abrir';
    row.innerHTML = `
      <span class="dot" style="background:${esc(item.color)};color:${esc(item.color)}"></span>
      <span class="meta"><strong>${esc(item.label)}</strong><small title="${esc(item.install)}">${detail}</small></span>
      <span class="badge ${cls}">${badge}</span>
      <span class="acts">
        <label class="pin" title="Mostrar en la barra de abajo"><input type="checkbox" ${pinned ? 'checked' : ''}/> barra</label>
        <button type="button">${action}</button>
      </span>`;
    $('input', row).onchange = (e) => setPinned(item, e.target.checked);
    $('button', row).onclick = () => {
      $('#accounts').close();
      if (!item.installed) {
        newCard('term', 'shell', { cwd: null, title: `Instalar ${item.label}`, startCmd: item.install });
      } else if (item.loggedIn === false) {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key, { cwd: null, title: `Login ${item.label}`, startCmd: item.login });
      } else {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key);
      }
    };
    box.appendChild(row);
  }
}

// Formas de usar un modelo local. Los nombres vienen del servidor local:
// solo aceptamos caracteres seguros porque terminan en la línea de comando.
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
    return `<option value="${h.id}" ${ok ? '' : 'disabled'}>${esc(h.label)}${ok ? '' : ' — no instalado'}</option>`;
  }).join('');
  row.innerHTML = `
    <span class="dot" style="background:var(--text);color:var(--text)"></span>
    <span class="meta"><strong>${esc(model)}</strong><small>${provider === 'ollama' ? 'Ollama' : 'LM Studio'} · corre en tu máquina</small></span>
    <select>${opts}</select>
    <span class="acts"><button type="button">Abrir</button></span>`;
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
  head('Ollama', o.running ? 'ok' : 'no', o.running ? `Activo · ${oModels.length} modelos` : o.installed ? 'Apagado' : 'No instalado');
  if (!o.installed) {
    note('Descárgalo en <a href="https://ollama.com/download" target="_blank">ollama.com/download</a> y vuelve a revisar.');
  } else if (!o.running) {
    const n = note('Ollama está instalado pero no está corriendo. ');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Encender Ollama';
    b.onclick = () => { $('#accounts').close(); newCard('term', 'shell', { cwd: null, title: 'ollama serve', startCmd: 'ollama serve' }); };
    n.appendChild(b);
  }
  if (o.installed) {
    if (o.running && !oModels.length) note('Aún no tienes modelos. Descarga uno aquí abajo.');
    for (const m of oModels) box.appendChild(modelRow('ollama', m));
    const pull = document.createElement('div');
    pull.className = 'pull-row';
    pull.innerHTML = `<input placeholder="Descargar modelo, ej. qwen3-coder, gpt-oss:20b, llama3.2" /><button type="button">Descargar</button>`;
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
  head('LM Studio', l.running ? 'ok' : '', l.running ? `Servidor activo · ${lModels.length} modelos` : 'Servidor apagado');
  if (!l.running) note('Abre LM Studio → Developer → inicia el servidor local (puerto 1234) y vuelve a revisar.');
  for (const m of lModels) box.appendChild(modelRow('lmstudio', m));
}

$('#accountsBtn').onclick = openAccounts;
$('#moreAgents').onclick = openAccounts;
$('#accountsRefresh').onclick = renderAccounts;

// ---------- Avisos ----------
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
  void el.offsetWidth; // reinicia la animación
  el.classList.add('pinged');
}

// ---------- Pasar a… (traspasar contexto a otro agente) ----------
// Tarjetas que pueden recibir texto: agentes vivos, nunca terminales normales.
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
    <label>Para
      <select name="to">
        ${targets.map((x) => `<option value="card:${esc(x.id)}">${esc(x.title)} · ${esc(agentOf(x).label)}</option>`).join('')}
        ${fresh.map(([k, a]) => `<option value="new:${esc(k)}">Nuevo ${esc(a.label)} en ${esc(basename(c.cwd) || '~')}</option>`).join('')}
      </select></label>
    <label>Instrucción <input name="ask" value="Continúa con esto:" /></label>
    <label>Contexto (selección o últimas líneas) <textarea name="ctx"></textarea></label>
    <div class="row"><button data-x="cancel">Cancelar</button><button data-x="send" class="primary">Enviar</button></div>`;
  $('[name=ctx]', pop).value = terminalTail(c);
  openPopover(pop, anchor, 380);
  $('[name=ask]', pop).focus();

  pop.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'cancel') return closePopover();
    if (x !== 'send') return;
    const to = $('[name=to]', pop).value;
    const ctx = $('[name=ctx]', pop).value.trim();
    const text = `${$('[name=ask]', pop).value.trim()}\n\n[Contexto de ${c.title} (${agentOf(c).label})]\n${ctx}`.trim();
    closePopover();
    if (to.startsWith('card:')) {
      const target = cardData(to.slice(5));
      await ab.ptyPaste(target.id, text);
      ping(target.id);
      toast(`${esc(c.title)} <b>→</b> ${esc(target.title)}`);
      addLink(c.id, target.id, 'pasó contexto');
    } else {
      const target = newCard('term', to.slice(4), { cwd: c.cwd, x: c.x + c.w + 28, y: c.y });
      addLink(c.id, target.id, 'pasó contexto');
      toast(`Abriendo ${esc(target.title)} y enviándole el contexto…`);
      await waitAlive(target.id);
      await new Promise((r) => setTimeout(r, 3500)); // que el CLI termine de arrancar
      await ab.ptyPaste(target.id, text);
      ping(target.id);
    }
  });
}

async function waitAlive(id, ms = 8000) {
  const t0 = Date.now();
  while (!runtime.get(id)?.alive && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
}

// ---------- Eventos del puente entre agentes ----------
ab.onBridgeEvent((ev) => {
  const from = cardData(ev.from)?.title || 'Un agente';
  const to = cardData(ev.to)?.title || 'otro agente';
  if (ev.kind === 'send') { ping(ev.to); toast(`${esc(from)} <b>→</b> ${esc(to)}`); }
  else if (ev.kind === 'start') { toast(`${esc(from)} abrió <b>${esc(to)}</b>`); }
});

ab.onBridgeNewCard(async ({ reqId, agent, cwd, title }) => {
  const c = cfg.agents[agent] ? newCard('term', agent, { cwd, ...(title ? { title } : {}) }) : null;
  if (c) await saveNow(); // el puente lee el tablero guardado
  ab.bridgeCardCreated(reqId, c ? c.id : null);
});

// ---------- Skills y agentes ----------
const PROVIDERS = {
  claude: { label: 'Claude Code', color: () => cfg.agents.claude?.color || '#e8875f' },
  codex: { label: 'Codex', color: () => cfg.agents.codex?.color || '#3fbf8f' },
  gemini: { label: 'Gemini CLI', color: () => cfg.agents.gemini?.color || '#6c9cf5' },
};
const KIND_LABEL = { skill: 'skill', command: 'comando', extension: 'extensión' };
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
  $('#skillRows').innerHTML = '<div class="empty-note">Leyendo tus skills…</div>';
  const [items, defs, bridge, avail] = await Promise.all([ab.skillsScan(), ab.agentsList(), ab.bridgeStatus(), ab.checkAgents()]);
  skillItems = items; agentDefs = defs; agentAvailable = avail;
  renderSkillList(); renderAgentDefs(); renderConnect(bridge);
  renderPack(await ab.packStatus());
}

// Skills de ahorro de tokens incluidas con AgentBoard
function renderPack(pack) {
  const label = { ok: 'instalada', old: 'desactualizada' };
  $('#packRows').innerHTML = pack.map((p) => `
    <div class="hub-row skill">
      <span class="dot" style="background:var(--accent);color:var(--accent)"></span>
      <div class="meta"><strong>${esc(p.name)}</strong><span class="desc">${esc(p.description)}</span></div>
      <div class="acts">${Object.keys(PROVIDERS).map((k) => `<span class="badge ${p.installed[k] === 'ok' ? 'ok' : 'no'}" title="${esc(PROVIDERS[k].label)}">${esc(PROVIDERS[k].label)}: ${label[p.installed[k]] || 'no'}</span>`).join('')}</div>
      <span></span>
    </div>`).join('') || '<div class="empty-note">No encontré la carpeta skills-pack.</div>';
}
$('#packInstall').onclick = async () => {
  const r = await ab.packInstall(Object.keys(PROVIDERS));
  if (!r.ok) return toast(`No pude instalar: ${esc(r.error)}`);
  toast(`Skills de ahorro instaladas (${r.value.length}). Reinicia (↻) los agentes abiertos para que las vean.`, 5000);
  renderPack(await ab.packStatus());
};

function renderSkillList() {
  const count = (p) => skillItems.filter((x) => p === 'all' || x.provider === p).length;
  $('#skillProviders').innerHTML = ['all', ...Object.keys(PROVIDERS)].map((p) =>
    `<button type="button" data-p="${p}" class="${p === skillProvider ? 'active' : ''}">${p === 'all' ? 'Todas' : esc(PROVIDERS[p].label)}<span class="n">${count(p)}</span></button>`).join('');

  const q = $('#skillFilter').value.trim().toLowerCase();
  const list = skillItems.filter((x) => (skillProvider === 'all' || x.provider === skillProvider)
    && (!q || `${x.name} ${x.description} ${x.scope}`.toLowerCase().includes(q)));
  const box = $('#skillRows');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-note">${q ? 'Sin resultados.'
      : skillProvider === 'claude' ? 'No encontré skills de Claude Code en este computador (<code>~/.claude/skills</code>, tus proyectos o plugins activos). Las skills que activas en claude.ai viven en tu cuenta web, no en el disco. Puedes copiar aquí una skill de Codex.'
      : skillProvider === 'gemini' ? 'No encontré skills, comandos ni extensiones de Gemini CLI en este computador.'
      : 'No encontré skills en este computador.'}</div>`;
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
      <span class="desc" title="${esc(s.description)}">${esc(s.description) || '<i>Sin descripción</i>'}</span></span>
    <span class="badge">${esc(s.scope)}</span>
    <span class="acts">
      ${s.kind === 'skill' ? `<select class="copy" title="Copiar esta skill a otra suscripción">
        <option value="">Copiar a…</option>${others.map((p) => `<option value="${p}">${esc(PROVIDERS[p].label)}</option>`).join('')}</select>` : ''}
      <button type="button" class="icon" title="Mostrar en el Finder">↗</button>
    </span>`;
  $('button', row).onclick = () => ab.skillsReveal(s.path);
  const sel = $('select', row);
  if (sel) sel.onchange = async () => {
    const target = sel.value;
    sel.value = '';
    if (!target) return;
    const r = await ab.skillsCopy(s.path, target);
    if (r.ok) { toast(`Skill <b>${esc(s.name)}</b> copiada a ${esc(PROVIDERS[target].label)}`); await refreshSkills(); }
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
  box.innerHTML = agentDefs.length ? '' : '<div class="empty-note">Aún no tienes agentes propios. Crea uno con <b>＋ Nuevo agente</b>.</div>';
  for (const a of agentDefs) {
    const row = document.createElement('div');
    row.className = 'hub-row skill';
    row.innerHTML = `
      <span class="dot" style="background:${esc(PROVIDERS.claude.color())};color:${esc(PROVIDERS.claude.color())}"></span>
      <span class="meta"><strong>${esc(a.name)}${a.model ? `<span class="tag">${esc(a.model)}</span>` : ''}</strong>
        <span class="desc">${esc(a.description) || '<i>Sin descripción</i>'}</span></span>
      <span class="badge">${esc(a.scope)}</span>
      <span class="acts"><button type="button" data-a="edit">Editar</button><button type="button" data-a="del" class="icon" title="Mover a la papelera">✕</button></span>`;
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'edit') openAgentForm(a);
      if (act === 'del' && confirm(`¿Mover "${a.name}" a la papelera?`)) {
        const r = await ab.agentsDelete(a.file);
        if (r.ok) { toast(`<b>${esc(a.name)}</b> se movió a la papelera`); await refreshSkills(); } else toast(esc(r.error), 4500);
      }
    });
    box.appendChild(row);
  }
}

function openAgentForm(a = null) {
  editingAgent = a;
  const f = $('#skillsForm');
  f.adProject.innerHTML = '<option value="">Usuario (todos los proyectos)</option>'
    + cfg.projects.map((p) => `<option value="${esc(p.path)}">Proyecto · ${esc(p.name)}</option>`).join('');
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
  toast(`Agente <b>${esc(f.adName.value.trim())}</b> guardado`);
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
        <small>${!installed ? 'No instalado' : on ? 'Puede ver y escribirle a los demás agentes del tablero' : 'Aún no conoce a los demás agentes'}</small></span>
      <span class="badge ${on ? 'ok' : ''}">${on ? 'Conectado' : 'Sin conectar'}</span>
      <span class="acts"><button type="button" ${installed ? '' : 'disabled'}>${on ? 'Desconectar' : 'Conectar'}</button></span>`;
    $('button', row).onclick = () => {
      $('#skills').close();
      newCard('term', 'shell', { cwd: null, title: `${on ? 'Desconectar' : 'Conectar'} ${PROVIDERS[key].label}`, startCmd: bridge.commands[key][on ? 'remove' : 'add'] });
      toast(on ? 'Desconectando…' : 'Conectando… Reinicia (↻) los agentes que ya estaban abiertos para que vean la conexión.', 5000);
    };
    box.appendChild(row);
  }

  const list = $('#boardAgentRows');
  const agents = cfg.cards.filter((c) => c.type === 'term' && agentOf(c).command && !c.startCmd);
  list.innerHTML = agents.length ? '' : '<div class="empty-note">No hay agentes abiertos en el tablero.</div>';
  for (const c of agents) {
    const st = runtime.get(c.id)?.status || '';
    const row = document.createElement('div');
    row.className = 'hub-row';
    row.style.setProperty('--agent', agentOf(c).color);
    row.innerHTML = `
      <span class="status ${st}" title="${STATUS_LABEL[st] || ''}"></span>
      <span class="meta"><strong>${esc(c.title)}</strong><small>${esc(agentOf(c).label)} · ${esc(basename(c.cwd) || '~')}</small></span>
      <label class="switch"><input type="checkbox" ${c.bridge !== false ? 'checked' : ''}/> recibe mensajes</label>
      <span class="acts"><button type="button">Ir</button></span>`;
    $('input', row).onchange = (e) => { c.bridge = e.target.checked; save(); };
    $('button', row).onclick = () => { $('#skills').close(); focusCardView(c); focusCard(c.id); };
    list.appendChild(row);
  }
}

$('#skillsBtn').onclick = () => openSkills();
$('#skillsRefresh').onclick = refreshSkills;
$('#skills .tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) showTab(t); });
// Enter en un campo no debe cerrar el diálogo (es un <form method="dialog">).
$('#skillsForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });

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
    if (a.hidden) continue;
    const b = document.createElement('button');
    const missing = agentAvailable[key] === false;
    b.className = 'chip' + (missing ? ' missing' : '');
    b.innerHTML = `<span class="dot" style="background:${esc(a.color)};color:${esc(a.color)}"></span>${esc(a.label)}`;
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
$('#addGroup').onclick = () => newGroup();
$('#tasksBtn').onclick = () => toggleTasks();
$('#diagramBtn').onclick = () => toggleDiagram();
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
    <input name="lightArgs" value="${esc(a.lightArgs || '')}" placeholder="args modo ligero" title="Se usan en tareas marcadas como ligeras (modelo más barato)" ${key === 'shell' ? 'disabled' : ''}/>
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
  f.keepRunning.checked = cfg.keepRunning !== false;
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
  cfg.keepRunning = f.keepRunning.checked;

  const agents = {};
  for (const row of document.querySelectorAll('#agentRows .agent-row')) {
    const get = (n) => row.querySelector(`[name=${n}]`).value.trim();
    const key = row.dataset.key;
    if (key !== 'shell' && !get('command')) continue;
    agents[key] = { ...(cfg.agents[key] || {}), label: get('label') || get('command') || key, command: key === 'shell' ? '' : get('command'), resumeArgs: key === 'shell' ? '' : get('resumeArgs'), lightArgs: key === 'shell' ? '' : get('lightArgs'), color: get('color') };
  }
  if (!agents.shell) agents.shell = { label: 'Terminal', command: '', resumeArgs: '', color: '#8a8f98' };
  cfg.agents = agents;

  const names = new Map([...document.querySelectorAll('#projectRows .project-row')].map((r) => [r.dataset.path, r.querySelector('[name=name]').value.trim()]));
  cfg.projects = cfg.projects.filter((p) => names.has(p.path)).map((p) => ({ ...p, name: names.get(p.path) || basename(p.path) }));
  if (!cfg.projects.some((p) => p.path === cfg.selectedProject)) cfg.selectedProject = cfg.projects[0]?.path || null;

  await ab.saveConfig(cfg);
  $('#machine').textContent = cfg.machineName;
  renderProjects();
  for (const c of cfg.cards) refreshCardHead(c);
  renderSidebar();
  agentAvailable = await ab.checkAgents();
  renderAgentButtons();
  applyViewport();
});

// ---------- Arranque ----------
(async function init() {
  const res = await ab.loadConfig();
  // tasks.js y diagram.js se cargan después de este archivo
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
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

  document.body.classList.toggle('sidebar-open', !!cfg.sidebarOpen);
  // los grupos primero: quedan detrás de las tarjetas
  for (const c of [...cfg.cards].sort((a, b) => (b.type === 'group') - (a.type === 'group'))) mountCard(c, { resume: true });
  applyViewport();
  updateEmpty();
  renderSidebar();
  initTasks();
  initDiagram();
  refreshGit();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
