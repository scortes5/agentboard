// AgentBoard — lista de tareas (ToDo) que se reparten entre tus suscripciones.
// Cada tarea corre en una sesión nueva de un agente (contexto limpio = menos tokens),
// varias a la vez, y se marca sola cuando el agente avisa "HECHO:" o llama complete_task.
'use strict';
/* global ab, cfg, $, esc, uid, basename, clamp, isMac, runtime, cardData, agentOf, newCard, focusCardView, focusCard,
   ensureGroup, slotIn, looseSpot, terminalTail, toast, save, agentAvailable, visibleRect, applyViewport, drawMinimap, projectOfPath */

const STATUS = {
  pendiente: 'En cola',
  en_curso: 'Trabajando',
  revisar: 'Necesita tu revisión',
  hecho: 'Hecho',
  bloqueado: 'Bloqueado',
};
const IDLE_REVIEW_MS = 20000;   // trabajando → "revisar" si el agente queda callado este tiempo
const taskRt = new Map();       // id -> { lastBusy, dispatching }
const lastAssigned = {};        // agente -> timestamp (desempate del reparto)
let taskFilter = 'active';

// ---------- Datos ----------
function tasks() { return cfg.tasks || (cfg.tasks = []); }
const runningOf = (key) => tasks().filter((t) => t.status === 'en_curso' && t.assigned === key).length;
const subscriptions = () => Object.entries(cfg.agents).filter(([k, a]) => a.command && k !== 'shell' && !a.hidden);
function autoAgents() {
  if (!cfg.autoAgents) cfg.autoAgents = ['claude', 'codex', 'gemini'].filter((k) => cfg.agents[k]);
  return cfg.autoAgents.filter((k) => cfg.agents[k]?.command && agentAvailable[k] !== false);
}
function agentKeyFrom(word) {
  const w = String(word || '').toLowerCase();
  if (!w || w === 'auto') return 'auto';
  return Object.keys(cfg.agents).find((k) => k === w || (cfg.agents[k].label || '').toLowerCase() === w
    || (cfg.agents[k].label || '').toLowerCase().split(/\s+/)[0] === w) || null;
}
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function projectFrom(word) {
  const w = slug(word);
  return cfg.projects.find((p) => slug(p.name) === w || slug(basename(p.path)) === w) || null;
}

