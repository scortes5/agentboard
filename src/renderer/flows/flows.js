// AgentBoard — Automations: node diagrams (n8n style) that AI helps design and your
// agents run. Each "Agent" node becomes a queue task (new session, with a short summary
// of the previous steps = few tokens); independent branches run in parallel.
'use strict';
/* global ab, cfg, fmt, SecretsSettings, ISSUE_CAUTION, $, esc, uid, basename, clamp, toast, save, addTask, taskById, subscriptions, agentKeyFrom, projectFrom,
   openTasks, tickTasks, diagramOpen, toggleDiagram, cardData, focusCardView, focusCard, icon */

const NODE_TYPES = {
  trigger:   { icon: 'bolt', label: 'Trigger', color: '#ffd60a', hint: 'When it starts: by hand, on a schedule, when a task finishes or when a new GitHub issue is opened.' },
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
let flowDragging = false;    // a node or a connection is being dragged: redraws would drop it
const activeRuns = new Map(); // flowId -> run
const RUN_HISTORY = 8;       // runs kept per automation (time, result, duration only)

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

// Steps that can fail on their own have a second output: what to do if they do.
const canFail = (n) => n.type === 'agent' || n.type === 'command';
const BRANCH_LABEL = { yes: 'Yes', no: 'No', error: 'On error' };

function nodeSummary(n) {
  const c = n.config || {};
  if (n.type === 'trigger') {
    const proj = c.project ? ` in ${projectFrom(c.project)?.name || basename(c.project)}` : '';
    if (c.mode === 'task') return `when a task ${c.on === 'any' ? 'finishes' : c.on === 'blocked' ? 'is blocked' : 'is done'}${proj}${c.match ? ` and mentions "${c.match}"` : ''}`;
    if (c.mode === 'issue') return `when a new issue${c.label ? ` labeled ${c.label}` : ''} is opened${proj} (checked every ${issueEvery(c)} min)`;
    return c.mode === 'every' ? `every ${c.every || 60} min` : c.mode === 'daily' ? `every day at ${c.at || '09:00'}` : 'by hand (Run button)';
  }
  if (n.type === 'agent') {
    const a = c.agent && c.agent !== 'auto' ? (cfg.agents[c.agent]?.label || 'missing agent') : 'auto';
    return `${a}${c.mode && c.mode !== 'normal' ? ' · ' + c.mode : ''} — ${(c.prompt || 'no instruction').slice(0, 70)}`;
  }
  if (n.type === 'command') return c.cmd ? `$ ${c.cmd.slice(0, 60)}` : 'no command';
  if (n.type === 'condition') return c.question ? `${c.question.replace(/\?$/, '').slice(0, 60)}?` : 'no question';
  if (n.type === 'notify') return c.message || 'Notification';
  return (c.text || '').slice(0, 90);
}

const TRIGGER_MODES = [['manual', 'By hand'], ['every', 'Every N minutes'], ['daily', 'Every day at a time'], ['task', 'When a task finishes'], ['issue', 'When a new GitHub issue is opened']];
const issueEvery = (c) => Math.max(5, +c.every || 15);

// When a scheduled automation runs next, or checks for new issues (null when it only runs by
// hand, on task events, or is off).
function nextRunAt(f, now = Date.now()) {
  const c = f.nodes.find((n) => n.type === 'trigger')?.config;
  if (f.enabled === false || !c || c.mode === 'manual' || c.mode === 'task') return null;
  if (c.mode === 'issue') return (f.lastScheduled || now) + issueEvery(c) * 60_000;
  if (c.mode === 'every') return (f.lastScheduled || now) + Math.max(5, +c.every || 60) * 60_000;
  const [h, m] = String(c.at || '09:00').split(':').map(Number);
  const due = new Date(now); due.setHours(h || 0, m || 0, 0, 0);
  if ((f.lastScheduled || now) >= due.getTime()) due.setDate(due.getDate() + 1);
  return due.getTime();
}

const whenText = (ts) => {
  const d = new Date(ts), today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = d.toDateString() === today.toDateString() ? 'today' : d.toDateString() === tomorrow.toDateString() ? 'tomorrow' : d.toLocaleDateString();
  return `${day} ${fmt.clock(ts)}`;
};

// ---------- Drawing ----------
function renderFlowList() {
  $('#flList').innerHTML = flows().map((f) => {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((n) => n.type === 'trigger');
    const next = trig && nextRunAt(f);
    const state = run ? 'Running now' : f.lastRun ? `Last run ${whenText(f.lastRun.at)}${f.lastRun.ok ? '' : ' · with errors'}` : 'Never run';
    return `<button type="button" class="fl-item ${f.id === flowSel ? 'active' : ''}${f.enabled === false ? ' off' : ''}" data-flow="${esc(f.id)}" title="Open ${esc(f.name)}">
      <span class="fl-dot ${run ? 'running' : f.lastRun ? (f.lastRun.ok ? 'ok' : 'fail') : ''}"></span>
      <span class="fl-item-text"><span class="fl-item-name">${esc(f.name)}</span><span class="fl-item-sub">${esc(state)}</span></span>${next ? `<span class="fl-sched" title="Scheduled: next run ${esc(whenText(next))}">${icon('clock', 13)}</span>` : ''}</button>`;
  }).join('') || '<div class="side-empty">No automations yet. Start a blank one, or describe what you want and use Design with AI.</div>';
}

// Periodic and log-driven redraws: never in the middle of a drag, and without rebuilding the
// inspector while you type in it (that would drop the focus and the text being written).
function refreshFlow() {
  if (!flowsOpen()) return renderFlowList();
  if (flowDragging) return renderFlowList();
  renderFlow({ keepInspector: $('#flInspector').contains(document.activeElement) });
}

function renderFlow({ keepInspector = false } = {}) {
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
           : canFail(n)
             ? '<span class="port out main" data-port="out" title="When it succeeds: drag to connect"></span><span class="port out err" data-port="out" data-branch="error" title="If it fails: drag to connect the step that handles the error"></span>'
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
  if (!keepInspector) renderInspector();
}

function portPos(nodeId, kind, branch) {
  const el = $(`#flNodes [data-node="${CSS.escape(nodeId)}"]`);
  if (!el) return null;
  const n = curFlow().nodes.find((x) => x.id === nodeId);
  const h = el.offsetHeight;
  if (kind === 'in') return { x: n.x, y: n.y + h / 2 };
  const twoWay = n.type === 'condition' || canFail(n);
  const y = twoWay ? n.y + h * (branch === 'no' || branch === 'error' ? 0.72 : 0.38) : n.y + h / 2;
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
    const label = e.branch ? `<text x="${a.x + 14}" y="${e.branch === 'error' ? a.y + 15 : a.y - 6}" class="fl-branch ${e.branch === 'error' ? 'err' : ''}">${BRANCH_LABEL[e.branch] || 'Yes'}</text>` : '';
    return `<path d="${curve(a, b)}" class="fl-edge-hit" data-edge="${i}"/><path d="${curve(a, b)}" class="fl-edge ${i === edgeSel ? 'sel' : ''} ${live ? 'live' : ''} ${run?.edge?.[i] === 'dead' ? 'dead' : ''}" marker-end="url(#flArrow)"/>${label}`;
  });
  if (temp) parts.push(`<path d="${curve(temp.a, temp.b)}" class="fl-edge temp"/>`);
  svg.innerHTML = `<defs><marker id="flArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" class="fl-arrow"/></marker></defs>${parts.join('')}`;
}

