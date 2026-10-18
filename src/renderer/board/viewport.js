// AgentBoard — the board's viewport: semantic zoom, layout of each card and terminal fitting.
'use strict';

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
