// AgentBoard — Settings (⌘,): general, appearance, agents, shortcuts, projects, tasks and
// the advanced JSON editor, plus applying the appearance to the whole app.
'use strict';
/* global cfg, $, esc, ab, clamp, basename, icon, toast, runtime, applyViewport, renderAgentButtons, renderSidebar, renderProjects,
   renderSpaces, renderTaskOptions, darkMQ */

// ---------- Settings rows ----------
function agentRow(key, a) {
  const row = document.createElement('div');
  row.className = 'agent-row';
  row.dataset.key = key;
  const builtin = ['claude', 'codex', 'gemini', 'shell'].includes(key);
  row.innerHTML = `
    <input type="color" name="color" value="${esc(a.color)}" />
    <input name="label" value="${esc(a.label)}" placeholder="Name" />
    <input name="command" value="${esc(a.command)}" placeholder="${key === 'shell' ? '(shell only)' : 'command'}" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="resumeArgs" value="${esc(a.resumeArgs)}" placeholder="resume args" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="lightArgs" value="${esc(a.lightArgs || '')}" placeholder="light args (!)" title="Tasks marked with ! (cheaper model)" ${key === 'shell' ? 'disabled' : ''}/>
    <input name="heavyArgs" value="${esc(a.heavyArgs || '')}" placeholder="heavy args (!!)" title="Tasks marked with !! (most capable model)" ${key === 'shell' ? 'disabled' : ''}/>
    <label class="local" title="Runs a local model (Ollama, LM Studio…): free, used first for light tasks"><input type="checkbox" name="local" ${a.local ? 'checked' : ''} ${key === 'shell' ? 'disabled' : ''}/> local</label>
    ${builtin ? '<span></span>' : `<button type="button" class="card-btn" title="Delete this custom agent">${icon('close', 13)}</button>`}`;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  return row;
}

