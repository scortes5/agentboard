// AgentBoard — Automatizaciones: diagramas de nodos (estilo n8n) que la IA ayuda a
// diseñar y que se ejecutan con tus agentes. Cada nodo "Agente" se vuelve una tarea de
// la cola (sesión nueva, con un resumen corto de los pasos anteriores = pocos tokens);
// las ramas independientes corren en paralelo.
'use strict';
/* global ab, cfg, $, esc, uid, basename, clamp, toast, save, addTask, taskById, subscriptions, agentKeyFrom, projectFrom,
   openTasks, tickTasks, diagramOpen, toggleDiagram, cardData, focusCardView, focusCard */

const NODE_TYPES = {
  trigger:   { icon: 'bolt', label: 'Disparador', color: '#ffd60a', hint: 'Cuándo empieza: a mano, cada N minutos o a una hora.' },
  agent:     { icon: 'agent', label: 'Agente', color: '#0a84ff', hint: 'Un agente hace un trabajo (se vuelve una tarea de la cola).' },
  command:   { icon: 'terminal', label: 'Comando', color: '#64d2ff', hint: 'Un comando de shell en el proyecto (tests, build, scripts).' },
  condition: { icon: 'decision', label: 'Decisión', color: '#ff9f0a', hint: 'La IA responde SÍ o NO sobre lo anterior y el flujo sigue por esa rama.' },
  notify:    { icon: 'bell', label: 'Aviso', color: '#30d158', hint: 'Te avisa con una notificación.' },
  note:      { icon: 'idea', label: 'Concepto', color: '#8e8e93', hint: 'Una idea o nota en el diagrama; no se ejecuta.' },
};
const NODE_W = 220;

let flowSel = null;          // id del flujo abierto
let nodeSel = null;          // id del nodo seleccionado
let edgeSel = null;          // índice de la conexión seleccionada
let flowPlan = {};           // flowId -> texto de "Cómo ejecutarla"
const activeRuns = new Map(); // flowId -> run

const flows = () => cfg.flows || (cfg.flows = []);
const curFlow = () => flows().find((f) => f.id === flowSel);
const flowsOpen = () => !$('#flows').classList.contains('hidden');

function newFlow(name = 'Nueva automatización') {
  const f = {
    id: uid(), name, enabled: true, createdAt: Date.now(),
    nodes: [{ id: uid(), type: 'trigger', title: 'Inicio', x: 60, y: 120, config: { mode: 'manual', every: 60, at: '09:00' } }],
    edges: [],
  };
  flows().push(f); save();
  return f;
}

function nodeSummary(n) {
  const c = n.config || {};
  if (n.type === 'trigger') return c.mode === 'every' ? `cada ${c.every || 60} min` : c.mode === 'daily' ? `todos los días ${c.at || '09:00'}` : 'a mano (botón Ejecutar)';
  if (n.type === 'agent') {
    const a = c.agent && c.agent !== 'auto' ? cfg.agents[c.agent]?.label : 'auto';
    return `${a}${c.mode && c.mode !== 'normal' ? ' · ' + c.mode : ''} — ${(c.prompt || 'sin instrucción').slice(0, 70)}`;
  }
  if (n.type === 'command') return c.cmd ? `$ ${c.cmd.slice(0, 60)}` : 'sin comando';
  if (n.type === 'condition') return c.question ? `¿${c.question.replace(/^¿|\?$/g, '').slice(0, 60)}?` : 'sin pregunta';
  if (n.type === 'notify') return c.message || 'Aviso';
  return (c.text || '').slice(0, 90);
}

// ---------- Dibujo ----------
function renderFlowList() {
  $('#flList').innerHTML = flows().map((f) => {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((n) => n.type === 'trigger');
    const sched = trig && trig.config?.mode !== 'manual' && f.enabled !== false;
    return `<button type="button" class="fl-item ${f.id === flowSel ? 'active' : ''}" data-flow="${esc(f.id)}" title="Abrir ${esc(f.name)}${f.lastRun ? ` · última ejecución ${new Date(f.lastRun.at).toLocaleString()}` : ''}">
      <span class="fl-dot ${run ? 'running' : f.lastRun ? (f.lastRun.ok ? 'ok' : 'fail') : ''}"></span>
      <span class="fl-item-name">${esc(f.name)}</span>${sched ? `<span class="fl-sched" title="Programada: corre sola según su disparador">${icon('clock', 13)}</span>` : ''}</button>`;
  }).join('') || '<div class="side-empty">Aún no hay automatizaciones. Crea una en blanco o describe lo que quieres y usa Diseñar con IA.</div>';
}

