// AgentBoard — the minimap at the bottom right.
'use strict';

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
