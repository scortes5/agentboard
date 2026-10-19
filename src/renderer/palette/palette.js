// AgentBoard — palette (⇧⌘P / Ctrl+Shift+P): jump to an agent or task, or run an action, without the mouse.
// If what you type matches nothing, Enter adds it as a task.
'use strict';
/* global cfg, $, esc, basename, agentOf, runtime, focusCardView, focusCard, newCard, newGroup, toggleTasks, openTasks,
   toggleDiagram, diagramOpen, arrange, fitAll, openSettings, openAccounts, openSkills, addTask, parseLine, tickTasks,
   STATUS_LABEL, toast, composerDefaults, toggleFlows, switchSpace, runFlow, closeMany, openUsage */

let palItems = [];
let palSel = 0;

function palCommands() {
  const cmds = [
    { icon: 'tasks', label: 'Tasks', hint: '⇧⌘T', run: () => openTasks() },
    { icon: 'diagram', label: 'Diagram', hint: '⇧⌘D', run: () => toggleDiagram(true) },
    { icon: 'flows', label: 'Automations', hint: '⇧⌘F', run: () => toggleFlows(true) },
    { icon: 'chart', label: 'Usage and Savings', hint: '⇧⌘U', run: () => openUsage() },
    { icon: 'keyboard', label: 'Keyboard Shortcuts', hint: '⌘/', run: () => openSettings('keys') },
    { icon: 'sun', label: 'Appearance', run: () => openSettings('appearance') },
    { icon: 'idea', label: 'Welcome Guide', run: () => onboarding.open() },
    { icon: 'flows', label: 'New Automation from a Template', run: () => { toggleFlows(true); flowTemplates.open($('#flTemplates')); } },
    { icon: 'check', label: 'Approvals View', run: () => viewLayout.reveal('approvals') },
    { icon: 'layers', label: 'Reset Side Bar Layout', run: () => viewLayout.reset() },
    { icon: 'group', label: 'New Group', hint: '⇧⌘G', run: () => newGroup() },
    { icon: 'note', label: 'New Note', hint: '⇧⌘N', run: () => newCard('note') },
    { icon: 'grid', label: 'Arrange Cards', hint: '⇧⌘O', run: () => arrange() },
    { icon: 'fit', label: 'Fit All', hint: '⌘0', run: () => fitAll() },
    { icon: 'close', label: 'Close Selected Cards', sub: '⌘/Shift-click title bars to select', run: () => closeMany('selected') },
    { icon: 'close', label: 'Close Cards of Finished Tasks', run: () => closeMany('finished') },
    { icon: 'close', label: 'Close Stopped Cards', run: () => closeMany('stopped') },
    { icon: 'close', label: 'Close All Cards in This View', run: () => closeMany('project') },
    { icon: 'agent', label: 'Subscriptions and Accounts', run: () => openAccounts() },
    { icon: 'layers', label: 'Skills and Token Saving', run: () => openSkills('saving') },
    { icon: 'gear', label: 'Settings', hint: '⌘,', run: () => openSettings() },
  ];
  for (const p of cfg.projects) cmds.push({ icon: 'folder', label: `Go to project ${p.name}`, sub: 'project', run: () => switchSpace(p.path) });
  for (const f of cfg.flows || []) cmds.push({ icon: 'play', label: `Run "${f.name}"`, sub: 'automation', run: () => runFlow(f) });
  for (const [k, a] of Object.entries(cfg.agents)) {
    if (a.hidden) continue;
    cmds.push({ icon: 'plus', label: `Open ${a.label}`, sub: basename(cfg.selectedProject) || '', color: a.color, run: () => newCard('term', k) });
  }
  return cmds;
}

function palCandidates() {
  const items = [];
  for (const c of cfg.cards) {
    if (c.type === 'group') { items.push({ icon: 'group', label: c.title, sub: 'group', run: () => { toggleDiagram(false); focusCardView(c); } }); continue; }
    const a = agentOf(c);
    const st = runtime.get(c.id)?.status;
    items.push({
      icon: c.type === 'note' ? 'note' : 'dot', color: c.type === 'note' ? null : a.color, label: c.title,
      sub: [c.type === 'note' ? 'note' : a.label, basename(c.cwd), STATUS_LABEL[st]].filter(Boolean).join(' · '),
      run: () => { if (diagramOpen()) toggleDiagram(false); focusCardView(c); focusCard(c.id); },
    });
  }
  for (const t of cfg.tasks || []) {
    if (t.status === 'done') continue;
    items.push({ icon: 'tasks', label: t.text, sub: `task · ${t.status}`, run: () => openTasks() });
  }
  return [...items, ...palCommands()];
}

// Simple matching: every word must appear; matches at word starts score higher.
function palScore(item, q) {
  if (!q) return 1;
  const hay = `${item.label} ${item.sub || ''}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let score = 0;
  for (const w of q.split(/\s+/)) {
    const i = hay.indexOf(w);
    if (i < 0) return 0;
    score += i === 0 ? 3 : /\s/.test(hay[i - 1]) ? 2 : 1;
  }
  return score;
}

function renderPalette() {
  const q = $('#palInput').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  palItems = palCandidates().map((it) => ({ it, s: palScore(it, q) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s).slice(0, 40).map((x) => x.it);
  if (q) palItems.push({ icon: 'plus', label: `Add task: "${$('#palInput').value.trim()}"`, sub: 'use @agent #group ! !!', addTask: true });
  palSel = Math.min(palSel, palItems.length - 1);
  $('#palList').innerHTML = palItems.map((it, i) => `<button type="button" class="pal-item ${i === palSel ? 'sel' : ''}" data-i="${i}">
    <span class="pal-icon" ${it.color ? `style="color:${esc(it.color)}"` : ''}>${icon(it.icon, 15)}</span>
    <span class="pal-label">${esc(it.label)}</span>
    ${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}
    ${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('') || '<div class="pal-empty">No matches.</div>';
  $('#palList .sel')?.scrollIntoView({ block: 'nearest' });
}

function runPalette(i) {
  const it = palItems[i];
  if (!it) return;
  const text = $('#palInput').value.trim();
  closePalette();
  if (it.addTask) {
    const t = parseLine(text, composerDefaults());
    if (!t.text) return;
    addTask(t); tickTasks();
    toast(`Task queued: ${esc(t.text.slice(0, 60))}`);
  } else it.run();
}

function openPalette() {
  if (document.querySelector('dialog[open]')) return;
  $('#palette').classList.remove('hidden');
  $('#palInput').value = '';
  palSel = 0;
  renderPalette();
  $('#palInput').focus();
}
function closePalette() { $('#palette').classList.add('hidden'); }

$('#palInput').addEventListener('input', () => { palSel = 0; renderPalette(); });
$('#palInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(); }
  else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runPalette(palSel); }
});
$('#palList').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) runPalette(+b.dataset.i); });
$('#palette').addEventListener('pointerdown', (e) => { if (e.target.id === 'palette') closePalette(); });
