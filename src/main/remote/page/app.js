// AgentBoard remote page: the token travels in the link's #fragment (never sent to servers or
// kept in logs) and goes in the Authorization header of every request.
'use strict';
const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function render(s) {
  const c = s.counts || {};
  $('#counts').textContent = [c.done != null && `${c.done}/${c.total} done`, c.running && `${c.running} working`, c.errors && `${c.errors} with errors`].filter(Boolean).join(' · ');
  $('#approvals').innerHTML = (s.approvals || []).map((a) => `
    <div class="item ask"><b>${esc(a.title)}</b>${a.context ? `<pre>${esc(a.context)}</pre>` : ''}<div>${esc(a.question)}</div>
      <div class="row"><button data-card="${esc(a.card)}" data-yes="0">Reject</button><button class="primary" data-card="${esc(a.card)}" data-yes="1">Approve</button></div></div>`).join('');
  $('#tasks').innerHTML = (s.tasks || []).map((t) => `
    <div class="item"><span class="st ${esc(t.status)}"></span>${esc(t.text)}
      <div class="line">${esc([t.agent, t.elapsed, t.tokens, t.line || t.summary].filter(Boolean).join(' · '))}</div></div>`).join('') || '<span class="muted">No tasks.</span>';
}

async function refresh() {
  try { render(await api('state')); $('#error').hidden = true; } catch (err) { $('#error').textContent = err.message; $('#error').hidden = false; }
}

$('#approvals').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-card]');
  if (!b) return;
  b.closest('.item').remove();
  await api('approve', { card: b.dataset.card, yes: b.dataset.yes === '1' }).catch((err) => alert(err.message));
  refresh();
});
$('#add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#text').value.trim();
  if (!text) return;
  await api('task', { text }).then(() => { $('#text').value = ''; }).catch((err) => alert(err.message));
  setTimeout(refresh, 1500);
});
refresh();
setInterval(refresh, 3000);
