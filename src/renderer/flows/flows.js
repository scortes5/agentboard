// AgentBoard — Automations: node diagrams (n8n style) that AI helps design and your
// agents run. Each "Agent" node becomes a queue task (new session, with a short summary
// of the previous steps = few tokens); independent branches run in parallel.
'use strict';
/* global ab, cfg, $, esc, uid, basename, clamp, toast, save, addTask, taskById, subscriptions, agentKeyFrom, projectFrom,
   openTasks, tickTasks, diagramOpen, toggleDiagram, cardData, focusCardView, focusCard, icon */

const NODE_TYPES = {
  trigger:   { icon: 'bolt', label: 'Trigger', color: '#ffd60a', hint: 'When it starts: by hand, every N minutes or at a time of day.' },
  agent:     { icon: 'agent', label: 'Agent', color: '#0a84ff', hint: 'An agent does a piece of work (it becomes a queue task).' },
  command:   { icon: 'terminal', label: 'Command', color: '#64d2ff', hint: 'A shell command in the project (tests, build, scripts).' },
  condition: { icon: 'decision', label: 'Decision', color: '#ff9f0a', hint: 'AI answers YES or NO about the previous steps and the flow follows that branch.' },
  notify:    { icon: 'bell', label: 'Notify', color: '#30d158', hint: 'Sends you a notification.' },
  note:      { icon: 'idea', label: 'Concept', color: '#8e8e93', hint: 'An idea or note on the diagram; it does not run.' },
};
const NODE_W = 220;
const MODES = [['normal', 'Normal'], ['light', 'Light (cheaper)'], ['heavy', 'Heavy (most capable)']];
const STEP_STATUS = { running: 'Running', ok: 'Done', fail: 'Error', skip: 'Skipped', wait: 'Waiting' };

let flowSel = null;          // id of the open flow
let nodeSel = null;          // id of the selected node
let edgeSel = null;          // index of the selected connection
let flowPlan = {};           // flowId -> "Explain Run" text
const activeRuns = new Map(); // flowId -> run

const flows = () => cfg.flows || (cfg.flows = []);
const curFlow = () => flows().find((f) => f.id === flowSel);
const flowsOpen = () => !$('#flows').classList.contains('hidden');

function newFlow(name = 'New Automation') {
  const f = {
    id: uid(), name, enabled: true, createdAt: Date.now(),
    nodes: [{ id: uid(), type: 'trigger', title: 'Start', x: 60, y: 120, config: { mode: 'manual', every: 60, at: '09:00' } }],
    edges: [],
  };
  flows().push(f); save();
  return f;
}

function nodeSummary(n) {
  const c = n.config || {};
  if (n.type === 'trigger') return c.mode === 'every' ? `every ${c.every || 60} min` : c.mode === 'daily' ? `every day at ${c.at || '09:00'}` : 'by hand (Run button)';
  if (n.type === 'agent') {
    const a = c.agent && c.agent !== 'auto' ? (cfg.agents[c.agent]?.label || 'missing agent') : 'auto';
    return `${a}${c.mode && c.mode !== 'normal' ? ' · ' + c.mode : ''} — ${(c.prompt || 'no instruction').slice(0, 70)}`;
  }
  if (n.type === 'command') return c.cmd ? `$ ${c.cmd.slice(0, 60)}` : 'no command';
  if (n.type === 'condition') return c.question ? `${c.question.replace(/\?$/, '').slice(0, 60)}?` : 'no question';
  if (n.type === 'notify') return c.message || 'Notification';
  return (c.text || '').slice(0, 90);
}

// ---------- Drawing ----------
function renderFlowList() {
  $('#flList').innerHTML = flows().map((f) => {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((n) => n.type === 'trigger');
    const sched = trig && trig.config?.mode !== 'manual' && f.enabled !== false;
    return `<button type="button" class="fl-item ${f.id === flowSel ? 'active' : ''}" data-flow="${esc(f.id)}" title="Open ${esc(f.name)}${f.lastRun ? ` · last run ${new Date(f.lastRun.at).toLocaleString()}` : ''}">
      <span class="fl-dot ${run ? 'running' : f.lastRun ? (f.lastRun.ok ? 'ok' : 'fail') : ''}"></span>
      <span class="fl-item-name">${esc(f.name)}</span>${sched ? `<span class="fl-sched" title="Scheduled: runs on its own according to its trigger">${icon('clock', 13)}</span>` : ''}</button>`;
  }).join('') || '<div class="side-empty">No automations yet. Start a blank one, or describe what you want and use Design with AI.</div>';
}

