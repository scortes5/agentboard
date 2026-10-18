// AgentBoard — the agent list on the left.
'use strict';

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
      b.title = c.type === 'note' ? 'Go to the note' : `Go to the ${c.title} card (${a.label}) · ⌘/Shift-click to select`;
      b.onclick = (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return toggleSelect(c.id);
        focusCardView(c); focusCard(c.id);
      };
      b.classList.toggle('selected', selected.has(c.id));
      b.classList.toggle('alerted', !!runtime.get(c.id)?.alert);
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
