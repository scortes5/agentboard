// AgentBoard — lista de tareas (ToDo) que se reparten entre tus suscripciones.
// Cada tarea corre en una sesión nueva de un agente (contexto limpio = menos tokens),
// varias a la vez, y se marca sola cuando el agente avisa "HECHO:" o llama complete_task.
'use strict';
/* global ab, cfg, $, esc, uid, basename, clamp, isMac, runtime, cardData, agentOf, newCard, focusCardView, focusCard, closeCard, closePopover, openPopover,
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

// "@codex arreglar login #backend +web !"  →  { text, agent, group, cwd, light, heavy }
function parseLine(line, defaults) {
  const t = { agent: defaults.agent, cwd: defaults.cwd, light: defaults.light, heavy: defaults.heavy, group: defaults.group || '' };
  const words = [];
  for (const w of line.trim().split(/\s+/)) {
    let m;
    if ((m = w.match(/^@([\w.-]+)$/)) && agentKeyFrom(m[1])) t.agent = agentKeyFrom(m[1]);
    else if ((m = w.match(/^#([\p{L}\p{N}_-]+)$/u))) t.group = m[1].replace(/-/g, ' ');
    else if ((m = w.match(/^\+([\p{L}\p{N}._-]+)$/u)) && projectFrom(m[1])) t.cwd = projectFrom(m[1]).path;
    else if (w === '!' || /^!(ligero|light|rapido|rápido)$/i.test(w)) { t.light = true; t.heavy = false; }
    else if (w === '!!' || /^!(potente|heavy|fuerte)$/i.test(w)) { t.heavy = true; t.light = false; }
    else words.push(w);
  }
  t.text = words.join(' ').replace(/^[-*•]\s+|^\[\s?\]\s+|^\d+[.)]\s+/, '').trim();
  return t;
}

function addTask(fields) {
  const t = {
    id: uid(), text: fields.text, status: 'pendiente', agent: fields.agent || 'auto',
    cwd: fields.cwd ?? cfg.selectedProject ?? null, group: fields.group || '', light: !!fields.light, heavy: !!fields.heavy && !fields.light,
    worktree: fields.worktree ?? null, from: fields.from || null, createdAt: Date.now(),
  };
  tasks().push(t);
  save(); renderTasks();
  return t;
}

// ---------- Reparto ----------
// Suscripción para una tarea: la elegida, o en "auto" la con menos tareas corriendo
// (desempata la que lleva más tiempo sin recibir una). Respeta el cupo por suscripción.
// Suscripciones que llegaron a su límite de uso: no reciben tareas hasta que se renueve.
function exhaustedUntil(key) {
  const until = cfg.exhausted?.[key];
  if (!until) return 0;
  if (Date.now() > until) { delete cfg.exhausted[key]; save(); return 0; }
  return until;
}

function pickAgent(t) {
  const per = cfg.perAgentParallel || 2;
  if (t.agent && t.agent !== 'auto') {
    return cfg.agents[t.agent]?.command && runningOf(t.agent) < per && !exhaustedUntil(t.agent) ? t.agent : null;
  }
  const cands = autoAgents().filter((k) => runningOf(k) < per && !exhaustedUntil(k));
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
  const g = t.group ? ensureGroup(t.group, projectOfPath(t.cwd || cfg.selectedProject || '')) : null;
  const pos = g ? slotIn(g) : looseSpot();
  const title = t.text.length > 34 ? t.text.slice(0, 32).trim() + '…' : t.text;
  const card = newCard('term', key, {
    cwd, title, args: t.light ? (a.lightArgs || '') : t.heavy ? (a.heavyArgs || '') : '', prompt: taskPrompt(t), taskId: t.id, noFocus: true, ...pos,
  });
  if (!card) { t.status = 'pendiente'; taskRt.delete(t.id); save(); renderTasks(); return; }
  t.cardId = card.id;
  save(); renderTasks();
  setTimeout(() => { const rt = taskRt.get(t.id); if (rt) rt.dispatching = false; }, 4000);
  toast(`Tarea → <b>${esc(a.label)}</b>${g ? ` en ${esc(g.title)}` : ''}: ${esc(title)}`);
}

// onlyFlows: con "Ejecutar la cola" apagado igual corren los pasos de automatizaciones
function dispatchQueued(onlyFlows = false) {
  let slots = (cfg.maxParallel || 3) - tasks().filter((t) => t.status === 'en_curso').length;
  for (const t of tasks()) {
    if (slots <= 0) break;
    if (t.status !== 'pendiente' || (onlyFlows && !t.flowRun)) continue;
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

// "Claude usage limit reached… resets 3pm", "You've hit your usage limit… try again in 2 hours"
const LIMIT_RE = /(usage limit|limit reached|hit your (usage )?limit|rate limit exceeded|quota exceeded|out of (credits|quota))/i;
function findLimit(c) {
  const text = terminalTail(c, 20);
  const line = text.split('\n').reverse().find((l) => LIMIT_RE.test(l) && /(reset|try again|vuelve|renew|in \d)/i.test(l));
  if (!line) return null;
  let until = Date.now() + 60 * 60_000; // sin hora: reintenta en 1 h
  let m;
  if ((m = line.match(/in\s+(\d+)\s*(h|hours?|m|min|minutes?)\b/i))) {
    until = Date.now() + (+m[1]) * (/^h/i.test(m[2]) ? 3_600_000 : 60_000);
  } else if ((m = line.match(/reset[s]?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i))) {
    const d = new Date();
    let h = +m[1] % 12 + (/pm/i.test(m[3] || '') ? 12 : 0);
    if (!m[3]) h = +m[1];
    d.setHours(h, +(m[2] || 0), 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    until = d.getTime();
  }
  return { until, line: line.trim().slice(0, 160) };
}

// Pregunta de confianza de carpeta (primera vez que un CLI abre un proyecto o worktree)
const TRUST_RE = /(trust (this folder|the files)|one you trust|Do you trust|confías en)/i;

// Responde "sí, confío" moviendo la selección hasta la opción afirmativa.
async function acceptTrust(t) {
  const c = t.cardId && cardData(t.cardId);
  if (!c) return;
  for (let i = 0; i < 4; i++) {
    const lines = terminalTail(c, 12).split('\n');
    const sel = lines.find((l) => /^\s*[❯>]/.test(l)) || '';
    if (/yes|sí|trust|proceed/i.test(sel)) { ab.ptyWrite(c.id, '\r'); break; }
    ab.ptyWrite(c.id, '\x1b[B');
    await new Promise((r) => setTimeout(r, 300));
  }
  t.needsTrust = false;
  renderTasks();
}

function finishTask(t, status, summary) {
  t.status = status; t.summary = summary || t.summary || ''; t.finishedAt = Date.now();
  taskRt.delete(t.id);
  const a = cfg.agents[t.assigned];
  toast(`${status === 'hecho' ? 'Hecho' : 'Bloqueado'} · ${esc(a?.label || '')}: ${esc(t.text.slice(0, 60))}`, 4500);
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
    const lim = findLimit(c);
    if (lim && t.assigned) {
      // la suscripción se quedó sin cupo: vuelve a la cola para que la tome otra
      cfg.exhausted = { ...(cfg.exhausted || {}), [t.assigned]: lim.until };
      const label = cfg.agents[t.assigned]?.label || t.assigned;
      toast(`${esc(label)} llegó a su límite (hasta ${new Date(lim.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Reasigno la tarea.`, 6000);
      Object.assign(t, { status: 'pendiente', cardId: null, assigned: t.agent === 'auto' ? null : t.assigned, summary: `${label}: ${lim.line}` });
      taskRt.delete(t.id);
      changed = true; continue;
    }
    const trust = TRUST_RE.test(terminalTail(c, 14));
    if (trust !== !!t.needsTrust) { t.needsTrust = trust; changed = true; }
    if (rt.status === 'busy') {
      st.lastBusy = now;
      if (t.status === 'revisar') { t.status = 'en_curso'; changed = true; }
    } else if (t.status === 'en_curso' && (rt.status === 'dead' || now - st.lastBusy > IDLE_REVIEW_MS)) {
      t.status = 'revisar'; changed = true; // terminó o espera algo (permiso, pregunta)
    }
  }
  dispatchQueued(!cfg.taskAuto);
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
  ab.setBadge(review);
}

function renderTaskOptions() {
  $('#taskAuto').checked = !!cfg.taskAuto;
  $('#taskParallel').value = cfg.maxParallel || 3;
  $('#taskPerAgent').value = cfg.perAgentParallel || 2;
  $('#taskWorktree').checked = !!cfg.taskWorktrees;
  const auto = new Set(autoAgents());
  $('#taskAutoAgents').innerHTML = subscriptions().map(([k, a]) =>
    `<button type="button" data-k="${esc(k)}" class="${auto.has(k) ? 'active' : ''} ${exhaustedUntil(k) ? 'spent' : ''}" title="${agentAvailable[k] === false ? 'No instalado en este equipo' : exhaustedUntil(k) ? 'Llegó a su límite de uso; vuelve a recibir tareas a esa hora' : auto.has(k) ? 'Participa del reparto automático; clic para excluirla' : 'No participa del reparto automático; clic para incluirla'}">
      <span class="dot" style="background:${esc(a.color)}"></span>${esc(a.label)}${exhaustedUntil(k) ? ` <em>hasta ${new Date(exhaustedUntil(k)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</em>` : ''}</button>`).join('');
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
      t.group ? chip(esc(t.group)) : '',
      t.light ? chip('ligero', 'light') : '',
      t.heavy ? chip('potente', 'heavy') : '',
      t.branch ? chip(icon('branch', 11) + ' ' + esc(t.branch.replace(/^agentboard\//, '')), 'branch') : '',
      t.from ? chip('de ' + esc(cardData(t.from)?.title || 'un agente')) : '',
      t.flowRun ? chip('automatización') : '',
    ].join('');
    const B = (a, ic, tip) => `<button data-a="${a}" title="${tip}">${icon(ic, 14)}</button>`;
    const wt = t.workdir && t.branch ? B('diff', 'diff', 'Ver los cambios de su worktree y fusionarlos o descartarlos') : '';
    const go = B('go', 'focus', 'Ir a la tarjeta del agente');
    const done = B('done', 'check', 'Marcar como hecha');
    const retry = B('retry', 'refresh', 'Volver a ponerla en la cola');
    const del = B('del', 'trash', 'Borrar la tarea');
    const acts = {
      pendiente: B('top', 'up', 'Subir al primer lugar de la cola') + B('run', 'play', 'Ejecutar ahora, sin esperar la cola') + del,
      en_curso: go + done,
      revisar: wt + go + done,
      bloqueado: go + retry + done,
      hecho: wt + retry + del,
    }[t.status];
    return `<div class="task st-${t.status}" data-id="${esc(t.id)}">
      <span class="tdot" title="${STATUS[t.status]}"></span>
      <div class="tmain">
        <div class="ttext" title="Doble clic para editar">${esc(t.text)}</div>
        <div class="tmeta">${meta}</div>
        ${t.summary ? `<div class="tsum">${esc(t.summary)}</div>` : ''}
        ${t.needsTrust ? '<div class="tsum warn">Pregunta si confías en la carpeta. <button class="inline" data-a="trust" title="Responde que sí confías en esta carpeta y la tarea continúa">Confiar y seguir</button></div>'
          : t.status === 'revisar' ? '<div class="tsum warn">El agente está esperando: revisa si terminó o si te preguntó algo.</div>' : ''}
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
  } else if (act === 'trust') {
    acceptTrust(t);
  } else if (act === 'top') {
    cfg.tasks = [t, ...tasks().filter((x) => x !== t)]; save(); renderTasks();
  } else if (act === 'diff') {
    worktreeMenu(t, e.target.closest('button'));
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

// Revisar lo que hizo una tarea en su worktree y fusionarlo (o descartarlo).
async function worktreeMenu(t, anchor) {
  closePopover();
  const r = await ab.worktreeInfo(t.workdir, t.branch);
  const pop = document.createElement('div');
  pop.className = 'popover edit wt';
  if (!r.ok) {
    pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`;
    openPopover(pop, anchor, 300);
    return;
  }
  const v = r.value;
  const nothing = !v.commits && !v.uncommitted;
  pop.innerHTML = `
    <label>Rama <code>${esc(v.branch)}</code> → <code>${esc(v.base)}</code></label>
    <div class="hint">${v.commits} commit${v.commits === 1 ? '' : 's'}${v.uncommitted ? ` · ${v.uncommitted} archivo${v.uncommitted === 1 ? '' : 's'} sin commit (se commitean al fusionar)` : ''}</div>
    <pre class="stat">${esc(v.stat || 'Sin cambios.')}</pre>
    <div class="row">
      <button data-x="open">Abrir carpeta</button>
      <button data-x="discard" title="Borra el worktree y su rama">Descartar</button>
      <button data-x="merge" class="primary" ${nothing ? 'disabled' : ''}>Fusionar en ${esc(v.base)}</button>
    </div>`;
  openPopover(pop, anchor, 420);
  pop.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'open') ab.openPath(t.workdir);
    if (x === 'discard') {
      if (!confirm(`¿Descartar el trabajo de "${t.text.slice(0, 60)}"? Se borra el worktree y la rama ${v.branch}.`)) return;
      const d = await ab.worktreeDiscard(t.workdir, t.branch);
      closePopover();
      if (!d.ok) return toast(esc(d.error), 6000);
      t.workdir = null; t.branch = null; save(); renderTasks();
      toast('Worktree descartado.');
    }
    if (x === 'merge') {
      const m = await ab.worktreeMerge(t.workdir, t.branch, `${t.text.slice(0, 120)}\n\nTarea de AgentBoard`);
      closePopover();
      if (!m.ok) return toast(esc(m.error), 8000);
      const c = t.cardId && cardData(t.cardId);
      if (c) closeCard(c);
      t.workdir = null; t.mergedInto = m.value.base;
      if (t.status !== 'hecho') finishTask(t, 'hecho', t.summary || 'Fusionado.');
      save(); renderTasks();
      toast(`Fusionado en <b>${esc(m.value.base)}</b>`, 4000);
    }
  });
}

// Resumen en Markdown de lo hecho hoy, para pegar en una daily, un commit o un correo.
function dailySummary() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const done = tasks().filter((t) => t.status === 'hecho' && (t.finishedAt || 0) >= start.getTime());
  const open = tasks().filter((t) => t.status !== 'hecho');
  const projName = (p) => cfg.projects.find((x) => x.path === p)?.name || basename(p) || '~';
  const line = (t) => `- ${t.status === 'hecho' ? '[x]' : '[ ]'} ${t.text}${t.summary ? ` — ${t.summary}` : ''} _(${[cfg.agents[t.assigned]?.label, projName(t.cwd), t.mergedInto ? `fusionado en ${t.mergedInto}` : t.branch].filter(Boolean).join(' · ')})_`;
  const md = [`## ${start.toLocaleDateString()} — AgentBoard`, '', `### Hecho (${done.length})`, ...done.map(line),
    '', `### Pendiente (${open.length})`, ...open.map(line)].join('\n');
  ab.copy(md);
  toast(`Resumen copiado: ${done.length} hechas, ${open.length} pendientes.`);
}

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
  toast(`${n} tarea${n === 1 ? '' : 's'} en cola${cfg.taskAuto ? '' : ' — activa "Ejecutar la cola" o ejecútalas una por una'}`);
  tickTasks();
}

async function planWithAI() {
  const input = $('#taskInput');
  const text = input.value.trim();
  if (!text) return toast('Escribe tus pendientes primero; Claude (haiku) los divide en tareas.');
  const btn = $('#taskPlan');
  btn.disabled = true; btn.textContent = 'Dividiendo…';
  const r = await ab.planTasks(text, { agents: subscriptions().map(([k]) => k), projects: cfg.projects.map((p) => p.name) });
  btn.disabled = false; btn.textContent = 'Dividir';
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
  $('#taskSummary').onclick = dailySummary;
}