// ---------- Inspector ----------
const projectOptions = (sel, none = 'Current project') => `<option value="">${esc(none)}</option>` + cfg.projects.map((p) => `<option value="${esc(p.path)}" ${p.path === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

function renderInspector() {
  const box = $('#flInspector');
  const f = curFlow();
  if (!f) { box.innerHTML = ''; return; }
  const n = f.nodes.find((x) => x.id === nodeSel);
  if (edgeSel != null && f.edges[edgeSel]) {
    const e = f.edges[edgeSel];
    const a = f.nodes.find((x) => x.id === e.from), b = f.nodes.find((x) => x.id === e.to);
    box.innerHTML = `<h3>Connection</h3><p class="set-note">${esc(a?.title || '')} → ${esc(b?.title || '')}${e.branch === 'error' ? ' (if it fails)' : e.branch ? ` (${BRANCH_LABEL[e.branch]} branch)` : ''}</p>
      <button type="button" data-x="del-edge" title="Delete this connection (⌫)">Remove Connection</button>`;
    return;
  }
  if (!n) {
    const run = activeRuns.get(f.id);
    const trig = f.nodes.find((x) => x.type === 'trigger');
    const last = f.lastRun;
    const next = nextRunAt(f);
    const history = (f.runs || []).slice().reverse();
    box.innerHTML = `<h3>Automation</h3>
      <label class="set-row check" title="When off, the schedule is ignored; you can still run it by hand"><span>Enabled (follows its schedule)</span><input type="checkbox" class="switch-input" data-f="enabled" ${f.enabled !== false ? 'checked' : ''}/></label>
      <p class="set-note">${trig ? `Starts ${esc(nodeSummary(trig))}.` : 'Add a Trigger to say when it starts.'}
        ${next ? `<br/>Next run: ${esc(whenText(next))}.` : ''}
        ${last ? `<br/>Last run: ${esc(whenText(last.at))} — ${last.stopped ? 'stopped' : last.ok ? 'no errors' : 'with errors'}.` : ''}</p>
      ${history.length > 1 ? `<h3>Recent runs</h3><ul class="fl-runs">${history.map((h) => `<li><span class="fl-dot ${h.stopped ? '' : h.ok ? 'ok' : 'fail'}"></span><span>${esc(whenText(h.at))}</span><span class="muted">${esc(h.reason || '')}</span><span class="muted">${h.ms != null ? esc(fmt.elapsed(h.ms)) : ''}</span></li>`).join('')}</ul>` : ''}
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
    body += field('mode', 'When', `<select data-c="mode">${TRIGGER_MODES.map(([v, l]) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    if (c.mode === 'every') body += field('every', 'Minutes', `<input type="number" min="5" data-c="every" value="${esc(c.every || 60)}"/>`);
    if (c.mode === 'daily') body += field('at', 'Time', `<input type="time" data-c="at" value="${esc(c.at || '09:00')}"/>`);
    if (c.mode === 'task') {
      body += field('on', 'Which tasks', `<select data-c="on">${[['done', 'Done'], ['blocked', 'Blocked'], ['any', 'Done or blocked']].map(([v, l]) => `<option value="${v}" ${(c.on || 'done') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
      body += field('project', 'Project', `<select data-c="project">${projectOptions(c.project, 'Any project')}</select>`);
      body += field('match', 'Only tasks that mention (optional)', `<input data-c="match" value="${esc(c.match || '')}" placeholder="e.g. backend"/>`);
      body += `<p class="set-note">Agents receive the task's text and summary as context. Tasks created by automations never start one, so automations cannot trigger each other in a loop.</p>`;
    }
    if (c.mode === 'issue') {
      body += field('project', 'Project', `<select data-c="project">${projectOptions(c.project)}</select>`);
      body += field('label', 'Only issues labeled (optional)', `<input data-c="label" value="${esc(c.label || '')}" placeholder="e.g. bug"/>`);
      body += field('every', 'Check every (minutes)', `<input type="number" min="5" data-c="every" value="${esc(issueEvery(c))}"/>`);
      body += `<label class="fl-field check"><input type="checkbox" data-c="outside" ${c.outside ? 'checked' : ''}/> <span>Also issues opened by people outside the project (their text could try to give the agent instructions)</span></label>`;
      body += `<p class="set-note">Needs the GitHub CLI (gh). Issues already open when you turn this on are skipped; each new one starts one run, and <code>{issue}</code> in an agent's instruction or a command becomes its number.${f.issueError ? `<br/>Last check failed: ${esc(f.issueError)}` : ''}</p>`;
    }
    if (c.mode !== 'manual') body += `<p class="set-note">Scheduled and event automations run while AgentBoard is open (also in the background).</p>`;
  } else if (n.type === 'agent') {
    body += field('prompt', 'Instruction for the agent', `<textarea data-c="prompt" rows="6" placeholder="What to do, in which files, and how to tell it is done">${esc(c.prompt || '')}</textarea>`);
    body += field('agent', 'Subscription', `<select data-c="agent"><option value="auto">Auto (least busy)</option>${subscriptions().map(([k, a]) => `<option value="${esc(k)}" ${c.agent === k ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select>`);
    body += field('mode', 'Model', `<select data-c="mode">${MODES.map(([v, l]) => `<option value="${v}" ${(c.mode || 'normal') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`);
    body += field('project', 'Project', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += field('group', 'Board group (optional)', `<input data-c="group" value="${esc(c.group || '')}" placeholder="e.g. backend"/>`);
    body += field('timeout', 'Give up after (minutes, 0 = wait as long as it takes)', `<input type="number" min="0" max="1440" data-c="timeout" value="${esc(c.timeout ?? 0)}"/>`);
    body += `<p class="set-note">It receives a one-line summary of each previous step, not their full history. If the task is blocked or runs past the limit, the step fails: connect the red dot to handle that, otherwise the run stops here. The task itself is left for you to review.</p>`;
  } else if (n.type === 'command') {
    body += field('cmd', 'Command', `<textarea data-c="cmd" rows="3" class="mono" placeholder="npm test">${esc(c.cmd || '')}</textarea>`);
    body += field('project', 'Folder', `<select data-c="project">${projectOptions(c.project)}</select>`);
    body += `<label class="fl-field check"><input type="checkbox" data-c="inTaskFolder" ${c.inTaskFolder ? 'checked' : ''}/> <span>Run in the folder of the previous agent's task (its worktree, if it has one)</span></label>`;
    body += field('secrets', 'Secrets it can use (optional)', `<input data-c="secrets" class="mono" value="${esc(c.secrets || '')}" placeholder="APP_USER, APP_PASSWORD"/>`);
    body += field('timeout', 'Time limit (minutes)', `<input type="number" min="1" max="180" data-c="timeout" value="${esc(c.timeout || 10)}"/>`);
    body += `<p class="set-note">If it exits with an error or runs past the limit, the run follows the red dot (if it fails); with nothing connected there, it stops. Secrets (Settings → Secrets) arrive as environment variables, and their values are hidden in the output.</p>`;
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
    config: type === 'trigger' ? { mode: 'manual', every: 60, at: '09:00' } : type === 'agent' ? { agent: 'auto', mode: 'normal', timeout: 60 } : type === 'command' ? { timeout: 10 } : {},
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
      flowDragging = true;
      const move = (ev) => drawFlowEdges({ a, b: { x: ev.clientX - origin.left, y: ev.clientY - origin.top } });
      const up = (ev) => {
        flowDragging = false;
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
    flowDragging = true;
    const move = (ev) => {
      moved = true;
      n.x = Math.max(0, Math.round((start.nx + ev.clientX - start.x) / 10) * 10);
      n.y = Math.max(0, Math.round((start.ny + ev.clientY - start.y) / 10) * 10);
      nodeEl.style.left = n.x + 'px'; nodeEl.style.top = n.y + 'px';
      drawFlowEdges();
    };
    const up = () => {
      flowDragging = false;
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
    if (e.target.dataset.f === 'enabled') {
      // turning it back on counts from now, instead of catching up on the runs it missed
      f.enabled = e.target.checked; if (f.enabled) f.lastScheduled = Date.now();
      save(); renderFlowList(); renderInspector(); return;
    }
    if (!n) return;
    if (e.target.dataset.k) n[e.target.dataset.k] = e.target.value;
    if (e.target.dataset.c) n.config[e.target.dataset.c] = e.target.type === 'number' ? +e.target.value : e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (n.type === 'trigger') f.lastScheduled = Date.now(); // a new schedule starts counting now
    save();
    const el = $(`#flNodes [data-node="${CSS.escape(n.id)}"]`);
    if (el) { $('.fl-node-title', el).textContent = n.title || NODE_TYPES[n.type].label; $('.fl-node-sum', el).textContent = nodeSummary(n); }
    if (n.type === 'trigger') renderFlowList();
    if (e.target.tagName === 'SELECT') renderInspector();
  });
  $('#flInspector').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    const f = curFlow();
    if (x === 'del-node' || x === 'del-edge') deleteSelection();
    if (x === 'del-flow' && confirm(`Delete "${f.name}"?${activeRuns.has(f.id) ? ' It is running: it will be stopped first.' : ''}`)) { stopFlow(f); cfg.flows = flows().filter((q) => q !== f); flowSel = flows()[0]?.id || null; save(); renderFlow(); }
    if (x === 'dup-flow') {
      const copy = JSON.parse(JSON.stringify(f));
      const ids = new Map(copy.nodes.map((n) => [n.id, uid()]));
      copy.nodes.forEach((n) => { n.id = ids.get(n.id); });
      copy.edges.forEach((ed) => { ed.from = ids.get(ed.from); ed.to = ids.get(ed.to); });
      Object.assign(copy, { id: uid(), name: `${f.name} (copy)`, lastRun: null, runs: [], lastScheduled: Date.now() });
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
// The steps that lead to a node, nearest ones last (the order they ran in).
function ancestorsOf(f, nodeId) {
  const seen = new Set();
  const order = [];
  const walk = (id) => {
    for (const e of f.edges.filter((x) => x.to === id)) {
      if (seen.has(e.from)) continue;
      seen.add(e.from);
      walk(e.from);
      order.push(e.from);
    }
  };
  walk(nodeId);
  return order;
}

// One-line summaries of the finished steps leading to this node (skipped ones say nothing).
function contextFor(f, run, nodeId) {
  return ancestorsOf(f, nodeId).map((id) => {
    const n = f.nodes.find((x) => x.id === id);
    const r = run.results[id];
    return n && r && !r.skip && (n.type !== 'trigger' || r.event) ? `- ${n.title || NODE_TYPES[n.type].label}: ${(r.text || '').replace(/\s+/g, ' ').slice(0, 300)}` : '';
  }).filter(Boolean).join('\n');
}

// The task's result, or a failure once it runs past `minutes` (0 = no limit). A task that
// waits for review counts as still working; the task itself is never stopped here.
function waitForTask(id, run, minutes = 0) {
  const limit = Math.max(0, +minutes || 0) * 60_000;
  const started = Date.now();
  return new Promise((resolve) => {
    const iv = setInterval(() => {
      const t = taskById(id);
      if (run.stopped) { clearInterval(iv); return resolve({ ok: false, text: 'Stopped.' }); }
      if (!t) { clearInterval(iv); return resolve({ ok: false, text: 'The task was deleted.' }); }
      if (limit && Date.now() - started > limit && t.status !== 'done' && t.status !== 'blocked') {
        clearInterval(iv);
        return resolve({ ok: false, text: `No result after ${minutes} min (the task is ${t.status}; it was left for you to check). ${t.summary || ''}`.trim() });
      }
      if (t.status === 'done' || t.status === 'blocked') { clearInterval(iv); resolve({ ok: t.status === 'done', text: t.summary || t.status }); }
      run.status[run.taskNode[id]] = t.status === 'review' ? 'wait' : 'running';
    }, 1000);
  });
}

// The folder of the last agent task that led to this step: its own worktree when "Worktree per
// task" is on, so a check or a git command right after it sees what the agent changed. Only
// steps upstream count, so a parallel branch never lends its folder to this one.
function lastTaskFolder(f, run, nodeId) {
  const upstream = new Set(ancestorsOf(f, nodeId));
  const done = Object.keys(run.taskNode).filter((id) => upstream.has(run.taskNode[id])).map(taskById)
    .filter((t) => t && t.status === 'done').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  return done[0] ? done[0].workdir || done[0].cwd : null;
}

// {issue} in an instruction or a command: the number of the issue that started the run. Only
// digits are ever put in, so it is safe inside a shell command.
const withVars = (text, run) => String(text).replace(/\{issue\}/g, Number.isInteger(run.vars?.issue) ? String(run.vars.issue) : '{issue}');

async function execNode(f, run, n) {
  const c = n.config || {};
  const ctx = contextFor(f, run, n.id);
  if (n.type === 'trigger') return { ok: true, text: run.event || run.reason, event: !!run.event };
  if (n.type === 'notify') {
    const msg = c.message || n.title || 'Automation';
    try { new Notification(f.name, { body: msg }); } catch {}
    toast(`${esc(f.name)}: ${esc(msg)}`, 5000);
    return { ok: true, text: msg };
  }
  if (n.type === 'command') {
    if (!c.cmd) return { ok: false, text: 'No command.' };
    const folder = (c.inTaskFolder && lastTaskFolder(f, run, n.id)) || c.project || cfg.selectedProject;
    if (!folder) return { ok: false, text: 'No project: choose a folder for this step or select a project.' };
    const r = await ab.flowExec(withVars(c.cmd, run), folder, SecretsSettings.parse(c.secrets), +c.timeout || 10);
    if (!r.ok) return { ok: false, text: r.error };
    const tail = r.value.out.split('\n').slice(-6).join('\n');
    return { ok: r.value.code === 0, text: `${r.value.code === 0 ? 'OK' : `exit code ${r.value.code}`}\n${tail}` };
  }
  if (n.type === 'condition') {
    const r = await ab.aiAsk(`Answer only "YES" or "NO", nothing else.\nQuestion: ${c.question || n.title}\nResults of the previous steps:\n${ctx || '(none)'}`, 'haiku');
    if (!r.ok) return { ok: false, text: r.error };
    const yes = /^\W*(yes|s[ií])(?![a-z])/i.test(r.value.trim());
    return { ok: true, branch: yes ? 'yes' : 'no', text: yes ? 'Yes' : 'No' };
  }
  if (n.type === 'agent') {
    if (!c.prompt) return { ok: false, text: 'No instruction.' };
    const text = `${withVars(c.prompt, run)}${ctx ? `\n\nContext (previous steps of "${f.name}"):\n${ctx}` : ''}`;
    const t = addTask({
      text, agent: c.agent || 'auto', cwd: c.project || cfg.selectedProject, group: c.group || '',
      light: c.mode === 'light', heavy: c.mode === 'heavy',
    });
    t.flowRun = run.id;
    run.taskNode[t.id] = n.id;
    save(); tickTasks();
    return waitForTask(t.id, run, c.timeout);
  }
  return { ok: true, text: '' };
}

// `event`: what started it, for event triggers ({ text, vars }); its text is the trigger's
// result, so agents get it as context.
async function runFlow(f, reason = 'by hand', event = null) {
  if (activeRuns.has(f.id)) return;
  const nodes = f.nodes.filter((n) => n.type !== 'note');
  const edges = f.edges.map((e, i) => ({ ...e, i })).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));
  const run = { id: uid(), reason, event: event?.text || '', vars: event?.vars || {}, status: {}, results: {}, edge: {}, log: [], taskNode: {}, startedAt: Date.now() };
  activeRuns.set(f.id, run);
  const log = (m) => { run.log.push(`${fmt.clock(Date.now())} ${m}`); if (flowSel === f.id) refreshFlow(); else renderFlowList(); };
  log(`Start (${reason})`);
  let failed = false;

  const finished = new Set();
  const incoming = (id) => edges.filter((e) => e.to === id);
  const pending = [];

  const settle = async (n, res) => {
    run.results[n.id] = res;
    run.status[n.id] = res.skip ? 'skip' : res.ok ? 'ok' : 'fail';
    finished.add(n.id);
    // a failure with an error path connected is handled there, so the run can still succeed
    const handled = !res.ok && !res.skip && edges.some((x) => x.from === n.id && x.branch === 'error');
    if (handled) log(`Failed: ${n.title} (${res.text.split('\n')[0]}); following its error path`);
    else if (!res.ok && !res.skip) { failed = true; log(`Error in ${n.title}: ${res.text.split('\n')[0]}`); }
    else if (!res.skip) log(`Done: ${n.title}${res.branch ? ` (${res.text})` : ''}`);
    for (const e of edges.filter((x) => x.from === n.id)) {
      const active = !res.skip && (e.branch === 'error' ? !res.ok : res.ok && (!res.branch || (e.branch || 'yes') === res.branch));
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

  const outcome = run.stopped ? 'was stopped' : failed ? 'finished with errors' : 'finished';
  log(run.stopped ? 'Stopped.' : failed ? 'Finished with errors.' : 'Finished successfully.');
  const at = Date.now();
  f.lastRun = { at, ok: !failed && !run.stopped, stopped: !!run.stopped, results: run.results, log: run.log.slice(-30) };
  f.runs = [...(f.runs || []), { at, ok: f.lastRun.ok, stopped: f.lastRun.stopped, reason, ms: at - run.startedAt }].slice(-RUN_HISTORY);
  activeRuns.delete(f.id);
  save();
  if (!document.hasFocus()) { try { new Notification(`${f.name}: ${outcome}`, { body: run.log.slice(-1)[0] || '' }); } catch {} }
  toast(`Automation "${esc(f.name)}" ${outcome}`, 4500);
  if (flowsOpen()) renderFlow(); else renderFlowList();
  // events that arrived while it ran: the next one now
  const next = flowEvents.get(f.id)?.shift();
  if (next) runFlow(f, next.reason, next.event);
  else if (moreIssues.delete(f.id)) f.lastScheduled = 0; // more new issues: check again on the next tick
}

function stopFlow(f) {
  const run = activeRuns.get(f.id);
  if (!run) return;
  run.stopped = true;
  // queued tasks are removed; running ones are left for you to review
  cfg.tasks = (cfg.tasks || []).filter((t) => !(t.flowRun === run.id && t.status === 'pending'));
  save();
}

// ---------- Event triggers ----------
const flowEvents = new Map(); // flowId -> events that arrived while it was running (in memory)
const issuePolls = new Set();  // flows checking for issues right now
const moreIssues = new Set();  // flows with more new issues waiting for their turn
const triggerOf = (f) => f.nodes.find((n) => n.type === 'trigger')?.config || null;

// Called when a task ends (tasks.js). Tasks started by automations are ignored, so one
// automation can never start another, or itself, in a loop.
function onTaskFinished(t, status) {
  if (t.flowRun) return;
  for (const f of flows()) {
    const c = triggerOf(f);
    if (f.enabled === false || c?.mode !== 'task') continue;
    if ((c.on || 'done') !== 'any' && (c.on || 'done') !== status) continue;
    if (c.project && t.cwd !== c.project) continue;
    if (c.match && !t.text.toLowerCase().includes(String(c.match).toLowerCase())) continue;
    const event = { text: `Task ${status}: "${t.text.slice(0, 200)}"${t.summary ? ` (${t.summary.replace(/\s+/g, ' ').slice(0, 300)})` : ''}${t.branch ? `, on branch ${t.branch}` : ''}` };
    const reason = `task ${status}`;
    if (!activeRuns.has(f.id)) { runFlow(f, reason, event); continue; }
    const q = flowEvents.get(f.id) || [];
    if (q.length < 10) { q.push({ reason, event }); flowEvents.set(f.id, q); }
  }
}

// New issues for an "issue" trigger: the ones open when it was turned on are only remembered.
async function pollIssues(f, c) {
  if (issuePolls.has(f.id)) return;
  issuePolls.add(f.id);
  try {
    const r = await ab.githubIssues(c.project || cfg.selectedProject);
    if (!r.ok) { f.issueError = r.error; return; }
    f.issueError = '';
    const fits = r.value.filter((i) => (i.trusted || c.outside) && (!c.label || i.labels.some((l) => l.toLowerCase() === String(c.label).toLowerCase())));
    if (!Array.isArray(f.seenIssues)) { f.seenIssues = fits.map((i) => i.number); save(); return; }
    const seen = new Set(f.seenIssues);
    const fresh = fits.filter((i) => !seen.has(i.number)).sort((a, b) => a.number - b.number);
    if (!fresh.length || activeRuns.has(f.id) || f.enabled === false) return;
    const i = fresh[0];
    f.seenIssues = [...f.seenIssues, i.number].slice(-500);
    if (fresh.length > 1) moreIssues.add(f.id); else moreIssues.delete(f.id);
    save();
    const caution = typeof ISSUE_CAUTION === 'string' ? ` ${ISSUE_CAUTION}` : '';
    runFlow(f, `issue #${i.number}`, { text: `New GitHub issue #${i.number}: "${i.title.slice(0, 200)}"${i.labels.length ? ` (labels: ${i.labels.join(', ')})` : ''}. Read it with \`gh issue view ${i.number}\`.${caution}`, vars: { issue: i.number } });
  } finally { issuePolls.delete(f.id); }
}

// Schedules: every 30 s, check which automations are due.
function checkSchedules() {
  const now = new Date();
  for (const f of flows()) {
    if (f.enabled === false || activeRuns.has(f.id)) continue;
    const trig = f.nodes.find((n) => n.type === 'trigger');
    const c = trig?.config;
    if (!c || c.mode === 'manual' || c.mode === 'task') continue;
    const last = f.lastScheduled || 0;
    if (c.mode === 'issue') {
      // the first check only remembers the issues already open
      if (!Array.isArray(f.seenIssues) || Date.now() - last >= issueEvery(c) * 60_000) { f.lastScheduled = Date.now(); save(); pollIssues(f, c); }
    } else if (c.mode === 'every') {
      const every = Math.max(5, +c.every || 60) * 60_000;
      if (!last) { f.lastScheduled = Date.now(); save(); continue; } // start counting from now
      if (Date.now() - last >= every) { f.lastScheduled = Date.now(); save(); runFlow(f, `every ${c.every} min`); }
    } else if (c.mode === 'daily') {
      // a new or just-changed daily schedule waits for its next time instead of running right away
      if (!last) { f.lastScheduled = Date.now(); save(); continue; }
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
    'config per type: trigger {"mode":"manual|every|daily|task|issue","every":60,"at":"09:00"} (task: runs when a task finishes, with "on":"done|blocked|any" and optional "match"; issue: runs once per new GitHub issue, with optional "label", and {issue} in later instructions or commands becomes its number); agent {"prompt":"self-contained, concrete instruction","agent":"auto","mode":"normal|light|heavy","timeout":60}; command {"cmd":"shell command","timeout":10}; condition {"question":"yes/no question about the previous result"}; notify {"message":"…"}; note {"text":"…"}.',
    '"branch" is "yes" or "no" on connections leaving a condition, and "error" on a connection leaving an agent or command that should run only if that step fails (for example an agent that fixes failing tests). Start with a single trigger.',
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
    .map((e) => ({ from: ids.get(e.from), to: ids.get(e.to), ...(BRANCH_LABEL[e.branch] ? { branch: e.branch } : {}) }));
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
    '1) what this automation will do step by step when AgentBoard runs it ("agent" nodes become tasks for Claude/Codex/Gemini in new sessions with a summary of the previous steps; "command" runs in the shell; "condition" is decided by an AI with YES/NO; a connection with branch "error" runs only if its step fails, and a step that fails with no error connection stops the run);',
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
  setInterval(() => { if (flowsOpen() && activeRuns.size) refreshFlow(); }, 2000);
}
