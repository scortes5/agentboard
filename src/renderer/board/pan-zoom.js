// AgentBoard — moving around the board: pan, zoom and popovers.
'use strict';

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