function projectRow(p) {
  const row = document.createElement('div');
  row.className = 'project-row';
  row.dataset.path = p.path;
  row.innerHTML = `<input name="name" value="${esc(p.name)}" /><span class="path" title="${esc(p.path)}">${esc(p.path)}</span>
    <input name="verify" value="${esc(p.verify || '')}" placeholder="Check command (e.g. npm test)" title="Runs after each task in this project; if it fails, the agent gets the output and fixes it" />
    <button type="button" class="card-btn" title="Remove the project from the list (keeps the folder)">${icon('close', 13)}</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

// ---------- Appearance ----------
// cfg.ui = { theme: auto|light|dark, accent, uiSize, font: system|geist, termTheme: auto|light|dark, lineHeight }
const ACCENTS = ['#0a84ff', '#bf5af2', '#ff375f', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#8e8e93'];
const TERM_THEMES = {
  dark: {
    background: '#1c1c1e', foreground: '#f2f2f7', cursorAccent: '#1c1c1e', selectionBackground: 'rgba(10,132,255,.35)',
    black: '#3a3a3c', red: '#ff6961', green: '#4ade80', yellow: '#ffd60a', blue: '#64a8ff', magenta: '#d18cff', cyan: '#64d2ff', white: '#e5e5ea',
    brightBlack: '#8e8e93', brightRed: '#ff8a80', brightGreen: '#86efac', brightYellow: '#ffe066', brightBlue: '#8cc2ff', brightMagenta: '#e0b0ff', brightCyan: '#9ae6ff', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1d1d1f', cursorAccent: '#ffffff', selectionBackground: 'rgba(0,122,255,.22)',
    black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#a05a00', blue: '#0040dd', magenta: '#8944ab', cyan: '#0071a4', white: '#6e6e73',
    brightBlack: '#8e8e93', brightRed: '#ff3b30', brightGreen: '#34c759', brightYellow: '#c27c0e', brightBlue: '#007aff', brightMagenta: '#af52de', brightCyan: '#0a95c4', brightWhite: '#3a3a3c',
  },
};
const ui = () => ({
  theme: 'auto', accent: ACCENTS[0], uiSize: 13, font: 'system', termTheme: 'auto', lineHeight: 1.15,
  termFont: '', cursorStyle: 'block', cursorBlink: true, scrollback: 10000, ...(cfg.ui || {}),
});
// Terminal fonts offered in Appearance; empty = the app's monospace font. Missing ones fall back.
const TERM_FONTS = ['', 'SF Mono', 'Menlo', 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'Geist Mono', 'Consolas'];
const monoFont = (u) => (u.termFont ? `"${u.termFont}", ` : '') + getComputedStyle(document.documentElement).getPropertyValue('--font-mono');

// Everything a card's terminal takes from Settings, in one place (new cards and live changes).
// The font size is not here: layoutCard scales it with the zoom.
function termOptions(c, u = lastUi || ui()) {
  return {
    fontFamily: monoFont(u), lineHeight: u.lineHeight, theme: termTheme(c, u),
    cursorStyle: u.cursorStyle, cursorBlink: u.cursorBlink !== false, scrollback: clamp(+u.scrollback || 10000, 1000, 100000),
  };
}
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = (mode) => (mode === 'auto' ? (darkMQ.matches ? 'dark' : 'light') : mode);
function termTheme(c, u = lastUi || ui()) {
  const t = TERM_THEMES[resolvedTheme(u.termTheme === 'auto' ? u.theme : u.termTheme)];
  return { ...t, cursor: agentOf(c).color };
}
function hexRgb(h) { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h || ''); return m ? m.slice(1).map((x) => parseInt(x, 16)).join(', ') : '10, 132, 255'; }

let lastUi = null; // last applied appearance (includes the Settings preview)
function applyAppearance(u = ui()) {
  lastUi = u;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme(u.theme);
  root.dataset.font = u.font;
  root.style.setProperty('--accent', u.accent);
  root.style.setProperty('--accent-rgb', hexRgb(u.accent));
  root.style.setProperty('--ui-scale', `${u.uiSize}px`);
  ab.setTheme(u.theme);
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt?.term) continue;
    Object.assign(rt.term.options, termOptions(c, u));
  }
  applyViewport();
}
// the system switched light/dark (or we did, via nativeTheme): re-apply what is on screen
darkMQ.addEventListener('change', () => applyAppearance(lastUi || ui()));

// ---------- Settings ----------
let shortcutDefs = [];
let draftKeys = {};
let draftUi = null;

function showSettingsSection(sec) {
  for (const b of document.querySelectorAll('.set-nav [data-sec]')) b.classList.toggle('active', b.dataset.sec === sec);
  for (const x of document.querySelectorAll('.set-body > section')) x.classList.toggle('hidden', x.dataset.sec !== sec);
}
$('.set-nav').addEventListener('click', (e) => { const s = e.target.closest('[data-sec]')?.dataset.sec; if (s) showSettingsSection(s); });

// "CmdOrCtrl+Shift+T" → "⇧⌘T" (Mac) / "Ctrl+Shift+T"
function prettyKey(acc) {
  if (!acc) return '—';
  if (!isMac()) return acc.replace(/CmdOrCtrl|CommandOrControl/g, 'Ctrl').replace(/\+/g, ' + ');
  const sym = { CmdOrCtrl: '⌘', CommandOrControl: '⌘', Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Right: '→', Left: '←', Up: '↑', Down: '↓', Space: 'Space', Plus: '+' };
  const parts = acc.split('+').map((p) => sym[p] || p);
  const order = ['⌃', '⌥', '⇧', '⌘'];
  const mods = parts.filter((p) => order.includes(p)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return mods.join('') + parts.filter((p) => !order.includes(p)).join('');
}
// Pressed key → Electron accelerator
function accelFromEvent(e) {
  const k = e.key;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(k)) return null;
  const map = { ' ': 'Space', ArrowRight: 'Right', ArrowLeft: 'Left', ArrowUp: 'Up', ArrowDown: 'Down', '+': 'Plus' };
  let key = map[k] || (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : k.length === 1 ? k.toUpperCase() : k);
  const mods = [];
  if (isMac() ? e.metaKey : e.ctrlKey) mods.push('CmdOrCtrl');
  if (isMac() && e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mods.length && !/^F\d+$/.test(key)) return null; // without a modifier it is not a shortcut
  return [...mods, key].join('+');
}

function renderKeyRows() {
  const box = $('#keyRows');
  const sections = [...new Set(shortcutDefs.map((x) => x.section))];
  const used = {};
  for (const d of shortcutDefs) { const k = d.id in draftKeys ? draftKeys[d.id] : d.key; if (k) (used[k] = used[k] || []).push(d.label); }
  box.innerHTML = sections.map((sec) => `<h3>${esc(sec)}</h3><div class="set-group">${shortcutDefs.filter((d) => d.section === sec).map((d) => {
    const key = d.id in draftKeys ? draftKeys[d.id] : d.key;
    const clash = key && used[key].length > 1;
    return `<div class="set-row">${esc(d.label)}<span class="key-cell">${key !== d.key ? `<button type="button" class="card-btn" data-reset="${esc(d.id)}" title="Restore ${esc(prettyKey(d.key))}">${icon('refresh', 13)}</button>` : ''}
      <button type="button" class="keycap ${clash ? 'clash' : ''}" data-key="${esc(d.id)}" title="${clash ? 'Also used by: ' + esc(used[key].filter((l) => l !== d.label).join(', ')) : 'Click to change'}">${esc(prettyKey(key))}</button></span></div>`;
  }).join('')}</div>`).join('');
}
$('#keyRows').addEventListener('click', (e) => {
  const r = e.target.closest('[data-reset]');
  if (r) { delete draftKeys[r.dataset.reset]; renderKeyRows(); return; }
  const b = e.target.closest('[data-key]');
  if (!b) return;
  b.classList.add('recording'); b.textContent = 'Press keys…';
  const onKey = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === 'Escape') return done();
    if (ev.key === 'Backspace' || ev.key === 'Delete') { draftKeys[b.dataset.key] = ''; return done(); }
    const acc = accelFromEvent(ev);
    if (!acc) return;
    draftKeys[b.dataset.key] = acc; done();
  };
  const done = () => { window.removeEventListener('keydown', onKey, true); renderKeyRows(); };
  window.addEventListener('keydown', onKey, true);
});
$('#keysReset').onclick = () => { draftKeys = {}; renderKeyRows(); };

// Appearance: live preview
// Segmented controls in Appearance and the ui key each one sets.
const APPEARANCE_SEGS = [['themeSeg', 'theme'], ['fontSeg', 'font'], ['termSeg', 'termTheme'], ['cursorSeg', 'cursorStyle']];

function renderAppearanceForm() {
  const f = $('#settingsForm');
  const u = draftUi;
  for (const [id, key] of APPEARANCE_SEGS) {
    for (const b of $('#' + id).querySelectorAll('[data-v]')) b.classList.toggle('active', b.dataset.v === u[key]);
  }
  $('#accentSwatches').innerHTML = ACCENTS.map((c) => `<button type="button" data-accent="${c}" class="${c === u.accent ? 'on' : ''}" style="background:${c}"></button>`).join('')
    + `<input type="color" id="accentCustom" value="${esc(u.accent)}" title="Custom color" />`;
  f.uiSize.value = u.uiSize; $('#uiSizeOut').textContent = `${u.uiSize}px`;
  f.lineHeight.value = u.lineHeight; $('#lineHeightOut').textContent = (+u.lineHeight).toFixed(2);
  $('#fontSizeOut').textContent = `${f.fontSize.value}px`;
  f.termFont.innerHTML = TERM_FONTS.map((n) => `<option value="${esc(n)}">${n ? esc(n) : 'Same as the app'}</option>`).join('');
  f.termFont.value = u.termFont || '';
  f.cursorBlink.checked = u.cursorBlink !== false;
  f.scrollback.value = u.scrollback;
}
function previewUi(patch) { Object.assign(draftUi, patch); applyAppearance(draftUi); renderAppearanceForm(); }
for (const [id, key] of APPEARANCE_SEGS) {
  $('#' + id).addEventListener('click', (e) => { const v = e.target.closest('[data-v]')?.dataset.v; if (v) previewUi({ [key]: v }); });
}
$('#accentSwatches').addEventListener('click', (e) => { const c = e.target.closest('[data-accent]')?.dataset.accent; if (c) previewUi({ accent: c }); });
$('#accentSwatches').addEventListener('input', (e) => { if (e.target.id === 'accentCustom') { Object.assign(draftUi, { accent: e.target.value }); applyAppearance(draftUi); } });
$('#settingsForm').uiSize.addEventListener('input', (e) => previewUi({ uiSize: +e.target.value }));
$('#settingsForm').lineHeight.addEventListener('input', (e) => previewUi({ lineHeight: +e.target.value }));
$('#settingsForm').termFont.addEventListener('change', (e) => previewUi({ termFont: e.target.value }));
$('#settingsForm').cursorBlink.addEventListener('change', (e) => previewUi({ cursorBlink: e.target.checked }));
$('#settingsForm').scrollback.addEventListener('change', (e) => previewUi({ scrollback: clamp(+e.target.value || 10000, 1000, 100000) }));
$('#budgetSeg').addEventListener('click', (e) => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) for (const b of $('#budgetSeg').querySelectorAll('[data-v]')) b.classList.toggle('active', b.dataset.v === v);
});
// Subscriptions out of usage, each with a button to use it again before its reset time.
function renderExhausted() {
  const out = Object.entries(cfg.exhausted || {}).filter(([k, until]) => cfg.agents[k] && until > Date.now());
  $('#exhaustedList').innerHTML = out.length ? out.map(([k, until]) => `${esc(cfg.agents[k].label)} until ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    <button type="button" class="inline" data-reset="${esc(k)}" title="Use it again now">Use Again</button>`).join(' · ') : 'None';
}
$('#exhaustedList').addEventListener('click', (e) => {
  const k = e.target.closest('[data-reset]')?.dataset.reset;
  if (k) { delete cfg.exhausted[k]; renderExhausted(); }
});
$('#settingsForm').fontSize.addEventListener('input', (e) => {
  $('#fontSizeOut').textContent = `${e.target.value}px`;
  cfg.fontSizePreview = +e.target.value; for (const c of cfg.cards) layoutCard(c);
});

// Advanced: settings as JSON (without cards, tasks or flows)
const BULKY = ['cards', 'tasks', 'flows', 'viewport', 'viewports', 'version'];
function settingsJson() {
  const o = {};
  for (const [k, v] of Object.entries(cfg)) if (!BULKY.includes(k) && k !== 'fontSizePreview') o[k] = v;
  return JSON.stringify(o, null, 2);
}
$('#cfgJsonApply').onclick = async () => {
  let obj;
  try { obj = JSON.parse($('#cfgJson').value); } catch (err) { $('#cfgJsonError').textContent = 'Invalid JSON: ' + err.message; return; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { $('#cfgJsonError').textContent = 'It must be an object { … }.'; return; }
  if (obj.agents && typeof obj.agents !== 'object') { $('#cfgJsonError').textContent = '"agents" must be an object.'; return; }
  for (const k of Object.keys(cfg)) if (!BULKY.includes(k) && !(k in obj)) delete cfg[k]; // removed keys
  for (const [k, v] of Object.entries(obj)) if (!BULKY.includes(k)) cfg[k] = v;
  if (!cfg.agents?.shell) cfg.agents = { ...(cfg.agents || {}), shell: { label: 'Terminal', command: '', resumeArgs: '', color: '#8e8e93' } };
  await ab.saveConfig(cfg);
  $('#settings').close('cancel');
  location.reload(); // re-read everything; terminals resume
};

async function openSettings(section = 'general') {
  const dlg = $('#settings');
  const f = $('#settingsForm');
  f.machineName.value = cfg.machineName;
  f.shell.value = cfg.shell;
  f.fontSize.value = cfg.fontSize;
  f.resumeOnOpen.checked = cfg.resumeOnOpen;
  f.keepRunning.checked = cfg.keepRunning !== false;
  f.checkUpdates.checked = cfg.checkUpdates !== false;
  f.quickKey.value = cfg.quickKey ?? 'Control+Alt+Space';
  f.taskAuto.checked = !!cfg.taskAuto;
  f.maxParallel.value = cfg.maxParallel || 3;
  f.perAgentParallel.value = cfg.perAgentParallel || 2;
  f.taskWorktrees.checked = !!cfg.taskWorktrees;
  f.taskRoute.checked = cfg.taskRoute !== false;
  f.taskSubagents.checked = cfg.taskSubagents !== false;
  f.maxSubagents.value = cfg.maxSubagents || 4;
  f.watchErrors.checked = cfg.watchErrors !== false;
  f.taskCheckpoints.checked = cfg.taskCheckpoints !== false;
  f.verifyCmd.value = cfg.verifyCmd || '';
  f.verifyRetries.value = cfg.verifyRetries ?? 2;
  f.crossReview.checked = !!cfg.crossReview;
  f.taskBudgetK.value = cfg.taskBudgetK || 0;
  f.dailyBudgetK.value = cfg.dailyBudgetK || 0;
  for (const b of $('#budgetSeg').querySelectorAll('[data-v]')) b.classList.toggle('active', b.dataset.v === (cfg.budgetAction || 'warn'));
  f.preferLocalForLight.checked = !!cfg.preferLocalForLight;
  f.limitFallback.checked = cfg.limitFallback !== false;
  renderExhausted();
  const rows = $('#agentRows'); rows.innerHTML = '';
  for (const [k, a] of Object.entries(cfg.agents)) rows.appendChild(agentRow(k, a));
  const prow = $('#projectRows'); prow.innerHTML = '';
  cfg.projects.forEach((p) => prow.appendChild(projectRow(p)));
  if (!cfg.projects.length) prow.innerHTML = '<span class="muted small">No projects yet.</span>';
  shortcutDefs = await ab.shortcutsList();
  draftKeys = { ...(cfg.shortcuts || {}) };
  renderKeyRows();
  draftUi = ui();
  renderAppearanceForm();
  $('#cfgJson').value = settingsJson();
  $('#cfgJsonError').textContent = '';
  showSettingsSection(section);
  dlg.showModal();
}

$('#addAgent').onclick = () => {
  $('#agentRows').appendChild(agentRow('custom-' + uid(), { label: '', command: '', resumeArgs: '', color: '#bf5af2' }));
};
$('#revealCfg').onclick = (e) => { e.preventDefault(); ab.revealConfig(); };

$('#settings').addEventListener('close', async () => {
  delete cfg.fontSizePreview;
  if ($('#settings').returnValue !== 'ok') { applyAppearance(); for (const c of cfg.cards) layoutCard(c); return; }
  const f = $('#settingsForm');
  cfg.machineName = f.machineName.value.trim() || cfg.machineName;
  cfg.shell = f.shell.value.trim();
  cfg.fontSize = clamp(+f.fontSize.value || 13, 9, 24);
  cfg.resumeOnOpen = f.resumeOnOpen.checked;
  cfg.keepRunning = f.keepRunning.checked;
  cfg.checkUpdates = f.checkUpdates.checked;
  cfg.quickKey = f.quickKey.value.trim();
  cfg.taskAuto = f.taskAuto.checked;
  cfg.maxParallel = clamp(+f.maxParallel.value || 3, 1, 12);
  cfg.perAgentParallel = clamp(+f.perAgentParallel.value || 2, 1, 6);
  cfg.taskWorktrees = f.taskWorktrees.checked;
  cfg.taskRoute = f.taskRoute.checked;
  cfg.taskSubagents = f.taskSubagents.checked;
  cfg.maxSubagents = clamp(+f.maxSubagents.value || 4, 1, 8);
  cfg.watchErrors = f.watchErrors.checked;
  cfg.taskCheckpoints = f.taskCheckpoints.checked;
  cfg.verifyCmd = f.verifyCmd.value.trim();
  cfg.verifyRetries = clamp(+f.verifyRetries.value || 0, 0, 5);
  cfg.crossReview = f.crossReview.checked;
  cfg.taskBudgetK = clamp(+f.taskBudgetK.value || 0, 0, 100000);
  cfg.dailyBudgetK = clamp(+f.dailyBudgetK.value || 0, 0, 1000000);
  cfg.budgetAction = $('#budgetSeg .active')?.dataset.v || 'warn';
  cfg.preferLocalForLight = f.preferLocalForLight.checked;
  cfg.limitFallback = f.limitFallback.checked;
  cfg.ui = { ...draftUi };
  cfg.shortcuts = Object.fromEntries(Object.entries(draftKeys).filter(([id, k]) => shortcutDefs.find((d) => d.id === id)?.key !== k));

  const agents = {};
  for (const row of document.querySelectorAll('#agentRows .agent-row')) {
    const get = (n) => row.querySelector(`[name=${n}]`).value.trim();
    const key = row.dataset.key;
    if (key !== 'shell' && !get('command')) continue;
    const shellOnly = key === 'shell';
    agents[key] = {
      ...(cfg.agents[key] || {}), label: get('label') || get('command') || key, color: get('color'),
      command: shellOnly ? '' : get('command'), resumeArgs: shellOnly ? '' : get('resumeArgs'),
      lightArgs: shellOnly ? '' : get('lightArgs'), heavyArgs: shellOnly ? '' : get('heavyArgs'),
      local: !shellOnly && row.querySelector('[name=local]').checked,
    };
  }
  if (!agents.shell) agents.shell = { label: 'Terminal', command: '', resumeArgs: '', color: '#8e8e93' };
  cfg.agents = agents;

  const rows = new Map([...document.querySelectorAll('#projectRows .project-row')].map((r) => [r.dataset.path, {
    name: r.querySelector('[name=name]').value.trim(), verify: r.querySelector('[name=verify]').value.trim(),
  }]));
  cfg.projects = cfg.projects.filter((p) => rows.has(p.path)).map((p) => ({ ...p, name: rows.get(p.path).name || basename(p.path), verify: rows.get(p.path).verify }));
  if (!cfg.projects.some((p) => p.path === cfg.selectedProject)) cfg.selectedProject = cfg.projects[0]?.path || null;
  if (cfg.activeSpace && cfg.activeSpace !== '*' && !cfg.projects.some((p) => p.path === cfg.activeSpace)) cfg.activeSpace = '*';

  await ab.saveConfig(cfg);
  ab.rebuildMenu();
  ab.applyQuickKey().then((r) => { if (!r.ok) toast(esc(r.error), 5000); });
  $('#machine').textContent = cfg.machineName;
  applyAppearance();
  renderSpaces();
  for (const c of cfg.cards) { refreshCardHead(c); const rt = runtime.get(c.id); if (rt) rt.el.style.display = inSpace(c) ? '' : 'none'; }
  renderSidebar();
  if (typeof renderTaskOptions === 'function') renderTaskOptions();
  agentAvailable = await ab.checkAgents();
  renderAgentButtons();
  applyViewport();
});