function renderFlow() {
  renderFlowList();
  const f = curFlow();
  $('#flEmpty').classList.toggle('hidden', !!f);
  $('#flMain').classList.toggle('hidden', !f);
  if (!f) { renderInspector(); return; }
  if (document.activeElement !== $('#flName')) $('#flName').value = f.name;
  const run = activeRuns.get(f.id);
  $('#flRun').innerHTML = run ? `${icon('stop', 13)} Detener` : `${icon('play', 13)} Ejecutar`;
  $('#flRun').title = run ? 'Detener la ejecución: las tareas en cola se cancelan; las que ya corren quedan para que las revises' : 'Ejecutar ahora; las ramas independientes corren en paralelo';
  $('#flRun').classList.toggle('primary', !run);
  const box = $('#flNodes');
  box.innerHTML = f.nodes.map((n) => {
    const T = NODE_TYPES[n.type];
    const st = run?.status[n.id] || '';
    const ports = n.type === 'note' ? ''
      : `${n.type !== 'trigger' ? '<span class="port in" data-port="in"></span>' : ''}
         ${n.type === 'condition'
           ? '<span class="port out yes" data-port="out" data-branch="si" title="Sí"></span><span class="port out no" data-port="out" data-branch="no" title="No"></span>'
           : '<span class="port out" data-port="out" title="Arrastra para conectar"></span>'}`;
    return `<div class="fl-node t-${n.type} ${n.id === nodeSel ? 'sel' : ''} st-${st}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--ncolor:${T.color}">
      <div class="fl-node-head"><span class="fl-icon">${icon(T.icon, 13)}</span><span class="fl-type">${T.label}</span>${st ? `<span class="fl-st st-${st}">${{ running: 'En curso', ok: 'Listo', fail: 'Error', skip: 'Saltado', wait: 'Espera' }[st] || ''}</span>` : ''}</div>
      <div class="fl-node-title">${esc(n.title || T.label)}</div>
      <div class="fl-node-sum">${esc(nodeSummary(n))}</div>
      ${run?.results[n.id]?.text ? `<div class="fl-node-res">${esc(run.results[n.id].text.slice(0, 120))}</div>` : ''}
      ${ports}
    </div>`;
  }).join('');
  const maxX = Math.max(1600, ...f.nodes.map((n) => n.x + NODE_W + 200));
  const maxY = Math.max(900, ...f.nodes.map((n) => n.y + 260));
  box.style.width = maxX + 'px'; box.style.height = maxY + 'px';
  drawFlowEdges();
  renderInspector();
}

function portPos(nodeId, kind, branch) {
  const el = $(`#flNodes [data-node="${CSS.escape(nodeId)}"]`);
  if (!el) return null;
  const n = curFlow().nodes.find((x) => x.id === nodeId);
  const h = el.offsetHeight;
  if (kind === 'in') return { x: n.x, y: n.y + h / 2 };
  const y = n.type === 'condition' ? n.y + h * (branch === 'no' ? 0.72 : 0.38) : n.y + h / 2;
  return { x: n.x + NODE_W, y };
}

function curve(a, b) {
  const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
  return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
}

function drawFlowEdges(temp) {
  const f = curFlow();
  const svg = $('#flEdges');
  const box = $('#flNodes');
  svg.setAttribute('width', box.offsetWidth); svg.setAttribute('height', box.offsetHeight);
  const run = activeRuns.get(f.id);
  const parts = f.edges.map((e, i) => {
    const a = portPos(e.from, 'out', e.branch), b = portPos(e.to, 'in');
    if (!a || !b) return '';
    const live = run && run.edge?.[i] === 'active';
    const label = e.branch ? `<text x="${a.x + 14}" y="${a.y - 6}" class="fl-branch">${e.branch === 'no' ? 'No' : 'Sí'}</text>` : '';
    return `<path d="${curve(a, b)}" class="fl-edge-hit" data-edge="${i}"/><path d="${curve(a, b)}" class="fl-edge ${i === edgeSel ? 'sel' : ''} ${live ? 'live' : ''} ${run?.edge?.[i] === 'dead' ? 'dead' : ''}" marker-end="url(#flArrow)"/>${label}`;
  });
  if (temp) parts.push(`<path d="${curve(temp.a, temp.b)}" class="fl-edge temp"/>`);
  svg.innerHTML = `<defs><marker id="flArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="fl-arrow"/></marker></defs>${parts.join('')}`;
}

