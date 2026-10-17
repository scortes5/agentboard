// AgentBoard — paleta (⇧⌘P / Ctrl+Shift+P): salta a un agente o tarea, o ejecuta una acción, sin mouse.
// Si lo que escribes no coincide con nada, Enter lo agrega como tarea.
'use strict';
/* global cfg, $, esc, basename, agentOf, runtime, focusCardView, focusCard, newCard, newGroup, toggleTasks, openTasks,
   toggleDiagram, diagramOpen, arrange, fitAll, openSettings, openAccounts, openSkills, addTask, parseLine, tickTasks,
   STATUS_LABEL, toast, composerDefaults, toggleFlows, switchSpace, runFlow */

let palItems = [];
let palSel = 0;

function palCommands() {
  const cmds = [
    { icon: 'tasks', label: 'Tareas', hint: '⇧⌘T', run: () => openTasks() },
    { icon: 'diagram', label: 'Diagrama', hint: '⇧⌘D', run: () => toggleDiagram(true) },
    { icon: 'flows', label: 'Automatizaciones', hint: '⇧⌘F', run: () => toggleFlows(true) },
    { icon: 'keyboard', label: 'Atajos de teclado', hint: '⌘/', run: () => openSettings('keys') },
    { icon: 'sun', label: 'Apariencia', run: () => openSettings('appearance') },
    { icon: 'group', label: 'Nuevo grupo', hint: '⇧⌘G', run: () => newGroup() },
    { icon: 'note', label: 'Nueva nota', hint: '⇧⌘N', run: () => newCard('note') },
    { icon: 'grid', label: 'Ordenar tarjetas', hint: '⇧⌘O', run: () => arrange() },
    { icon: 'fit', label: 'Ver todo', hint: '⌘0', run: () => fitAll() },
    { icon: 'agent', label: 'Suscripciones y cuentas', run: () => openAccounts() },
    { icon: 'layers', label: 'Skills y ahorro de tokens', run: () => openSkills('saving') },
    { icon: 'gear', label: 'Configuración', hint: '⌘,', run: () => openSettings() },
  ];
  for (const p of cfg.projects) cmds.push({ icon: 'folder', label: `Ir al proyecto ${p.name}`, sub: 'proyecto', run: () => switchSpace(p.path) });
  for (const f of cfg.flows || []) cmds.push({ icon: 'play', label: `Ejecutar "${f.name}"`, sub: 'automatización', run: () => runFlow(f) });
  for (const [k, a] of Object.entries(cfg.agents)) {
    if (a.hidden) continue;
    cmds.push({ icon: 'plus', label: `Abrir ${a.label}`, sub: basename(cfg.selectedProject) || '', color: a.color, run: () => newCard('term', k) });
  }
  return cmds;
}

function palCandidates() {
  const items = [];
  for (const c of cfg.cards) {
    if (c.type === 'group') { items.push({ icon: 'group', label: c.title, sub: 'grupo', run: () => { toggleDiagram(false); focusCardView(c); } }); continue; }
    const a = agentOf(c);
    const st = runtime.get(c.id)?.status;
    items.push({
      icon: c.type === 'note' ? 'note' : 'dot', color: c.type === 'note' ? null : a.color, label: c.title,
      sub: [c.type === 'note' ? 'nota' : a.label, basename(c.cwd), STATUS_LABEL[st]].filter(Boolean).join(' · '),
      run: () => { if (diagramOpen()) toggleDiagram(false); focusCardView(c); focusCard(c.id); },
    });
  }
  for (const t of cfg.tasks || []) {
    if (t.status === 'hecho') continue;
    items.push({ icon: 'tasks', label: t.text, sub: `tarea · ${t.status.replace('_', ' ')}`, run: () => openTasks() });
  }
  return [...items, ...palCommands()];
}

// Coincidencia simple: todas las palabras deben aparecer; puntúa el inicio de palabra.
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
  if (q) palItems.push({ icon: 'plus', label: `Agregar tarea: "${$('#palInput').value.trim()}"`, sub: 'usa @agente #grupo ! !!', addTask: true });
  palSel = Math.min(palSel, palItems.length - 1);
  $('#palList').innerHTML = palItems.map((it, i) => `<button type="button" class="pal-item ${i === palSel ? 'sel' : ''}" data-i="${i}">
    <span class="pal-icon" ${it.color ? `style="color:${esc(it.color)}"` : ''}>${icon(it.icon, 15)}</span>
    <span class="pal-label">${esc(it.label)}</span>
    ${it.sub ? `<span class="pal-sub">${esc(it.sub)}</span>` : ''}
    ${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('') || '<div class="pal-empty">Nada coincide.</div>';
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
    toast(`Tarea en cola: ${esc(t.text.slice(0, 60))}`);
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
