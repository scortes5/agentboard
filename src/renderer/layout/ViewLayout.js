// AgentBoard — side bars made of views, like VS Code: the left and right bars hold views (Agents,
// Tasks, Approvals…) that you can collapse, drag to reorder or to the other side, hide, show
// again and resize, and each bar's width is dragged from its inner edge. The layout is saved in
// cfg.layout. A new view registers itself with viewLayout.register(); this file does not change.
'use strict';
/* global $, cfg, esc, icon, save, openPopover, closePopover, drawMinimap, clamp */

const SIDES = {
  left: { bar: '#sidebar', flag: 'sidebarOpen', cls: 'sidebar-open', width: 248, label: 'Left' },
  right: { bar: '#tasks', flag: 'tasksOpen', cls: 'tasks-open', width: 352, label: 'Right' },
};
const MIN_W = 220, MAX_W = 640, MIN_VIEW_H = 72;

class ViewLayout {
  constructor() {
    this.defs = new Map();   // id → { id, title, side, grow, collapsed, badge, onShow }
    this.mounted = false;
    this.dragging = null;
  }

  // def: { id, title, side: 'left'|'right', order (default position), grow (fills the free height), collapsed (by default),
  //        badge (selector of an element shown in its header), onShow() (called when it becomes visible) }
  register(def) {
    this.defs.set(def.id, { grow: true, collapsed: false, ...def });
    if (this.mounted) this.render();
    return def;
  }

  // ---------- State ----------
  get state() {
    const l = cfg.layout || (cfg.layout = {});
    l.width = l.width || {};
    l.views = l.views || {};
    return l;
  }

  view(id) {
    const d = this.defs.get(id);
    const s = this.state.views[id] || (this.state.views[id] = {});
    return { side: s.side || d.side, order: s.order ?? d.order ?? [...this.defs.keys()].indexOf(id), collapsed: s.collapsed ?? d.collapsed, hidden: !!s.hidden, weight: s.weight || 1 };
  }

  set(id, patch) { Object.assign(this.state.views[id] || (this.state.views[id] = {}), patch); save(); this.render(); }

  viewsOn(side) {
    return [...this.defs.keys()].filter((id) => this.view(id).side === side).sort((a, b) => this.view(a).order - this.view(b).order);
  }

  sideOf(id) { return this.view(id).side; }
  isOpen(side) { return !!cfg[SIDES[side].flag]; }
  width(side) { return clamp(this.state.width[side] || SIDES[side].width, MIN_W, MAX_W); }
  // Space a bar takes on the board (0 when closed).
  inset(side) { return this.isOpen(side) && !document.body.classList.contains('flows-open') ? this.width(side) : 0; }
  visible(id) { const v = this.view(id); return this.isOpen(v.side) && !v.hidden && !v.collapsed; }

  // ---------- Opening and showing ----------
  setOpen(side, open) {
    cfg[SIDES[side].flag] = !!open;
    document.body.classList.toggle(SIDES[side].cls, !!open);
    if (open) for (const id of this.viewsOn(side)) if (this.visible(id)) this.defs.get(id).onShow?.();
    drawMinimap(); save();
  }

  // Open the bar that holds a view, and show and expand it.
  reveal(id) {
    const v = this.view(id);
    if (v.hidden || v.collapsed) this.set(id, { hidden: false, collapsed: false });
    this.setOpen(v.side, true);
  }

  moveTo(id, side, before = null) {
    const list = this.viewsOn(side).filter((x) => x !== id);
    list.splice(before && list.includes(before) ? list.indexOf(before) : list.length, 0, id);
    list.forEach((x, i) => { this.state.views[x] = { ...this.state.views[x], order: i }; });
    this.state.views[id].side = side;
    this.state.views[id].hidden = false;
    save(); this.render();
    if (!this.isOpen(side)) this.setOpen(side, true);
  }

  reset() {
    cfg.layout = {};
    save(); this.render();
  }