// ---------- Inspector ----------
const projectOptions = (sel) => `<option value="">Proyecto actual</option>` + cfg.projects.map((p) => `<option value="${esc(p.path)}" ${p.path === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function renderInspector() {
  const box = $('#flInspector');
  const f = curFlow();
  if (!f) { box.innerHTML = ''; return; }
  const n = f.nodes.find((x) => x.id === nodeSel);
  if (edgeSel != null && f.edges[edgeSel]) {
    const e = f.edges[edgeSel];
    const a = f.nodes.find((x) => x.id === e.from), b = f.nodes.find((x) => x.id === e.to);
    box.innerHTML = `<h3>Conexión</h3><p class="set-note">${esc(a?.title || '')} → ${esc(b?.title || '')}${e.branch ? ` (rama ${e.branch === 'no' ? 'No' : 'Sí'})` : ''}</p>
      <button type="button" data-x="del-edge">Quitar conexión</button>`;
    return;
  }
  if (!n) {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((x) => x.type === 'trigger');
    const last = f.lastRun;
    box.innerHTML = `<h3>Automatización</h3>
      <label class="set-row check"><span>Activa (respeta su horario)</span><input type="checkbox" class="switch-input" data-f="enabled" ${f.enabled !== false ? 'checked' : ''}/></label>
      <p class="set-note">${trig ? `Empieza ${esc(nodeSummary(trig))}.` : 'Agrega un Disparador para indicar cuándo empieza.'}
        ${last ? `<br/>Última ejecución: ${new Date(last.at).toLocaleString()} — ${last.ok ? 'sin errores' : 'con errores'}.` : ''}</p>
      ${run ? `<h3>En curso</h3><ol class="fl-log">${run.log.slice(-12).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : last?.log ? `<h3>Registro</h3><ol class="fl-log">${last.log.slice(-12).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
      ${flowPlan[f.id] ? `<h3>Cómo se ejecuta (análisis de la IA)</h3><div class="fl-plan">${mdLite(flowPlan[f.id])}</div>` : `<p class="set-note">Selecciona un nodo para editarlo. Arrastra desde el punto de la derecha de un nodo hasta otro para conectarlos. <kbd>⌫</kbd> borra lo seleccionado.</p>`}
      <div class="row-end"><button type="button" data-x="dup-flow">Duplicar</button><button type="button" data-x="del-flow">Borrar automatización</button></div>`;
    return;
  }
  const T = NODE_TYPES[n.type];
  const c = n.config || (n.config = {});
  const field = (k, label, html) => `<label class="fl-field"><span>${label}</span>${html}</label>`;
  let body = field('title', 'Nombre', `<input data-k="title" value="${esc(n.title || '')}"/>`);
  if (n.type === 'trigger') {
    body += field('mode', 'Cuándo', `<select data-c="mode">${[['manual', 'A mano'], ['every', 'Cada N minutos'], ['daily', 'Todos los días a una hora']].map(([v, l]) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    if (c.mode === 'every') body += field('every', 'Minutos', `<input type="number" min="5" data-c="every" value="${esc(c.every || 60)}"/>`);
    if (c.mode === 'daily') body += field('at', 'Hora', `<input type="time" data-c="at" value="${esc(c.at || '09:00')}"/>`);
    body += `<p class="set-note">Las automatizaciones programadas corren mientras AgentBoard esté abierto (también en segundo plano).</p>`;
  } else if (n.type === 'agent') {
    body += field('prompt', 'Instrucción para el agente', `<textarea data-c="prompt" rows="6" placeholder="Qué debe hacer, en qué archivos y cómo saber que terminó">${esc(c.prompt || '')}</textarea>`);
    body += field('agent', 'Suscripción', `<select data-c="agent"><option value="auto">Auto (la con menos carga)</option>${subscriptions().map(([k, a]) => `<option value="${esc(k)}" ${c.agent === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`);
    body += field('mode', 'Modelo', `<select data-c="mode">${[['normal', 'Normal'], ['ligero', 'Ligero (más barato)'], ['potente', 'Potente']].map(([v, l]) => `<option value="${v}" ${(c.mode || 'normal') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    body += field('project', 'Proyecto', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += field('group', 'Grupo del tablero (opcional)', `<input data-c="group" value="${esc(c.group || '')}" placeholder="ej. backend"/>`);
    body += `<p class="set-note">Recibe un resumen de una línea de cada paso anterior, no todo su historial.</p>`;
  } else if (n.type === 'command') {
    body += field('cmd', 'Comando', `<textarea data-c="cmd" rows="3" class="mono" placeholder="npm test">${esc(c.cmd || '')}</textarea>`);
    body += field('project', 'Carpeta', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += `<p class="set-note">Si termina con error, los pasos siguientes no corren.</p>`;
  } else if (n.type === 'condition') {
    body += field('question', 'Pregunta de sí o no', `<textarea data-c="question" rows="3" placeholder="¿Pasaron todos los tests?">${esc(c.question || '')}</textarea>`);
    body += `<p class="set-note">Claude (haiku) lee el resultado de los pasos anteriores y responde SÍ o NO. Conecta el punto verde (Sí) y el rojo (No).</p>`;
  } else if (n.type === 'notify') {
    body += field('message', 'Mensaje', `<input data-c="message" value="${esc(c.message || '')}" placeholder="Listo el deploy"/>`);
  } else {
    body += field('text', 'Idea', `<textarea data-c="text" rows="6">${esc(c.text || '')}</textarea>`);
    body += `<p class="set-note">Úsalo para pensar el flujo. "Diseñar con IA" puede convertir tus conceptos en pasos ejecutables.</p>`;
  }
  const res = activeRuns.get(f.id)?.results[n.id] || f.lastRun?.results?.[n.id];
  box.innerHTML = `<h3><span style="color:${T.color}">${icon(T.icon, 14)}</span> ${T.label}</h3><p class="set-note">${T.hint}</p>${body}
    ${res ? `<h3>Último resultado</h3><div class="fl-plan">${esc(res.text || '')}</div>` : ''}
    <div class="row-end"><button type="button" data-x="del-node">Borrar nodo</button></div>`;
}

// Markdown mínimo y seguro para el texto de la IA
function mdLite(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br/>');
}

// ---------- Edición ----------
function addNode(type) {
  const f = curFlow();
  if (!f) return;
  const canvas = $('#flCanvas');
  const n = {
    id: uid(), type, title: NODE_TYPES[type].label,
    x: canvas.scrollLeft + 120 + (f.nodes.length % 4) * 40, y: canvas.scrollTop + 100 + (f.nodes.length % 5) * 60,
    config: type === 'trigger' ? { mode: 'manual', every: 60, at: '09:00' } : type === 'agent' ? { agent: 'auto', mode: 'normal' } : {},
  };
  // si hay un nodo seleccionado, lo conecta y lo pone a su derecha
  const prev = f.nodes.find((x) => x.id === nodeSel);
  if (prev && prev.type !== 'note' && type !== 'trigger' && type !== 'note') {
    n.x = prev.x + NODE_W + 80; n.y = prev.y;
    f.edges.push({ from: prev.id, to: n.id, ...(prev.type === 'condition' ? { branch: 'si' } : {}) });
  }
  f.nodes.push(n);
  nodeSel = n.id; edgeSel = null;
  save(); renderFlow();
}

function deleteSelection() {
  const f = curFlow();
  if (!f) return;
  if (edgeSel != null) { f.edges.splice(edgeSel, 1); edgeSel = null; }
  else if (nodeSel) {
    f.nodes = f.nodes.filter((n) => n.id !== nodeSel);
    f.edges = f.edges.filter((e) => e.from !== nodeSel && e.to !== nodeSel);
    nodeSel = null;
  } else return;
  save(); renderFlow();
}

function wireFlowCanvas() {
  const box = $('#flNodes');
  box.addEventListener('pointerdown', (e) => {
    const nodeEl = e.target.closest('.fl-node');
    const port = e.target.closest('[data-port="out"]');
    if (!nodeEl) { if (e.target === box || e.target.closest('#flEdges') === null) { nodeSel = null; edgeSel = null; renderFlow(); } return; }
    const f = curFlow();
    const n = f.nodes.find((x) => x.id === nodeEl.dataset.node);
    e.preventDefault();
    const origin = box.getBoundingClientRect();
    if (port) {
      // arrastrar una conexión nueva
      const branch = port.dataset.branch;
      const a = portPos(n.id, 'out', branch);
      const move = (ev) => drawFlowEdges({ a, b: { x: ev.clientX - origin.left, y: ev.clientY - origin.top } });
      const up = (ev) => {
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fl-node');
        const to = target && f.nodes.find((x) => x.id === target.dataset.node);
        if (to && to.id !== n.id && to.type !== 'trigger' && to.type !== 'note'
          && !f.edges.some((x) => x.from === n.id && x.to === to.id && (x.branch || '') === (branch || ''))) {
          f.edges.push({ from: n.id, to: to.id, ...(branch ? { branch } : {}) });
          save();
        }
        renderFlow();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      return;
    }
    nodeSel = n.id; edgeSel = null;
    const start = { x: e.clientX, y: e.clientY, nx: n.x, ny: n.y };
    let moved = false;
    const move = (ev) => {
      moved = true;
      n.x = Math.max(0, Math.round((start.nx + ev.clientX - start.x) / 10) * 10);
      n.y = Math.max(0, Math.round((start.ny + ev.clientY - start.y) / 10) * 10);
      nodeEl.style.left = n.x + 'px'; nodeEl.style.top = n.y + 'px';
      drawFlowEdges();
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (moved) save();
      renderFlow();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
  $('#flEdges').addEventListener('pointerdown', (e) => {
    const i = e.target.closest('[data-edge]')?.dataset.edge;
    if (i == null) return;
    e.stopPropagation(); edgeSel = +i; nodeSel = null; renderFlow();
  });
  $('#flInspector').addEventListener('input', (e) => {
    const f = curFlow(); const n = f?.nodes.find((x) => x.id === nodeSel);
    if (e.target.dataset.f === 'enabled') { f.enabled = e.target.checked; save(); renderFlowList(); return; }
    if (!n) return;
    if (e.target.dataset.k) n[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.c) n.config[e.target.dataset.c] = e.target.type === 'number' ? +e.target.value : e.target.value;
    save();
    const el = $(`#flNodes [data-node="${CSS.escape(n.id)}"]`);
    if (el) { $('.fl-node-title', el).textContent = n.title || NODE_TYPES[n.type].label; $('.fl-node-sum', el).textContent = nodeSummary(n); }
    if (e.target.tagName === 'SELECT') renderInspector();
  });
  $('#flInspector').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    const f = curFlow();
    if (x === 'del-node' || x === 'del-edge') deleteSelection();
    if (x === 'del-flow' && confirm(`¿Borrar "${f.name}"?`)) { cfg.flows = flows().filter((q) => q !== f); flowSel = flows()[0]?.id || null; save(); renderFlow(); }
    if (x === 'dup-flow') {
      const copy = JSON.parse(JSON.stringify(f));
      const ids = new Map(copy.nodes.map((n) => [n.id, uid()]));
      copy.nodes.forEach((n) => { n.id = ids.get(n.id); });
      copy.edges.forEach((ed) => { ed.from = ids.get(ed.from); ed.to = ids.get(ed.to); });
      Object.assign(copy, { id: uid(), name: `${f.name} (copia)`, lastRun: null });
      flows().push(copy); flowSel = copy.id; save(); renderFlow();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!flowsOpen() || document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
    if (e.key === 'Escape') toggleFlows(false);
  });
}

// ---------- Ejecución ----------
function contextFor(f, run, nodeId) {
  // resúmenes de una línea de los pasos ya hechos que llevan a este nodo
  const seen = new Set();
  const lines = [];
  const walk = (id) => {
    for (const e of f.edges.filter((x) => x.to === id)) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      walk(e.from);
      const n = f.nodes.find((x) => x.id === e.from);
      const r = run.results[e.from];
      if (n && r && n.type !== 'trigger') lines.push(`- ${n.title || NODE_TYPES[n.type].label}: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 300)}`);
    }
  };
  walk(nodeId);
  return lines.join('\n');
}

function waitForTask(id, run) {
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const t = taskById(id);
      if (run.stopped) { clearInterval(iv); return resolve({ ok: false, text: 'Detenida.' }); }
      if (!t) { clearInterval(iv); return resolve({ ok: false, text: 'La tarea se borró.' }); }
      if (t.status === 'hecho' || t.status === 'bloqueado') { clearInterval(iv); resolve({ ok: t.status === 'hecho', text: t.summary || t.status }); }
      run.status[run.taskNode[id]] = t.status === 'revisar' ? 'wait' : 'running';
    }, 1000);
  });
}

