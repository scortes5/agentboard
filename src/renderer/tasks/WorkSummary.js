// Work summaries: what each agent is doing now and what it changed on finished tasks.
// Finished entries come from the main-process work log; running tasks come from cfg.tasks.
'use strict';
/* global cfg, $, esc, ab, tasks */

const WORK_REFRESH_MS = 3000; // polled only while the dialog is open
const WORK_STATUS = { running: ['Running', 'run'], review: ['Waiting', 'warn'], done: ['Done', 'ok'], blocked: ['Blocked', 'bad'] };
let workTimer = null;

const workAgent = (key) => cfg.agents[key]?.label || key || 'Unassigned';
const workBadge = (status) => { const [label, cls] = WORK_STATUS[status] || [status || 'Unknown', '']; return `<span class="ws-badge ${cls}">${esc(label)}</span>`; };
function workAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1e3);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(ms).toLocaleDateString();
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function workFiles(e) {
  if (!e.files.length) return '<p class="muted small">No files changed.</p>';
  const rows = e.files.map((f) => `<li title="${esc(f.path)}${f.preexisting ? ' (already modified before the task started)' : ''}">
      <code>${esc(f.path)}</code>${f.created ? '<span class="ws-tag">new</span>' : ''}${f.preexisting ? '<span class="ws-tag">pre-existing</span>' : ''}
      <span class="ws-lines"><span class="ok">+${f.added}</span> <span class="bad">−${f.removed}</span></span></li>`).join('');
  const more = e.fileCount > e.files.length ? `<li class="muted small">and ${e.fileCount - e.files.length} more</li>` : '';
  return `<ul class="ws-files">${rows}${more}</ul>`;
}

function workRunning(t) {
  return `<article class="ws-entry">
    <header>${workBadge(t.status)}<b>${esc(workAgent(t.assigned))}</b><span class="muted small">started ${workAgo(t.startedAt || Date.now())}</span></header>
    <div class="ws-task">${esc(t.text)}</div>
    <p class="muted small">Files are listed when the task finishes.</p></article>`;
}

function workFinished(e) {
  const commits = e.commits.length
    ? `<div class="muted small">${plural(e.commits.length, 'commit')}: ${e.commits.map((c) => `<code>${esc(c.hash)}</code> ${esc(c.subject)}`).join(' · ')}</div>` : '';
  return `<article class="ws-entry">
    <header>${workBadge(e.status)}<b>${esc(workAgent(e.agent))}</b>
      <span class="muted small">${workAgo(e.finishedAt)}${e.branch ? ' · ' + esc(e.branch) : ''} · ${plural(e.fileCount, 'file')} <span class="ok">+${e.added}</span> <span class="bad">−${e.removed}</span></span></header>
    <div class="ws-task">${esc(e.text)}</div>
    ${e.summary ? `<div class="ws-summary">${esc(e.summary)}</div>` : ''}
    ${e.exact ? '' : '<p class="muted small">Started before AgentBoard restarted: only uncommitted changes are shown.</p>'}
    ${commits}${workFiles(e)}</article>`;
}

async function renderWorkSummary() {
  const r = await ab.workRecent();
  if (!r.ok) { $('#workBody').innerHTML = `<p class="muted small">Could not read the work log: ${esc(r.error)}</p>`; return; }
  const running = tasks().filter((t) => t.status === 'running' || t.status === 'review');
  $('#workBody').innerHTML = (running.length ? `<h3>In progress</h3>${running.map(workRunning).join('')}` : '')
    + `<h3>Finished</h3>${r.value.length ? r.value.map(workFinished).join('') : '<p class="muted small">No finished tasks yet.</p>'}`;
}

function openWorkSummary() {
  if (!$('#work').open) $('#work').showModal();
  renderWorkSummary();
  clearInterval(workTimer);
  workTimer = setInterval(renderWorkSummary, WORK_REFRESH_MS);
}

$('#work').addEventListener('close', () => { clearInterval(workTimer); workTimer = null; });
$('#workBtn').onclick = openWorkSummary;