function renderFlow() {
  renderFlowList();
  const f = curFlow();
  $('#flEmpty').classList.toggle('hidden', !!f);
  $('#flMain').classList.toggle('hidden', !f);
  if (!f) { renderInspector(); return; }
  if (document.activeElement !== $('#flName')) $('#flName').value = f.name;
  const run = activeRuns.get(f.id);
  $('#flRun').innerHTML = run ? `${icon('stop', 13)} Stop` : `${icon('play', 13)} Run`;
  $('#flRun').title = run ? 'Stop the run: queued tasks are cancelled; running ones stay for you to review' : 'Run now; independent branches run in parallel';
  $('#flRun').classList.toggle('primary', !run);
  const box = $('#flNodes');
  box.innerHTML = f.nodes.map((n) => {
    const T = NODE_TYPES[n.type];
    const st = run?.status[n.id] || '';
    const ports = n.type === 'note' ? ''
      : `${n.type !== 'trigger' ? '<span class="port in" data-port="in"></span>' : ''}
         ${n.type === 'condition'
           ? '<span class="port out yes" data-port="out" data-branch="yes" title="Yes: drag to connect"></span><span class="port out no" data-port="out" data-branch="no" title="No: drag to connect"></span>'
           : '<span class="port out" data-port="out" title="Drag to connect"></span>'}`;
    return `<div class="fl-node t-${n.type} ${n.id === nodeSel ? 'sel' : ''} st-${st}" data-node="${esc(n.id)}" style="left:${n.x}px;top:${n.y}px;--ncolor:${T.color}">
      <div class="fl-node-head"><span class="fl-icon">${icon(T.icon, 13)}</span><span class="fl-type">${T.label}</span>${st ? `<span class="fl-st st-${st}">${STEP_STATUS[st] || ''}</span>` : ''}</div>
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
  if (b.x < a.x + 40) {
    // the target is to the left (the flow wrapped to a new row): leave right, go down, enter left
    const r = 12, out = a.x + 28, inn = b.x - 28;
    const mid = b.y > a.y ? Math.max(a.y + 40, b.y - 70) : Math.min(a.y - 40, b.y + 70);
    const s1 = Math.sign(mid - a.y) || 1, s2 = Math.sign(b.y - mid) || 1;
    return `M${a.x} ${a.y} H${out - r} Q${out} ${a.y} ${out} ${a.y + s1 * r} V${mid - s1 * r} Q${out} ${mid} ${out - r} ${mid}`
      + ` H${inn + r} Q${inn} ${mid} ${inn} ${mid + s2 * r} V${b.y - s2 * r} Q${inn} ${b.y} ${inn + r} ${b.y} H${b.x}`;
  }
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
    const label = e.branch ? `<text x="${a.x + 14}" y="${a.y - 6}" class="fl-branch">${e.branch === 'no' ? 'No' : 'Yes'}</text>` : '';
    return `<path d="${curve(a, b)}" class="fl-edge-hit" data-edge="${i}"/><path d="${curve(a, b)}" class="fl-edge ${i === edgeSel ? 'sel' : ''} ${live ? 'live' : ''} ${run?.edge?.[i] === 'dead' ? 'dead' : ''}" marker-end="url(#flArrow)"/>${label}`;
  });
  if (temp) parts.push(`<path d="${curve(temp.a, temp.b)}" class="fl-edge temp"/>`);
  svg.innerHTML = `<defs><marker id="flArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="fl-arrow"/></marker></defs>${parts.join('')}`;
}

// ---------- Inspector ----------
const projectOptions = (sel) => `<option value="">Current project</option>` + cfg.projects.map((p) => `<option value="${esc(p.path)}" ${p.path === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function renderInspector() {
  const box = $('#flInspector');
  const f = curFlow();
  if (!f) { box.innerHTML = ''; return; }
  const n = f.nodes.find((x) => x.id === nodeSel);
  if (edgeSel != null && f.edges[edgeSel]) {
    const e = f.edges[edgeSel];
    const a = f.nodes.find((x) => x.id === e.from), b = f.nodes.find((x) => x.id === e.to);
    box.innerHTML = `<h3>Connection</h3><p class="set-note">${esc(a?.title || '')} → ${esc(b?.title || '')}${e.branch ? ` (${e.branch === 'no' ? 'No' : 'Yes'} branch)` : ''}</p>
      <button type="button" data-x="del-edge" title="Delete this connection (⌫)">Remove Connection</button>`;
    return;
  }
  if (!n) {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((x) => x.type === 'trigger');
    const last = f.lastRun;
    box.innerHTML = `<h3>Automation</h3>
      <label class="set-row check" title="When off, the schedule is ignored; you can still run it by hand"><span>Enabled (follows its schedule)</span><input type="checkbox" class="switch-input" data-f="enabled" ${f.enabled !== false ? 'checked' : ''}/></label>
      <p class="set-note">${trig ? `Starts ${esc(nodeSummary(trig))}.` : 'Add a Trigger to say when it starts.'}
        ${last ? `<br/>Last run: ${new Date(last.at).toLocaleString()} — ${last.ok ? 'no errors' : 'with errors'}.` : ''}</p>
      ${run ? `<h3>Running</h3><ol class="fl-log">${run.log.slice(-12).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : last?.log ? `<h3>Log</h3><ol class="fl-log">${last.log.slice(-12).map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
      ${flowPlan[f.id] ? `<h3>How it runs (AI analysis)</h3><div class="fl-plan">${mdLite(flowPlan[f.id])}</div>` : `<p class="set-note">Select a node to edit it. Drag from the dot on the right of a node to another node to connect them. <kbd>⌫</kbd> deletes the selection.</p>`}
      <div class="row-end"><button type="button" data-x="dup-flow" title="Create a copy of this automation">Duplicate</button><button type="button" data-x="del-flow" title="Delete this automation">Delete Automation</button></div>`;
    return;
  }
  const T = NODE_TYPES[n.type];
  const c = n.config || (n.config = {});
  const field = (k, label, html) => `<label class="fl-field"><span>${label}</span>${html}</label>`;
  let body = field('title', 'Name', `<input data-k="title" value="${esc(n.title || '')}"/>`);
  if (n.type === 'trigger') {
    body += field('mode', 'When', `<select data-c="mode">${[['manual', 'By hand'], ['every', 'Every N minutes'], ['daily', 'Every day at a time']].map(([v, l]) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    if (c.mode === 'every') body += field('every', 'Minutes', `<input type="number" min="5" data-c="every" value="${esc(c.every || 60)}"/>`);
    if (c.mode === 'daily') body += field('at', 'Time', `<input type="time" data-c="at" value="${esc(c.at || '09:00')}"/>`);
    body += `<p class="set-note">Scheduled automations run while AgentBoard is open (also in the background).</p>`;
  } else if (n.type === 'agent') {
    body += field('prompt', 'Instruction for the agent', `<textarea data-c="prompt" rows="6" placeholder="What to do, in which files, and how to tell it is done">${esc(c.prompt || '')}</textarea>`);
    body += field('agent', 'Subscription', `<select data-c="agent"><option value="auto">Auto (least busy)</option>${subscriptions().map(([k, a]) => `<option value="${esc(k)}" ${c.agent === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`);
    body += field('mode', 'Model', `<select data-c="mode">${MODES.map(([v, l]) => `<option value="${v}" ${(c.mode || 'normal') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    body += field('project', 'Project', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += field('group', 'Board group (optional)', `<input data-c="group" value="${esc(c.group || '')}" placeholder="e.g. backend"/>`);
    body += `<p class="set-note">It receives a one-line summary of each previous step, not their full history.</p>`;
  } else if (n.type === 'command') {
    body += field('cmd', 'Command', `<textarea data-c="cmd" rows="3" class="mono" placeholder="npm test">${esc(c.cmd || '')}</textarea>`);
    body += field('project', 'Folder', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += field('secrets', 'Secrets it can use (optional)', `<input data-c="secrets" class="mono" value="${esc(c.secrets || '')}" placeholder="APP_USER, APP_PASSWORD"/>`);
    body += `<p class="set-note">If it exits with an error, the following steps do not run. Secrets (Settings → Secrets) arrive as environment variables, and their values are hidden in the output.</p>`;
  } else if (n.type === 'condition') {
    body += field('question', 'Yes/no question', `<textarea data-c="question" rows="3" placeholder="Did all the tests pass?">${esc(c.question || '')}</textarea>`);
    body += `<p class="set-note">Claude (haiku) reads the results of the previous steps and answers YES or NO. Connect the green dot (Yes) and the red one (No).</p>`;
  } else if (n.type === 'notify') {
    body += field('message', 'Message', `<input data-c="message" value="${esc(c.message || '')}" placeholder="Deploy finished"/>`);
  } else {
    body += field('text', 'Idea', `<textarea data-c="text" rows="6">${esc(c.text || '')}</textarea>`);
    body += `<p class="set-note">Use it to think the flow through. "Design with AI" can turn your concepts into runnable steps.</p>`;
  }
  const res = activeRuns.get(f.id)?.results[n.id] || f.lastRun?.results?.[n.id];
  box.innerHTML = `<h3><span style="color:${T.color}">${icon(T.icon, 14)}</span> ${T.label}</h3><p class="set-note">${T.hint}</p>${body}
    ${res ? `<h3>Last result</h3><div class="fl-plan">${esc(res.text || '')}</div>` : ''}
    <div class="row-end"><button type="button" data-x="del-node" title="Delete this node and its connections (⌫)">Delete Node</button></div>`;
}

// Minimal, safe Markdown for the AI's text
function mdLite(t) {
  return esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br/>');
}

// ---------- Editing ----------
function addNode(type) {
  const f = curFlow();
  if (!f) return;
  const canvas = $('#flCanvas');
  const n = {
    id: uid(), type, title: NODE_TYPES[type].label,
    x: canvas.scrollLeft + 120 + (f.nodes.length % 4) * 40, y: canvas.scrollTop + 100 + (f.nodes.length % 5) * 60,
    config: type === 'trigger' ? { mode: 'manual', every: 60, at: '09:00' } : type === 'agent' ? { agent: 'auto', mode: 'normal' } : {},
  };
  // when a node is selected, connect the new one to it and place it on its right
  const prev = f.nodes.find((x) => x.id === nodeSel);
  if (prev && prev.type !== 'note' && type !== 'trigger' && type !== 'note') {
    n.x = prev.x + NODE_W + 80; n.y = prev.y;
    f.edges.push({ from: prev.id, to: n.id, ...(prev.type === 'condition' ? { branch: 'yes' } : {}) });
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
      // drag a new connection
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
    if (x === 'del-flow' && confirm(`Delete "${f.name}"?`)) { cfg.flows = flows().filter((q) => q !== f); flowSel = flows()[0]?.id || null; save(); renderFlow(); }
    if (x === 'dup-flow') {
      const copy = JSON.parse(JSON.stringify(f));
      const ids = new Map(copy.nodes.map((n) => [n.id, uid()]));
      copy.nodes.forEach((n) => { n.id = ids.get(n.id); });
      copy.edges.forEach((ed) => { ed.from = ids.get(ed.from); ed.to = ids.get(ed.to); });
      Object.assign(copy, { id: uid(), name: `${f.name} (copy)`, lastRun: null });
      flows().push(copy); flowSel = copy.id; save(); renderFlow();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (!flowsOpen() || document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); deleteSelection(); }
    if (e.key === 'Escape') toggleFlows(false);
  });
}

// ---------- Running ----------
function contextFor(f, run, nodeId) {
  // one-line summaries of the finished steps leading to this node
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
      if (run.stopped) { clearInterval(iv); return resolve({ ok: false, text: 'Stopped.' }); }
      if (!t) { clearInterval(iv); return resolve({ ok: false, text: 'The task was deleted.' }); }
      if (t.status === 'done' || t.status === 'blocked') { clearInterval(iv); resolve({ ok: t.status === 'done', text: t.summary || t.status }); }
      run.status[run.taskNode[id]] = t.status === 'review' ? 'wait' : 'running';
    }, 1000);
  });
}

async function execNode(f, run, n) {
  const c = n.config || {};
  const ctx = contextFor(f, run, n.id);
  if (n.type === 'trigger') return { ok: true, text: run.reason };
  if (n.type === 'notify') {
    const msg = c.message || n.title || 'Automation';
    try { new Notification(f.name, { body: msg }); } catch {}
    toast(`${esc(f.name)}: ${esc(msg)}`, 5000);
    return { ok: true, text: msg };
  }
  if (n.type === 'command') {
    if (!c.cmd) return { ok: false, text: 'No command.' };
    const r = await ab.flowExec(c.cmd, c.project || cfg.selectedProject, SecretsSettings.parse(c.secrets));
    if (!r.ok) return { ok: false, text: r.error };
    const tail = r.value.out.split('\n').slice(-6).join('\n');
    return { ok: r.value.code === 0, text: `${r.value.code === 0 ? 'OK' : `exit code ${r.value.code}`}\n${tail}` };
  }
  if (n.type === 'condition') {
    const r = await ab.aiAsk(`Answer only "YES" or "NO", nothing else.\nQuestion: ${c.question || n.title}\nResults of the previous steps:\n${ctx || '(none)'}`, 'haiku');
    if (!r.ok) return { ok: false, text: r.error };
    const yes = /^\W*(yes|s[ií])\b/i.test(r.value);
    return { ok: true, branch: yes ? 'yes' : 'no', text: yes ? 'Yes' : 'No' };
  }
  if (n.type === 'agent') {
    if (!c.prompt) return { ok: false, text: 'No instruction.' };
    const text = `${c.prompt}${ctx ? `\n\nContext (previous steps of "${f.name}"):\n${ctx}` : ''}`;
    const t = addTask({
      text, agent: c.agent || 'auto', cwd: c.project || cfg.selectedProject, group: c.group || '',
      light: c.mode === 'light', heavy: c.mode === 'heavy',
    });
    t.flowRun = run.id;
    run.taskNode[t.id] = n.id;
    save(); tickTasks();
    return waitForTask(t.id, run);
  }
  return { ok: true, text: '' };
}

async function runFlow(f, reason = 'by hand') {
  if (activeRuns.has(f.id)) return;
  const nodes = f.nodes.filter((n) => n.type !== 'note');
  const edges = f.edges.map((e, i) => ({ ...e, i })).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const run = { id: uid(), reason, status: {}, results: {}, edge: {}, log: [], taskNode: {}, startedAt: Date.now() };
  activeRuns.set(f.id, run);
  const log = (m) => { run.log.push(`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${m}`); if (flowsOpen() && flowSel === f.id) renderFlow(); else renderFlowList(); };
  log(`Start (${reason})`);
  let failed = false;

  const finished = new Set();
  const incoming = (id) => edges.filter((e) => e.to === id);
  const pending = [];

  const settle = async (n, res) => {
    run.results[n.id] = res;
    run.status[n.id] = res.skip ? 'skip' : res.ok ? 'ok' : 'fail';
    finished.add(n.id);
    if (!res.ok && !res.skip) { failed = true; log(`Error in ${n.title}: ${res.text.split('\n')[0]}`); }
    else if (!res.skip) log(`Done: ${n.title}${res.branch ? ` (${res.text})` : ''}`);
    for (const e of edges.filter((x) => x.from === n.id)) {
      const active = !res.skip && res.ok && (!res.branch || (e.branch || 'yes') === res.branch);
      run.edge[e.i] = active ? 'active' : 'dead';
    }
    // nodes whose inputs are all resolved can run (or are skipped if none arrived active)
    for (const e of edges.filter((x) => x.from === n.id)) {
      const target = nodes.find((x) => x.id === e.to);
      if (finished.has(target.id) || run.status[target.id]) continue;
      const ins = incoming(target.id);
      if (ins.some((x) => run.edge[x.i] == null)) continue;
      if (ins.some((x) => run.edge[x.i] === 'active')) pending.push(start(target));
      else pending.push(settle(target, { ok: false, skip: true, text: 'Skipped' }));
    }
  };
  const start = async (n) => {
    if (run.stopped) return settle(n, { ok: false, skip: true, text: 'Stopped' });
    run.status[n.id] = 'running';
    log(`Starting: ${n.title}`);
    let res;
    try { res = await execNode(f, run, n); } catch (err) { res = { ok: false, text: err.message }; }
    return settle(n, res);
  };

  const roots = nodes.filter((n) => !incoming(n.id).length);
  if (!roots.length) { log('There is no starting node.'); }
  pending.push(...roots.map(start));
  // wait until nothing is left running
  while (pending.length) await pending.shift();

  f.lastRun = { at: Date.now(), ok: !failed && !run.stopped, results: run.results, log: run.log.slice(-30) };
  log(run.stopped ? 'Stopped.' : failed ? 'Finished with errors.' : 'Finished successfully.');
  activeRuns.delete(f.id);
  save();
  if (!document.hasFocus()) { try { new Notification(`${f.name}: ${failed ? 'finished with errors' : 'finished'}`, { body: run.log.slice(-1)[0] || '' }); } catch {} }
  toast(`Automation "${esc(f.name)}" ${failed ? 'finished with errors' : 'finished'}`, 4500);
  if (flowsOpen()) renderFlow(); else renderFlowList();
}

function stopFlow(f) {
  const run = activeRuns.get(f.id);
  if (!run) return;
  run.stopped = true;
  // queued tasks are removed; running ones are left for you to review
  cfg.tasks = (cfg.tasks || []).filter((t) => !(t.flowRun === run.id && t.status === 'pending'));
  save();
}

// Schedules: every 30 s, check which automations are due.
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
      if (!last) { f.lastScheduled = Date.now(); save(); continue; } // start counting from now
      if (Date.now() - last >= every) { f.lastScheduled = Date.now(); save(); runFlow(f, `every ${c.every} min`); }
    } else if (c.mode === 'daily') {
      const [h, m] = String(c.at || '09:00').split(':').map(Number);
      const due = new Date(now); due.setHours(h, m || 0, 0, 0);
      if (now >= due && last < due.getTime()) { f.lastScheduled = Date.now(); save(); runFlow(f, `daily ${c.at}`); }
    }
  }
}

// ---------- AI: design and explain ----------
// Electron has no window.prompt: a dialog of our own that resolves with the text (or null).
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
  // one column per depth; every 3 columns the flow wraps to a new row (like text)
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
  const desc = await askText(current ? 'Change this automation' : 'Design an automation',
    current ? 'Describe what to change or add. AI redesigns the diagram (to keep the current version, use Duplicate first).'
      : 'Describe what should happen, in your own words. E.g. "every morning review new issues, have Claude propose a plan and another agent implement it; if the tests pass, notify me".',
    current ? 'Add a step that…' : 'Every time…');
  if (!desc) return;
  const btn = $('#flDesign');
  btn.disabled = true; btn.lastChild.textContent = 'Designing…';
  const agents = ['auto', ...subscriptions().map(([k]) => k)].join(', ');
  const r = await ab.aiAsk([
    'Design an automation for AgentBoard (an app that coordinates coding agents such as Claude Code running in terminals).',
    'Reply ONLY with valid JSON, no extra text, in this shape:',
    '{"name":"…","nodes":[{"id":"n1","type":"trigger|agent|command|condition|notify|note","title":"…","config":{}}],"edges":[{"from":"n1","to":"n2","branch":"yes|no"}]}',
    'config per type: trigger {"mode":"manual|every|daily","every":60,"at":"09:00"}; agent {"prompt":"self-contained, concrete instruction","agent":"auto","mode":"normal|light|heavy"}; command {"cmd":"shell command"}; condition {"question":"yes/no question about the previous result"}; notify {"message":"…"}; note {"text":"…"}.',
    '"branch" only on connections leaving a condition. Start with a single trigger.',
    'Use agents for work that needs thinking or code edits, commands for deterministic steps (tests, build, git), "light" for simple steps to save tokens and "heavy" only when it is hard. Run independent steps in parallel. At most 12 nodes.',
    'Write titles and instructions in the same language as the request.',
    `Available subscriptions: ${agents}. Projects: ${cfg.projects.map((p) => p.name).join(', ') || '(none)'}.`,
    current ? `Current automation: ${current}` : '',
    `Request: ${desc}`,
  ].filter(Boolean).join('\n'), 'sonnet');
  btn.disabled = false; btn.lastChild.textContent = 'Design with AI';
  if (!r.ok) return toast(`Could not design it: ${esc(r.error)}`, 6000);
  let spec;
  try { spec = JSON.parse(r.value.match(/\{[\s\S]*\}/)[0]); } catch { return toast('AI did not return a valid diagram; try describing it differently.', 6000); }
  const done = flowFromSpec(spec, f);
  if (!done) return toast('AI did not return any nodes.');
  toast(`Automation designed: ${done.nodes.length} steps. Review it, then use Explain Run or Run.`, 5000);
}

// A flow from a description { name, nodes: [{ id, type, title, config }], edges: [{ from, to, branch }] }
// (what AI designs, or a template): new ids, laid out, opened. Into `target` or a new flow.
function flowFromSpec(spec, target = null) {
  const ids = new Map();
  const nodes = (spec.nodes || []).filter((n) => NODE_TYPES[n.type]).slice(0, 20).map((n) => {
    const id = uid(); ids.set(n.id, id);
    const config = { ...(n.config || {}) };
    if (n.type === 'agent' && config.agent && config.agent !== 'auto') config.agent = agentKeyFrom(config.agent) || 'auto';
    if (config.project) config.project = projectFrom(config.project)?.path || '';
    return { id, type: n.type, title: String(n.title || NODE_TYPES[n.type].label).slice(0, 60), config, x: 0, y: 0 };
  });
  const edges = (spec.edges || []).filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ from: ids.get(e.from), to: ids.get(e.to), ...(e.branch === 'no' || e.branch === 'yes' ? { branch: e.branch } : {}) }));
  if (!nodes.length) return null;
  layoutNodes(nodes, edges);
  target = target || newFlow();
  Object.assign(target, { name: spec.name ? String(spec.name).slice(0, 80) : target.name, nodes, edges, lastRun: null });
  flowSel = target.id; nodeSel = null; edgeSel = null;
  delete flowPlan[target.id];
  save(); renderFlow();
  return target;
}

async function explainWithAI() {
  const f = curFlow();
  if (!f) return;
  const btn = $('#flExplain');
  btn.disabled = true; btn.lastChild.textContent = 'Analyzing…';
  const r = await ab.aiAsk([
    'You are an expert in automation with coding agents. Explain in English, briefly (at most 18 lines) and concretely:',
    '1) what this automation will do step by step when AgentBoard runs it ("agent" nodes become tasks for Claude/Codex/Gemini in new sessions with a summary of the previous steps; "command" runs in the shell; "condition" is decided by an AI with YES/NO);',
    '2) what is missing or may fail (permissions, vague instructions, unconnected steps, dangerous commands);',
    '3) how to improve it or save tokens (light mode, parallel steps, commands instead of agents for deterministic work).',
    'Use a numbered list and **bold** headings.',
    JSON.stringify({ name: f.name, nodes: f.nodes.map(({ id, type, title, config }) => ({ id, type, title, config })), edges: f.edges }),
  ].join('\n'), 'haiku');
  btn.disabled = false; btn.lastChild.textContent = 'Explain Run';
  if (!r.ok) return toast(`Could not explain it: ${esc(r.error)}`, 6000);
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
  $('#flTemplates').onclick = (e) => flowTemplates.open(e.currentTarget);
  $('#flEmptyTemplates').onclick = (e) => flowTemplates.open(e.currentTarget);
  $('#flName').addEventListener('input', (e) => { const f = curFlow(); if (f) { f.name = e.target.value; save(); renderFlowList(); } });
  $('#flAdd').addEventListener('click', (e) => { const t = e.target.closest('[data-type]')?.dataset.type; if (t) addNode(t); });
  $('#flAdd').innerHTML = Object.entries(NODE_TYPES).map(([k, T]) => `<button type="button" data-type="${k}" title="Add a ${T.label} node: ${esc(T.hint)}"><span style="color:${T.color}">${icon(T.icon, 13)}</span> ${T.label}</button>`).join('');
  $('#flDesign').onclick = designWithAI;
  $('#flExplain').onclick = explainWithAI;
  $('#flRun').onclick = () => { const f = curFlow(); if (!f) return; if (activeRuns.has(f.id)) stopFlow(f); else runFlow(f); renderFlow(); };
  $('#flClose').onclick = () => toggleFlows(false);
  $('#flowsBtn').onclick = () => toggleFlows();
  setInterval(checkSchedules, 30_000);
  setInterval(() => { if (flowsOpen() && activeRuns.size) renderFlow(); }, 2000);
}