async function execNode(f, run, n) {
  const c = n.config || {};
  const ctx = contextFor(f, run, n.id);
  if (n.type === 'trigger') return { ok: true, text: run.reason };
  if (n.type === 'notify') {
    const msg = c.message || n.title || 'Automatización';
    try { new Notification(f.name, { body: msg }); } catch {}
    toast(`${esc(f.name)}: ${esc(msg)}`, 5000);
    return { ok: true, text: msg };
  }
  if (n.type === 'command') {
    if (!c.cmd) return { ok: false, text: 'Sin comando.' };
    const r = await ab.flowExec(c.cmd, c.project || cfg.selectedProject);
    if (!r.ok) return { ok: false, text: r.error };
    const tail = r.value.out.split('\n').slice(-6).join('\n');
    return { ok: r.value.code === 0, text: `${r.value.code === 0 ? 'OK' : `código ${r.value.code}`}\n${tail}` };
  }
  if (n.type === 'condition') {
    const r = await ab.aiAsk(`Responde solo "SI" o "NO", sin nada más.\nPregunta: ${c.question || n.title}\nResultados de los pasos anteriores:\n${ctx || '(ninguno)'}`, 'haiku');
    if (!r.ok) return { ok: false, text: r.error };
    const yes = /^\W*s[ií]\b/i.test(r.value);
    return { ok: true, branch: yes ? 'si' : 'no', text: yes ? 'Sí' : 'No' };
  }
  if (n.type === 'agent') {
    if (!c.prompt) return { ok: false, text: 'Sin instrucción.' };
    const text = `${c.prompt}${ctx ? `\n\nContexto (pasos anteriores de "${f.name}"):\n${ctx}` : ''}`;
    const t = addTask({
      text, agent: c.agent || 'auto', cwd: c.project || cfg.selectedProject, group: c.group || '',
      light: c.mode === 'ligero', heavy: c.mode === 'potente',
    });
    t.flowRun = run.id;
    run.taskNode[t.id] = n.id;
    save(); tickTasks();
    return waitForTask(t.id, run);
  }
  return { ok: true, text: '' };
}

