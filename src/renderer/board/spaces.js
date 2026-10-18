// AgentBoard — project tabs, the toolbar and menu actions.
'use strict';

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
$('#settingsBtn').onclick = () => openSettings();

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
  else if (action === 'usage') openUsage();
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