  // ---------- Drawing ----------
  mount() {
    for (const side of Object.keys(SIDES)) { this.mountBar(side); document.body.classList.toggle(SIDES[side].cls, this.isOpen(side)); }
    this.mounted = true;
    this.render();
    for (const id of this.defs.keys()) if (this.visible(id)) this.defs.get(id).onShow?.();
  }

  mountBar(side) {
    const bar = $(SIDES[side].bar);
    bar.classList.add('side-bar');
    bar.dataset.side = side;
    bar.querySelector('[data-views-menu]').onclick = (e) => this.menu(side, e.currentTarget);
    bar.querySelector('[data-side-close]').onclick = () => this.setOpen(side, false);
    const box = bar.querySelector('.views');
    box.addEventListener('dragover', (e) => this.dragOver(e, side));
    box.addEventListener('drop', (e) => this.drop(e, side));
    box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) this.clearDrop(); });
    this.resizer(bar, side);
  }

  render() {
    for (const side of Object.keys(SIDES)) {
      document.body.style.setProperty(`--${side}-w`, `${this.width(side)}px`);
      const box = $(`${SIDES[side].bar} .views`);
      const ids = this.viewsOn(side).filter((id) => !this.view(id).hidden);
      for (const id of ids) box.appendChild(this.section(id));
      box.querySelectorAll('.view-sash').forEach((s) => s.remove());
      ids.filter((id) => this.grows(id)).forEach((id, i, list) => { if (i < list.length - 1) this.sash(box, id, list[i + 1]); });
      if (!ids.length) box.dataset.empty = 'Drag a view here, or show one from ⋯';
      else delete box.dataset.empty;
    }
    for (const id of this.defs.keys()) {
      const el = this.section(id);
      el.hidden = this.view(id).hidden;
      if (el.hidden) $('#viewStash').appendChild(el);
    }
    drawMinimap();
  }

  grows(id) { const v = this.view(id); return this.defs.get(id).grow && !v.collapsed && !v.hidden; }

  // The view's section, with its header (built once; the body is the existing markup).
  section(id) {
    const el = document.querySelector(`.view[data-view="${id}"]`);
    const d = this.defs.get(id);
    const v = this.view(id);
    if (!el.querySelector(':scope > .view-head')) {
      const head = document.createElement('header');
      head.className = 'view-head';
      head.draggable = true;
      head.innerHTML = `<span class="chev">${icon('chevron', 12)}</span><span class="view-title">${esc(d.title)}</span><span class="view-badge"></span>
        <span class="spacer"></span><button type="button" class="card-btn view-more" title="Collapse, move or hide this view">${icon('more', 13)}</button>`;
      if (d.badge) head.querySelector('.view-badge').appendChild($(d.badge));
      head.onclick = (e) => {
        if (e.target.closest('.view-more')) return this.viewMenu(id, e.target.closest('.view-more'));
        if (e.target.closest('.view-badge button, input, select')) return;
        this.set(id, { collapsed: !this.view(id).collapsed });
        if (this.visible(id)) d.onShow?.();
      };
      head.addEventListener('dragstart', (e) => { this.dragging = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); el.classList.add('dragging'); });
      head.addEventListener('dragend', () => { this.dragging = null; el.classList.remove('dragging'); this.clearDrop(); });
      el.prepend(head);
    }
    el.classList.toggle('collapsed', v.collapsed);
    el.classList.toggle('grow', this.grows(id));
    el.style.flexGrow = this.grows(id) ? String(v.weight) : '';
    return el;
  }

  // ---------- Resizing ----------
  resizer(bar, side) {
    const handle = bar.querySelector('.side-resizer');
    handle.title = 'Drag to resize; double-click for the default width';
    handle.addEventListener('dblclick', () => { delete this.state.width[side]; save(); this.render(); });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.width(side);
      document.body.classList.add('resizing');
      const move = (ev) => {
        this.state.width[side] = clamp(w0 + (side === 'left' ? ev.clientX - x0 : x0 - ev.clientX), MIN_W, MAX_W);
        document.body.style.setProperty(`--${side}-w`, `${this.width(side)}px`);
      };
      const up = () => { handle.removeEventListener('pointermove', move); document.body.classList.remove('resizing'); save(); drawMinimap(); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });
  }

  // A handle between two growing views that shares the height between them.
  sash(box, a, b) {
    const s = document.createElement('div');
    s.className = 'view-sash';
    s.title = 'Drag to share the height between these views';
    this.section(a).after(s);
    s.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      const ea = this.section(a), eb = this.section(b);
      const ha = ea.getBoundingClientRect().height, hb = eb.getBoundingClientRect().height, y0 = e.clientY;
      const total = this.view(a).weight + this.view(b).weight;
      const move = (ev) => {
        const na = clamp(ha + ev.clientY - y0, MIN_VIEW_H, ha + hb - MIN_VIEW_H);
        const wa = (total * na) / (ha + hb);
        this.state.views[a].weight = wa; this.state.views[b].weight = total - wa;
        ea.style.flexGrow = String(wa); eb.style.flexGrow = String(total - wa);
      };
      s.addEventListener('pointermove', move);
      s.addEventListener('pointerup', () => { s.removeEventListener('pointermove', move); save(); }, { once: true });
    });
  }

  // ---------- Dragging views ----------
  target(e, side) {
    const over = e.target.closest('.view');
    if (!over || over.dataset.view === this.dragging) return { before: null, el: null };
    const r = over.getBoundingClientRect();
    const after = e.clientY > r.top + Math.min(r.height, 60) / 2;
    const ids = this.viewsOn(side).filter((id) => !this.view(id).hidden);
    return { before: after ? ids[ids.indexOf(over.dataset.view) + 1] || null : over.dataset.view, el: over, after };
  }

  dragOver(e, side) {
    if (!this.dragging) return;
    e.preventDefault();
    const t = this.target(e, side);
    this.clearDrop();
    if (t.el) t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
    else e.currentTarget.classList.add('drop-end');
  }

  drop(e, side) {
    if (!this.dragging) return;
    e.preventDefault();
    const { before } = this.target(e, side);
    const id = this.dragging;
    this.clearDrop();
    this.moveTo(id, side, before);
  }

  clearDrop() {
    document.querySelectorAll('.drop-before, .drop-after, .drop-end').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-end'));
  }

  // ---------- Menus ----------
  popover(anchor, items) {
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'popover views-menu';
    pop.innerHTML = items.map((it, i) => (it === '-' ? '<hr/>' : `<button type="button" data-i="${i}">${it.check != null ? `<span class="check">${it.check ? '✓' : ''}</span>` : ''}${esc(it.label)}${it.hint ? `<span class="muted small">${esc(it.hint)}</span>` : ''}</button>`)).join('');
    openPopover(pop, anchor, 230);
    pop.addEventListener('click', (e) => {
      const it = items[e.target.closest('[data-i]')?.dataset.i];
      if (!it) return;
      closePopover();
      it.run();
    });
  }

  viewMenu(id, anchor) {
    const v = this.view(id);
    const other = v.side === 'left' ? 'right' : 'left';
    this.popover(anchor, [
      { label: v.collapsed ? 'Expand' : 'Collapse', run: () => this.set(id, { collapsed: !v.collapsed }) },
      { label: `Move to ${SIDES[other].label} Side`, run: () => this.moveTo(id, other) },
      { label: 'Hide', run: () => this.set(id, { hidden: true }) },
    ]);
  }

  // Every view, with a check on the ones shown in this bar; picking one shows it here.
  menu(side, anchor) {
    const items = [...this.defs.keys()].map((id) => {
      const v = this.view(id);
      const here = v.side === side && !v.hidden;
      return {
        label: this.defs.get(id).title, check: here, hint: v.side !== side && !v.hidden ? `${SIDES[v.side].label.toLowerCase()} side` : '',
        run: () => (here ? this.set(id, { hidden: true }) : (v.side === side ? this.set(id, { hidden: false }) : this.moveTo(id, side))),
      };
    });
    this.popover(anchor, [...items, '-', { label: 'Reset Layout', run: () => this.reset() }]);
  }
}

const viewLayout = new ViewLayout();