async function runFlow(f, reason = 'a mano') {
  if (activeRuns.has(f.id)) return;
  const nodes = f.nodes.filter((n) => n.type !== 'note');
  const edges = f.edges.map((e, i) => ({ ...e, i })).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const run = { id: uid(), reason, status: {}, results: {}, edge: {}, log: [], taskNode: {}, startedAt: Date.now() };
  activeRuns.set(f.id, run);
  const log = (m) => { run.log.push(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${m}`); if (flowsOpen() && flowSel === f.id) renderFlow(); else renderFlowList(); };
  log(`Inicio (${reason})`);
  let failed = false;

  const finished = new Set();
  const incoming = (id) => edges.filter((e) => e.to === id);
  const pending = [];

  const settle = async (n, res) => {
    run.results[n.id] = res;
    run.status[n.id] = res.skip ? 'skip' : res.ok ? 'ok' : 'fail';
    finished.add(n.id);
    if (!res.ok && !res.skip) { failed = true; log(`Error en ${n.title}: ${res.text.split('\n')[0]}`); }
    else if (!res.skip) log(`Listo: ${n.title}${res.branch ? ` (${res.text})` : ''}`);
    for (const e of edges.filter((x) => x.from === n.id)) {
      const active = !res.skip && res.ok && (!res.branch || (e.branch || 'si') === res.branch);
      run.edge[e.i] = active ? 'active' : 'dead';
    }
    // los nodos cuyas entradas ya están todas resueltas pueden correr (o se saltan si ninguna llegó activa)
    for (const e of edges.filter((x) => x.from === n.id)) {
      const target = nodes.find((x) => x.id === e.to);
      if (finished.has(target.id) || run.status[target.id]) continue;
      const ins = incoming(target.id);
      if (ins.some((x) => run.edge[x.i] == null)) continue;
      if (ins.some((x) => run.edge[x.i] === 'active')) pending.push(start(target));
      else pending.push(settle(target, { ok: false, skip: true, text: 'Saltado' }));
    }
  };
  const start = async (n) => {
    if (run.stopped) return settle(n, { ok: false, skip: true, text: 'Detenida' });
    run.status[n.id] = 'running';
    log(`Empieza: ${n.title}`);
    let res;
    try { res = await execNode(f, run, n); } catch (err) { res = { ok: false, text: err.message }; }
    return settle(n, res);
  };

  const roots = nodes.filter((n) => !incoming(n.id).length);
  if (!roots.length) { log('No hay un nodo inicial.'); }
  pending.push(...roots.map(start));
  // esperar hasta que no quede nada corriendo
  while (pending.length) await pending.shift();

  f.lastRun = { at: Date.now(), ok: !failed && !run.stopped, results: run.results, log: run.log.slice(-30) };
  log(run.stopped ? 'Detenida.' : failed ? 'Terminó con errores.' : 'Terminó bien.');
  activeRuns.delete(f.id);
  save();
  if (!document.hasFocus()) { try { new Notification(`${f.name}: ${failed ? 'con errores' : 'lista'}`, { body: run.log.slice(-1)[0] || '' }); } catch {} }
  toast(`Automatización "${esc(f.name)}" ${failed ? 'terminó con errores' : 'terminó'}`, 4500);
  if (flowsOpen()) renderFlow(); else renderFlowList();
}

function stopFlow(f) {
  const run = activeRuns.get(f.id);
  if (!run) return;
  run.stopped = true;
  // las tareas aún en cola se borran; las que corren se dejan para que las revises
  cfg.tasks = (cfg.tasks || []).filter((t) => !(t.flowRun === run.id && t.status === 'pendiente'));
  save();
}

// Horarios: cada 30 s revisa qué automatizaciones toca correr.
function checkSchedules() {
  const now = new Date();
  for (const f of flows()) {
    if (f.enabled === false || activeRuns.has(f.id)) continue;
    const trig = f.nodes.find((n) => n.type === 'trigger');
    const c = trig?.config;
    if (!c || c.mode === 'manual') continue;
    const last = f.lastScheduled || 0;
    if (c.mode === 'every') {
      const every = Math.max(5, +c.every || 60) * 60_000;
      if (!last) { f.lastScheduled = Date.now(); save(); continue; } // empieza a contar desde ahora
      if (Date.now() - last >= every) { f.lastScheduled = Date.now(); save(); runFlow(f, `cada ${c.every} min`); }
    } else if (c.mode === 'daily') {
      const [h, m] = String(c.at || '09:00').split(':').map(Number);
      const due = new Date(now); due.setHours(h, m || 0, 0, 0);
      if (now >= due && last < due.getTime()) { f.lastScheduled = Date.now(); save(); runFlow(f, `diaria ${c.at}`); }
    }
  }
}

// ---------- IA: diseñar y explicar ----------
// Electron no tiene window.prompt: un diálogo propio que devuelve el texto (o null).
function askText(title, hint, placeholder = '') {
  return new Promise((resolve) => {
    const dlg = $('#askDialog');
    $('#askTitle').textContent = title; $('#askHint').textContent = hint;
    const ta = $('#askText'); ta.value = ''; ta.placeholder = placeholder;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok' && ta.value.trim() ? ta.value.trim() : null), { once: true });
    dlg.showModal(); ta.focus();
    ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dlg.close('ok'); } };
  });
}
function layoutNodes(nodes, edges) {
  const depth = {};
  const ins = (id) => edges.filter((e) => e.to === id);
  const visit = (id, d, guard = 0) => {
    if (guard > 50) return;
    if (depth[id] != null && depth[id] >= d) return;
    depth[id] = d;
    for (const e of edges.filter((x) => x.from === id)) visit(e.to, d + 1, guard + 1);
  };
  nodes.filter((n) => !ins(n.id).length).forEach((n) => visit(n.id, 0));
  // columnas por profundidad; cada 3 columnas el flujo baja a una nueva fila (como texto)
  const COLS = 3;
  const perDepth = {};
  for (const n of nodes) { const d = depth[n.id] ?? 0; perDepth[d] = (perDepth[d] || 0) + 1; }
  const bandH = {};
  for (const [d, k] of Object.entries(perDepth)) { const b = Math.floor(d / COLS); bandH[b] = Math.max(bandH[b] || 0, k); }
  const bandY = (b) => { let y = 60; for (let i = 0; i < b; i++) y += (bandH[i] || 1) * 170 + 70; return y; };
  const rows = {};
  for (const n of nodes) {
    const d = depth[n.id] ?? 0;
    rows[d] = (rows[d] || 0) + 1;
    n.x = 60 + (d % COLS) * (NODE_W + 80);
    n.y = bandY(Math.floor(d / COLS)) + (rows[d] - 1) * 170;
  }
}

async function designWithAI() {
  const f = curFlow();
  const current = f && f.nodes.length > 1 ? JSON.stringify({ name: f.name, nodes: f.nodes.map(({ id, type, title, config }) => ({ id, type, title, config })), edges: f.edges }) : '';
  const desc = await askText(current ? 'Cambiar esta automatización' : 'Diseñar una automatización',
    current ? 'Describe qué cambiar o agregar. La IA rediseña el diagrama (si quieres conservar la versión actual, usa "Duplicar" antes).'
      : 'Describe lo que quieres que pase, en tus palabras. Ej.: "cada mañana revisa los issues nuevos, que Claude proponga un plan y otro agente lo implemente; si los tests pasan, avísame".',
    current ? 'Agrega un paso que…' : 'Cada vez que…');
  if (!desc) return;
  const btn = $('#flDesign');
  btn.disabled = true; btn.lastChild.textContent = 'Diseñando…';
  const agents = ['auto', ...subscriptions().map(([k]) => k)].join(', ');
  const r = await ab.aiAsk([
    'Diseña una automatización para AgentBoard (una app que coordina agentes de código como Claude Code en terminales).',
    'Responde SOLO con JSON válido, sin texto extra, con esta forma:',
    '{"name":"…","nodes":[{"id":"n1","type":"trigger|agent|command|condition|notify|note","title":"…","config":{}}],"edges":[{"from":"n1","to":"n2","branch":"si|no"}]}',
    'config por tipo: trigger {"mode":"manual|every|daily","every":60,"at":"09:00"}; agent {"prompt":"instrucción autocontenida y concreta","agent":"auto","mode":"normal|ligero|potente"}; command {"cmd":"comando de shell"}; condition {"question":"pregunta de sí/no sobre el resultado anterior"}; notify {"message":"…"}; note {"text":"…"}.',
    '"branch" solo en conexiones que salen de un condition. Empieza con un único trigger.',
    'Usa agentes para lo que requiere pensar o editar código, comandos para pasos deterministas (tests, build, git), "ligero" en pasos simples para ahorrar tokens y "potente" solo si es difícil. Paraleliza pasos independientes. Máximo 12 nodos.',
    `Suscripciones disponibles: ${agents}. Proyectos: ${cfg.projects.map((p) => p.name).join(', ') || '(ninguno)'}.`,
    current ? `Automatización actual: ${current}` : '',
    `Pedido: ${desc}`,
  ].filter(Boolean).join('\n'), 'sonnet');
  btn.disabled = false; btn.lastChild.textContent = 'Diseñar con IA';
  if (!r.ok) return toast(`No pude diseñarla: ${esc(r.error)}`, 6000);
  let spec;
  try { spec = JSON.parse(r.value.match(/\{[\s\S]*\}/)[0]); } catch { return toast('La IA no devolvió un diagrama válido; intenta describirlo de otra forma.', 6000); }
  const ids = new Map();
  const nodes = (spec.nodes || []).filter((n) => NODE_TYPES[n.type]).slice(0, 20).map((n) => {
    const id = uid(); ids.set(n.id, id);
    const config = { ...(n.config || {}) };
    if (n.type === 'agent' && config.agent && config.agent !== 'auto') config.agent = agentKeyFrom(config.agent) || 'auto';
    if (config.project) config.project = projectFrom(config.project)?.path || '';
    return { id, type: n.type, title: String(n.title || NODE_TYPES[n.type].label).slice(0, 60), config, x: 0, y: 0 };
  });
  const edges = (spec.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: ids.get(e.from), to: ids.get(e.to), ...(e.branch === 'no' || e.branch === 'si' ? { branch: e.branch } : {}) }));
  if (!nodes.length) return toast('La IA no devolvió nodos.');
  layoutNodes(nodes, edges);
  const target = f || newFlow();
  Object.assign(target, { name: spec.name ? String(spec.name).slice(0, 80) : target.name, nodes, edges, lastRun: null });
  flowSel = target.id; nodeSel = null; edgeSel = null;
  delete flowPlan[target.id];
  save(); renderFlow();
  toast(`Automatización diseñada: ${nodes.length} pasos. Revísala y usa "Explicar ejecución" o "Ejecutar".`, 5000);
}

async function explainWithAI() {
  const f = curFlow();
  if (!f) return;
  const btn = $('#flExplain');
  btn.disabled = true; btn.lastChild.textContent = 'Analizando…';
  const r = await ab.aiAsk([
    'Eres un experto en automatización con agentes de código. Explica en español, breve (máx. 18 líneas) y concreto:',
    '1) qué hará esta automatización paso a paso cuando AgentBoard la ejecute (los nodos "agent" se vuelven tareas para Claude/Codex/Gemini en sesiones nuevas con un resumen de los pasos anteriores; "command" corre en el shell; "condition" la decide una IA con SÍ/NO);',
    '2) qué falta o puede fallar (permisos, instrucciones vagas, pasos sin conexión, comandos peligrosos);',
    '3) cómo mejorarla o ahorrar tokens (modo ligero, paralelizar, comandos en vez de agentes para lo determinista).',
    'Usa una lista numerada y **negritas** para los títulos.',
    JSON.stringify({ name: f.name, nodes: f.nodes.map(({ id, type, title, config }) => ({ id, type, title, config })), edges: f.edges }),
  ].join('\n'), 'haiku');
  btn.disabled = false; btn.lastChild.textContent = 'Explicar ejecución';
  if (!r.ok) return toast(`No pude explicarla: ${esc(r.error)}`, 6000);
  flowPlan[f.id] = r.value;
  nodeSel = null; edgeSel = null;
  renderFlow();
}

// ---------- Panel ----------
function toggleFlows(force) {
  const open = force ?? !flowsOpen();
  if (open && diagramOpen()) toggleDiagram(false);
  $('#flows').classList.toggle('hidden', !open);
  document.body.classList.toggle('flows-open', open);
  if (open) {
    if (!flowSel || !curFlow()) flowSel = flows()[0]?.id || null;
    renderFlow();
  }
}

function initFlows() {
  wireFlowCanvas();
  $('#flList').addEventListener('click', (e) => {
    const id = e.target.closest('[data-flow]')?.dataset.flow;
    if (id) { flowSel = id; nodeSel = null; edgeSel = null; renderFlow(); }
  });
  $('#flNew').onclick = () => { const f = newFlow(); flowSel = f.id; nodeSel = f.nodes[0].id; renderFlow(); $('#flName').select(); };
  $('#flEmptyNew').onclick = $('#flNew').onclick;
  $('#flEmptyAI').onclick = () => { flowSel = null; designWithAI(); };
  $('#flName').addEventListener('input', (e) => { const f = curFlow(); if (f) { f.name = e.target.value; save(); renderFlowList(); } });
  $('#flAdd').addEventListener('click', (e) => { const t = e.target.closest('[data-type]')?.dataset.type; if (t) addNode(t); });
  $('#flAdd').innerHTML = Object.entries(NODE_TYPES).map(([k, T]) => `<button type="button" data-type="${k}" title="Agregar un nodo ${T.label}: ${esc(T.hint)}"><span style="color:${T.color}">${icon(T.icon, 13)}</span> ${T.label}</button>`).join('');
  $('#flDesign').onclick = designWithAI;
  $('#flExplain').onclick = explainWithAI;
  $('#flRun').onclick = () => { const f = curFlow(); if (!f) return; if (activeRuns.has(f.id)) stopFlow(f); else runFlow(f); renderFlow(); };
  $('#flClose').onclick = () => toggleFlows(false);
  $('#flowsBtn').onclick = () => toggleFlows();
  setInterval(checkSchedules, 30_000);
  setInterval(() => { if (flowsOpen() && activeRuns.size) renderFlow(); }, 2000);
  // automatizaciones que quedaron a medias al cerrar la app: se marcan como interrumpidas
  for (const f of flows()) if (f.lastRun && f.lastRun.running) f.lastRun.running = false;
}
