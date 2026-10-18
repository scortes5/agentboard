// AgentBoard — selecting several cards and closing them together; focusing a card.
'use strict';

// ---------- Selection: ⌘/Ctrl or Shift + click on a card's title bar (or in the agent list) ----------
const selected = new Set();
function toggleSelect(id, on = !selected.has(id)) {
  if (on) selected.add(id); else selected.delete(id);
  runtime.get(id)?.el.classList.toggle('selected', on);
  sideItems.get(id)?.classList.toggle('selected', on);
  updateSelBar();
}
function clearSelection() { for (const id of [...selected]) toggleSelect(id, false); }
function updateSelBar() {
  for (const id of [...selected]) if (!cardData(id)) selected.delete(id);
  $('#selBar').classList.toggle('hidden', !selected.size);
  $('#selCount').textContent = `${selected.size} selected`;
}
const finishedTaskCards = () => cfg.cards.filter((c) => c.taskId && (cfg.tasks || []).some((t) => t.id === c.taskId && t.status === 'done'));
const stoppedCards = () => cfg.cards.filter((c) => c.type === 'term' && runtime.get(c.id) && !runtime.get(c.id).alive);
function closeMany(kind) {
  const list = kind === 'selected' ? [...selected].map(cardData)
    : kind === 'finished' ? finishedTaskCards()
    : kind === 'stopped' ? stoppedCards()
    : kind === 'project' ? shownCards().filter((c) => c.type !== 'group') : [];
  if (!list.filter(Boolean).length) return toast(kind === 'finished' ? 'No cards of finished tasks.' : kind === 'stopped' ? 'No stopped cards.' : 'Nothing to close.');
  if (closeCards(list) && list.length > 1) toast(`Closed ${list.length} cards.`);
}

function focusCard(id, focusTerm = true) {
  if (focusedId && focusedId !== id) runtime.get(focusedId)?.el.classList.remove('focused');
  focusedId = id;
  markSidebarFocus();
  const rt = runtime.get(id);
  if (!rt) return;
  rt.el.classList.add('focused');
  errorWatch.clear(cardData(id));
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
    if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); toggleSelect(c.id); return; }
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