// "@codex arreglar login #backend +web !"  →  { text, agent, group, cwd, light }
function parseLine(line, defaults) {
  const t = { agent: defaults.agent, cwd: defaults.cwd, light: defaults.light, group: defaults.group || '' };
  const words = [];
  for (const w of line.trim().split(/\s+/)) {
    let m;
    if ((m = w.match(/^@([\w.-]+)$/)) && agentKeyFrom(m[1])) t.agent = agentKeyFrom(m[1]);
    else if ((m = w.match(/^#([\p{L}\p{N}_-]+)$/u))) t.group = m[1].replace(/-/g, ' ');
    else if ((m = w.match(/^\+([\p{L}\p{N}._-]+)$/u)) && projectFrom(m[1])) t.cwd = projectFrom(m[1]).path;
    else if (w === '!' || /^!(ligero|light|rapido|rápido)$/i.test(w)) t.light = true;
    else words.push(w);
  }
  t.text = words.join(' ').replace(/^[-*•]\s+|^\[\s?\]\s+|^\d+[.)]\s+/, '').trim();
  return t;
}

function addTask(fields) {
  const t = {
    id: uid(), text: fields.text, status: 'pendiente', agent: fields.agent || 'auto',
    cwd: fields.cwd ?? cfg.selectedProject ?? null, group: fields.group || '', light: !!fields.light,
    worktree: fields.worktree ?? null, from: fields.from || null, createdAt: Date.now(),
  };
  tasks().push(t);
  save(); renderTasks();
  return t;
}

// ---------- Reparto ----------
// Suscripción para una tarea: la elegida, o en "auto" la con menos tareas corriendo
// (desempata la que lleva más tiempo sin recibir una). Respeta el cupo por suscripción.
function pickAgent(t) {
  const per = cfg.perAgentParallel || 2;
  if (t.agent && t.agent !== 'auto') {
    return cfg.agents[t.agent]?.command && runningOf(t.agent) < per ? t.agent : null;
  }
  const cands = autoAgents().filter((k) => runningOf(k) < per);
  if (!cands.length) return null;
  cands.sort((a, b) => runningOf(a) - runningOf(b) || (lastAssigned[a] || 0) - (lastAssigned[b] || 0));
  return cands[0];
}

function taskPrompt(t) {
  return `[Tarea AgentBoard ${t.id}] ${t.text}\n`
    + '(Solo esto y breve; skill tarea-agentboard si la tienes. Al terminar llama complete_task si existe y cierra con la línea «HECHO: …» o «BLOQUEADO: …».)';
}

async function startTask(t, key) {
  const a = cfg.agents[key];
  t.status = 'en_curso'; t.assigned = key; t.startedAt = Date.now(); t.summary = '';
  lastAssigned[key] = Date.now();
  taskRt.set(t.id, { lastBusy: Date.now(), dispatching: true });
  save(); renderTasks();

  let cwd = t.cwd || cfg.selectedProject || null;
  const wantWorktree = t.worktree ?? cfg.taskWorktrees;
  if (wantWorktree && cwd) {
    const r = await ab.gitWorktree(cwd, t.text.split(/\s+/).slice(0, 5).join(' '));
    if (r.ok) { cwd = r.value.dir; t.branch = r.value.branch; t.workdir = r.value.dir; }
    else toast(`Sin worktree para esta tarea (${esc(r.error)}); uso la carpeta del proyecto.`, 5000);
  }
  const g = t.group ? ensureGroup(t.group) : null;
  const pos = g ? slotIn(g) : looseSpot();
  const title = t.text.length > 34 ? t.text.slice(0, 32).trim() + '…' : t.text;
  const card = newCard('term', key, {
    cwd, title, args: t.light ? (a.lightArgs || '') : '', prompt: taskPrompt(t), taskId: t.id, noFocus: true, ...pos,
  });
  if (!card) { t.status = 'pendiente'; taskRt.delete(t.id); save(); renderTasks(); return; }
  t.cardId = card.id;
  save(); renderTasks();
  setTimeout(() => { const rt = taskRt.get(t.id); if (rt) rt.dispatching = false; }, 4000);
  toast(`Tarea → <b>${esc(a.label)}</b>${g ? ` en ${esc(g.title)}` : ''}: ${esc(title)}`);
}

function dispatchQueued() {
  let slots = (cfg.maxParallel || 3) - tasks().filter((t) => t.status === 'en_curso').length;
  for (const t of tasks()) {
    if (slots <= 0) break;
    if (t.status !== 'pendiente') continue;
    const key = pickAgent(t);
    if (!key) continue;
    slots--;
    startTask(t, key);
  }
}

// Busca «HECHO: …» / «BLOQUEADO: …» al final de la terminal (ignora el eco de la instrucción).
function findMarker(c) {
  const lines = terminalTail(c, 30).split('\n').reverse();
  for (const line of lines) {
    const m = line.match(/(?:^|[\s●⏺•>*✦│])(HECHO|BLOQUEADO):\s*(.+?)\s*$/);
    // el eco de nuestra propia instrucción dice «HECHO: …»: se ignora por el "…"
    if (!m || m[2].startsWith('…') || m[2].length < 3) continue;
    return { status: m[1] === 'HECHO' ? 'hecho' : 'bloqueado', text: m[2].slice(0, 300) };
  }
  return null;
}

function finishTask(t, status, summary) {
  t.status = status; t.summary = summary || t.summary || ''; t.finishedAt = Date.now();
  taskRt.delete(t.id);
  const a = cfg.agents[t.assigned];
  toast(`${status === 'hecho' ? '✓' : '⚠'} ${esc(a?.label || '')}: ${esc(t.text.slice(0, 60))}`, 4500);
  if (!document.hasFocus()) {
    try { new Notification(status === 'hecho' ? 'Tarea hecha' : 'Tarea bloqueada', { body: `${t.text.slice(0, 80)}\n${t.summary}` }); } catch {}
  }
}

function tickTasks() {
  if (!cfg) return;
  let changed = false;
  const now = Date.now();
  for (const t of tasks()) {
    if (t.status !== 'en_curso' && t.status !== 'revisar') continue;
    const c = t.cardId && cardData(t.cardId);
    const rt = c && runtime.get(c.id);
    if (!c || !rt) { t.status = 'revisar'; t.summary = t.summary || 'Se cerró la tarjeta del agente.'; t.cardId = null; changed = true; continue; }
    const st = taskRt.get(t.id) || { lastBusy: t.startedAt || now };
    taskRt.set(t.id, st);
    if (st.dispatching) continue;
    const m = findMarker(c);
    if (m) { finishTask(t, m.status, m.text); changed = true; continue; }
    if (rt.status === 'busy') {
      st.lastBusy = now;
      if (t.status === 'revisar') { t.status = 'en_curso'; changed = true; }
    } else if (t.status === 'en_curso' && (rt.status === 'dead' || now - st.lastBusy > IDLE_REVIEW_MS)) {
      t.status = 'revisar'; changed = true; // terminó o espera algo (permiso, pregunta)
    }
  }
  if (cfg.taskAuto) dispatchQueued();
  if (changed) { save(); renderTasks(); }
  updateBadge();
}

// ---------- Panel ----------
function updateBadge() {
  const n = tasks().filter((t) => t.status === 'pendiente' || t.status === 'en_curso' || t.status === 'revisar').length;
  const review = tasks().filter((t) => t.status === 'revisar' || t.status === 'bloqueado').length;
  const b = $('#tasksBadge');
  b.textContent = review ? `${n} · ${review}!` : String(n);
  b.classList.toggle('hidden', !n && !review);
  b.classList.toggle('warn', review > 0);
}

function renderTaskOptions() {
  $('#taskAuto').checked = !!cfg.taskAuto;
  $('#taskParallel').value = cfg.maxParallel || 3;
  $('#taskPerAgent').value = cfg.perAgentParallel || 2;
  $('#taskWorktree').checked = !!cfg.taskWorktrees;
  const auto = new Set(autoAgents());
  $('#taskAutoAgents').innerHTML = subscriptions().map(([k, a]) =>
    `<button type="button" data-k="${esc(k)}" class="${auto.has(k) ? 'active' : ''}" title="${agentAvailable[k] === false ? 'No instalado' : ''}">
      <span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}</button>`).join('');
  const sel = $('#taskAgent');
  const prevAgent = sel.value || 'auto';
  sel.innerHTML = '<option value="auto">Auto (reparte)</option>'
    + subscriptions().map(([k, a]) => `<option value="${esc(k)}">${esc(a.label)}</option>`).join('');
  sel.value = [...sel.options].some((o) => o.value === prevAgent) ? prevAgent : 'auto';
  const ps = $('#taskProject');
  ps.innerHTML = cfg.projects.map((p) => `<option value="${esc(p.path)}">${esc(p.name)}</option>`).join('') || '<option value="">Carpeta personal</option>';
  ps.value = cfg.selectedProject || cfg.projects[0]?.path || '';
}

function chip(text, cls = '', style = '') { return `<span class="tchip ${cls}" ${style ? `style="${style}"` : ''}>${text}</span>`; }

function renderTasks() {
  const list = $('#taskList');
  if (!list) return;
  const active = (t) => t.status !== 'hecho';
  const shown = tasks().filter((t) => taskFilter === 'all' || (taskFilter === 'done' ? !active(t) : active(t)));
  const order = { revisar: 0, bloqueado: 1, en_curso: 2, pendiente: 3, hecho: 4 };
  shown.sort((a, b) => (order[a.status] - order[b.status]) || (taskFilter === 'done' ? (b.finishedAt || 0) - (a.finishedAt || 0) : 0));

  const counts = {};
  for (const t of tasks()) counts[t.status] = (counts[t.status] || 0) + 1;
  $('#taskCounts').textContent = [
    counts.en_curso && `${counts.en_curso} trabajando`, counts.pendiente && `${counts.pendiente} en cola`,
    (counts.revisar || counts.bloqueado) && `${(counts.revisar || 0) + (counts.bloqueado || 0)} por revisar`,
  ].filter(Boolean).join(' · ');

  if (!shown.length) {
    list.innerHTML = `<div class="side-empty">${tasks().length ? 'Nada aquí.' : 'Escribe abajo lo que tienes pendiente. Cada línea es una tarea; se reparten entre tus suscripciones y corren en paralelo.'}</div>`;
    updateBadge();
    return;
  }
  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || '~';
  list.innerHTML = shown.map((t) => {
    const key = t.assigned || t.agent;
    const a = key && key !== 'auto' ? cfg.agents[key] : null;
    const who = a ? chip(esc(a.label), 'agent', `--agent:${esc(a.color)}`) : chip('auto', 'agent');
    const meta = [
      who,
      chip(esc(projName(t.cwd))),
      t.group ? chip('▢ ' + esc(t.group)) : '',
      t.light ? chip('ligero', 'light') : '',
      t.branch ? chip('⎇ ' + esc(t.branch.replace(/^agentboard\//, '')), '', '') : '',
      t.from ? chip('de ' + esc(cardData(t.from)?.title || 'un agente')) : '',
    ].join('');
    const acts = {
      pendiente: '<button data-a="run" title="Ejecutar ahora">▶</button><button data-a="del" title="Borrar">✕</button>',
      en_curso: '<button data-a="go" title="Ir al agente">⤢</button><button data-a="done" title="Marcar hecha">✓</button>',
      revisar: '<button data-a="go" title="Ir al agente">⤢</button><button data-a="done" title="Marcar hecha">✓</button>',
      bloqueado: '<button data-a="go" title="Ir al agente">⤢</button><button data-a="retry" title="Volver a la cola">↻</button><button data-a="done" title="Marcar hecha">✓</button>',
      hecho: '<button data-a="retry" title="Volver a la cola">↻</button><button data-a="del" title="Borrar">✕</button>',
    }[t.status];
    return `<div class="task st-${t.status}" data-id="${esc(t.id)}">
      <span class="tdot" title="${STATUS[t.status]}"></span>
      <div class="tmain">
        <div class="ttext" title="Doble clic para editar">${esc(t.text)}</div>
        <div class="tmeta">${meta}</div>
        ${t.summary ? `<div class="tsum">${esc(t.summary)}</div>` : ''}
        ${t.status === 'revisar' ? '<div class="tsum warn">El agente está esperando: revisa si terminó o si te preguntó algo.</div>' : ''}
      </div>
      <div class="tacts">${acts}</div>
    </div>`;
  }).join('');
  updateBadge();
}

function taskById(id) { return tasks().find((t) => t.id === id); }

$('#taskList').addEventListener('click', (e) => {
  const row = e.target.closest('.task');
  const act = e.target.closest('[data-a]')?.dataset.a;
  if (!row || !act) return;
  const t = taskById(row.dataset.id);
  if (!t) return;
  if (act === 'run') {
    const key = t.agent !== 'auto' ? t.agent : (pickAgent(t) || autoAgents()[0]);
    if (!key) return toast('No hay suscripciones disponibles para "auto". Actívalas arriba.');
    startTask(t, key);
  } else if (act === 'del') {
    cfg.tasks = tasks().filter((x) => x !== t); save(); renderTasks();
  } else if (act === 'go') {
    const c = t.cardId && cardData(t.cardId);
    if (c) { if (diagramOpen()) toggleDiagram(false); focusCardView(c); focusCard(c.id); }
  } else if (act === 'done') {
    finishTask(t, 'hecho', t.summary || 'Marcada a mano.'); save(); renderTasks();
  } else if (act === 'retry') {
    Object.assign(t, { status: 'pendiente', cardId: null, assigned: null, summary: '', finishedAt: null });
    save(); renderTasks();
  }
});

$('#taskList').addEventListener('dblclick', (e) => {
  const el = e.target.closest('.ttext');
  const t = el && taskById(el.closest('.task').dataset.id);
  if (!t || t.status !== 'pendiente') return;
  el.contentEditable = 'true'; el.focus();
  document.getSelection().selectAllChildren(el);
  const done = () => { el.contentEditable = 'false'; t.text = el.textContent.trim() || t.text; save(); renderTasks(); };
  el.addEventListener('blur', done, { once: true });
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); el.blur(); } });
});

function composerDefaults() {
  return { agent: $('#taskAgent').value || 'auto', cwd: $('#taskProject').value || null, light: $('#taskLight').checked };
}

function addFromComposer() {
  const input = $('#taskInput');
  const lines = input.value.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return;
  const d = composerDefaults();
  // una línea que empieza con #grupo / @agente sin texto aplica a las siguientes
  let carry = {};
  let n = 0;
  for (const line of lines) {
    const t = parseLine(line, { ...d, ...carry });
    if (!t.text) { carry = { agent: t.agent, group: t.group, cwd: t.cwd, light: t.light }; continue; }
    addTask(t); n++;
  }
  input.value = '';
  toast(`${n} tarea${n === 1 ? '' : 's'} en cola${cfg.taskAuto ? '' : ' — activa "Ejecutar la cola" o usa ▶'}`);
  tickTasks();
}

async function planWithAI() {
  const input = $('#taskInput');
  const text = input.value.trim();
  if (!text) return toast('Escribe tus pendientes primero; Claude (haiku) los divide en tareas.');
  const btn = $('#taskPlan');
  btn.disabled = true; btn.textContent = '✨ Dividiendo…';
  const r = await ab.planTasks(text, { agents: subscriptions().map(([k]) => k), projects: cfg.projects.map((p) => p.name) });
  btn.disabled = false; btn.textContent = '✨ Dividir';
  if (!r.ok) return toast(`No pude dividir con Claude: ${esc(r.error)}`, 6000);
  const d = composerDefaults();
  for (const x of r.value) {
    const proj = x.project && projectFrom(x.project);
    addTask({ text: x.text.trim(), agent: agentKeyFrom(x.agent) || d.agent, cwd: proj ? proj.path : d.cwd, light: !!x.light || d.light, group: (x.group || '').trim() });
  }
  input.value = '';
  toast(`${r.value.length} tareas creadas con haiku`);
}

function toggleTasks(force) {
  cfg.tasksOpen = force ?? !cfg.tasksOpen;
  document.body.classList.toggle('tasks-open', !!cfg.tasksOpen);
  if (cfg.tasksOpen) { renderTaskOptions(); renderTasks(); setTimeout(() => $('#taskInput').focus(), 50); }
  drawMinimap(); save();
}

function openTasks(prefill = '') {
  toggleTasks(true);
  const input = $('#taskInput');
  if (prefill && !input.value.startsWith(prefill)) input.value = prefill + input.value;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

// ---------- Puente: los agentes pueden agregar y cerrar tareas ----------
ab.onBridgeAsk(({ reqId, kind, payload }) => {
  let value = null;
  try {
    if (kind === 'task-add') {
      const agent = agentKeyFrom(payload.agent);
      if (!agent) throw new Error(`Agente desconocido. Opciones: auto, ${subscriptions().map(([k]) => k).join(', ')}`);
      const caller = payload.from && cardData(payload.from);
      const proj = payload.project ? projectFrom(payload.project) : null;
      if (payload.project && !proj) throw new Error(`Proyecto desconocido. Opciones: ${cfg.projects.map((p) => p.name).join(', ')}`);
      const t = addTask({
        text: payload.text, agent, light: payload.light, group: payload.group || (caller ? (cardData(caller.groupId)?.title || '') : ''),
        cwd: proj ? proj.path : caller ? projectOfPath(caller.cwd) : cfg.selectedProject, from: payload.from,
      });
      value = { id: t.id, agent: agent === 'auto' ? 'la suscripción con menos carga' : cfg.agents[agent].label };
      setTimeout(tickTasks, 50);
    } else if (kind === 'task-done') {
      const t = payload.id ? taskById(payload.id)
        : tasks().find((x) => x.cardId === payload.card && (x.status === 'en_curso' || x.status === 'revisar'))
          || tasks().find((x) => x.cardId === payload.card && x.status !== 'hecho');
      if (!t) throw new Error('No encontré una tarea asignada a este agente.');
      finishTask(t, payload.blocked ? 'bloqueado' : 'hecho', payload.summary);
      save(); renderTasks();
      value = { text: t.text, status: t.status };
    }
  } catch (err) {
    value = { error: err.message };
  }
  ab.bridgeAnswer(reqId, value);
});

// ---------- Arranque ----------
function initTasks() {
  if (cfg.taskAuto == null) cfg.taskAuto = true;
  // tareas que quedaron "trabajando" al cerrar: su tarjeta se reanuda; si ya no existe, a revisar
  for (const t of tasks()) if ((t.status === 'en_curso') && (!t.cardId || !cardData(t.cardId))) t.status = 'revisar';
  document.body.classList.toggle('tasks-open', !!cfg.tasksOpen);
  renderTaskOptions();
  renderTasks();
  setInterval(tickTasks, 1000);

  $('#tasksClose').onclick = () => toggleTasks(false);
  $('#taskAdd').onclick = addFromComposer;
  $('#taskPlan').onclick = planWithAI;
  $('#taskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addFromComposer(); }
  });
  $('#taskAuto').onchange = (e) => { cfg.taskAuto = e.target.checked; save(); tickTasks(); };
  $('#taskWorktree').onchange = (e) => { cfg.taskWorktrees = e.target.checked; save(); };
  $('#taskParallel').onchange = (e) => { cfg.maxParallel = clamp(+e.target.value || 3, 1, 12); e.target.value = cfg.maxParallel; save(); tickTasks(); };
  $('#taskPerAgent').onchange = (e) => { cfg.perAgentParallel = clamp(+e.target.value || 2, 1, 6); e.target.value = cfg.perAgentParallel; save(); tickTasks(); };
  $('#taskAutoAgents').addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]')?.dataset.k;
    if (!k) return;
    autoAgents();
    cfg.autoAgents = cfg.autoAgents.includes(k) ? cfg.autoAgents.filter((x) => x !== k) : [...cfg.autoAgents, k];
    save(); renderTaskOptions();
  });
  $('#taskFilter').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f) {
      taskFilter = f;
      $('#taskFilter').querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === f));
      renderTasks();
    }
  });
  $('#taskClear').onclick = () => { cfg.tasks = tasks().filter((t) => t.status !== 'hecho'); save(); renderTasks(); };
  $('#project').addEventListener('change', () => { $('#taskProject').value = cfg.selectedProject || ''; });
}
