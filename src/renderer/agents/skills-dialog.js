// AgentBoard — Skills and Agents: skills, Claude subagents, token-saving skills and Agent Connection.
'use strict';

// ---------- Skills and agents ----------
const PROVIDERS = {
  claude: { label: 'Claude Code', color: () => cfg.agents.claude?.color || '#e8875f' },
  codex: { label: 'Codex', color: () => cfg.agents.codex?.color || '#3fbf8f' },
  gemini: { label: 'Gemini CLI', color: () => cfg.agents.gemini?.color || '#6c9cf5' },
};
const KIND_LABEL = { skill: 'skill', command: 'command', extension: 'extension' };
let skillItems = [];
let agentDefs = [];
let skillProvider = 'all';
let editingAgent = null;

function showTab(name) {
  for (const b of document.querySelectorAll('#skills .tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const s of document.querySelectorAll('#skills section[data-pane]')) s.classList.toggle('hidden', s.dataset.pane !== name);
}

async function openSkills(tab = 'skills') {
  showTab(tab);
  $('#skills').showModal();
  await refreshSkills();
}

async function refreshSkills() {
  $('#skillRows').innerHTML = '<div class="empty-note">Reading your skills…</div>';
  const [items, defs, bridge, avail] = await Promise.all([ab.skillsScan(), ab.agentsList(), ab.bridgeStatus(), ab.checkAgents()]);
  skillItems = items; agentDefs = defs; agentAvailable = avail;
  renderSkillList(); renderAgentDefs(); renderConnect(bridge);
  renderPack(await ab.packStatus());
}

// Token-saving skills bundled with AgentBoard
function renderPack(pack) {
  const label = { ok: 'installed', old: 'outdated' };
  $('#packRows').innerHTML = pack.map((p) => `
    <div class="hub-row skill">
      <span class="dot" style="background:var(--accent);color:var(--accent)"></span>
      <div class="meta"><strong>${esc(p.name)}</strong><span class="desc">${esc(p.description)}</span></div>
      <div class="acts">${Object.keys(PROVIDERS).map((k) => `<span class="badge ${p.installed[k] === 'ok' ? 'ok' : 'no'}" title="${esc(PROVIDERS[k].label)}">${esc(PROVIDERS[k].label)}: ${label[p.installed[k]] || 'not installed'}</span>`).join('')}</div>
      <span></span>
    </div>`).join('') || '<div class="empty-note">The skills-pack folder was not found.</div>';
}
$('#packInstall').onclick = async () => {
  const r = await ab.packInstall(Object.keys(PROVIDERS));
  if (!r.ok) return toast(`Could not install: ${esc(r.error)}`);
  toast(`Token-saving skills installed (${r.value.length}). Restart open agents so they pick them up.`, 5000);
  renderPack(await ab.packStatus());
};

function renderSkillList() {
  const count = (p) => skillItems.filter((x) => p === 'all' || x.provider === p).length;
  $('#skillProviders').innerHTML = ['all', ...Object.keys(PROVIDERS)].map((p) =>
    `<button type="button" data-p="${p}" class="${p === skillProvider ? 'active' : ''}">${p === 'all' ? 'All' : esc(PROVIDERS[p].label)}<span class="n">${count(p)}</span></button>`).join('');

  const q = $('#skillFilter').value.trim().toLowerCase();
  const list = skillItems.filter((x) => (skillProvider === 'all' || x.provider === skillProvider)
    && (!q || `${x.name} ${x.description} ${x.scope}`.toLowerCase().includes(q)));
  const box = $('#skillRows');
  box.innerHTML = '';
  if (!list.length) {
    box.innerHTML = `<div class="empty-note">${q ? 'No results.'
      : skillProvider === 'claude' ? 'No Claude Code skills found on this computer (<code>~/.claude/skills</code>, your projects or active plugins). Skills you enable on claude.ai live in your web account, not on disk. You can copy a Codex skill here.'
      : skillProvider === 'gemini' ? 'No Gemini CLI skills, commands or extensions found on this computer.'
      : 'No skills found on this computer.'}</div>`;
    return;
  }
  for (const prov of Object.keys(PROVIDERS)) {
    const items = list.filter((x) => x.provider === prov);
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'group-title';
    h.innerHTML = `<span class="dot" style="background:${esc(PROVIDERS[prov].color())}"></span>${esc(PROVIDERS[prov].label)} · ${items.length}`;
    box.appendChild(h);
    for (const s of items) box.appendChild(skillRow(s));
  }
}

function skillRow(s) {
  const row = document.createElement('div');
  row.className = 'hub-row skill';
  const others = Object.keys(PROVIDERS).filter((p) => p !== s.provider);
  row.innerHTML = `
    <span class="dot" style="background:${esc(PROVIDERS[s.provider].color())};color:${esc(PROVIDERS[s.provider].color())}"></span>
    <span class="meta"><strong>${esc(s.name)}<span class="tag">${KIND_LABEL[s.kind] || s.kind}</span></strong>
      <span class="desc" title="${esc(s.description)}">${esc(s.description) || '<i>No description</i>'}</span></span>
    <span class="badge">${esc(s.scope)}</span>
    <span class="acts">
      ${s.kind === 'skill' ? `<select class="copy" title="Copy this skill to another subscription">
        <option value="">Copy to…</option>${others.map((p) => `<option value="${p}">${esc(PROVIDERS[p].label)}</option>`).join('')}</select>` : ''}
      <button type="button" class="icon" title="Show in Finder">${icon('folder', 14)}</button>
    </span>`;
  $('button', row).onclick = () => ab.skillsReveal(s.path);
  const sel = $('select', row);
  if (sel) sel.onchange = async () => {
    const target = sel.value;
    sel.value = '';
    if (!target) return;
    const r = await ab.skillsCopy(s.path, target);
    if (r.ok) { toast(`Skill <b>${esc(s.name)}</b> copied to ${esc(PROVIDERS[target].label)}`); await refreshSkills(); }
    else toast(esc(r.error), 4500);
  };
  return row;
}

$('#skillProviders').addEventListener('click', (e) => {
  const p = e.target.closest('[data-p]')?.dataset.p;
  if (p) { skillProvider = p; renderSkillList(); }
});
$('#skillFilter').addEventListener('input', renderSkillList);

function renderAgentDefs() {
  const box = $('#agentDefRows');
  box.innerHTML = agentDefs.length ? '' : '<div class="empty-note">You have no agents of your own yet. Create one with <b>New Agent</b>.</div>';
  for (const a of agentDefs) {
    const row = document.createElement('div');
    row.className = 'hub-row skill';
    row.innerHTML = `
      <span class="dot" style="background:${esc(PROVIDERS.claude.color())};color:${esc(PROVIDERS.claude.color())}"></span>
      <span class="meta"><strong>${esc(a.name)}${a.model ? `<span class="tag">${esc(a.model)}</span>` : ''}</strong>
        <span class="desc">${esc(a.description) || '<i>No description</i>'}</span></span>
      <span class="badge">${esc(a.scope)}</span>
      <span class="acts"><button type="button" data-a="edit" title="Edit this subagent">Edit</button><button type="button" data-a="del" class="icon" title="Move to the Trash">${icon('trash', 14)}</button></span>`;
    row.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-a]')?.dataset.a;
      if (act === 'edit') openAgentForm(a);
      if (act === 'del' && confirm(`Move "${a.name}" to the Trash?`)) {
        const r = await ab.agentsDelete(a.file);
        if (r.ok) { toast(`<b>${esc(a.name)}</b> moved to the Trash`); await refreshSkills(); } else toast(esc(r.error), 4500);
      }
    });
    box.appendChild(row);
  }
}

function openAgentForm(a = null) {
  editingAgent = a;
  const f = $('#skillsForm');
  f.adProject.innerHTML = '<option value="">User (all projects)</option>'
    + cfg.projects.map((p) => `<option value="${esc(p.path)}">Project · ${esc(p.name)}</option>`).join('');
  f.adName.value = a?.name || '';
  f.adProject.value = a?.project || '';
  f.adDescription.value = a?.description || '';
  f.adModel.value = a?.model || '';
  f.adTools.value = a?.tools || '';
  f.adPrompt.value = a?.prompt || '';
  $('#agentFormError').textContent = '';
  $('#agentForm').classList.remove('hidden');
  $('#newAgentDef').classList.add('hidden');
  f.adName.focus();
}

function closeAgentForm() {
  editingAgent = null;
  $('#agentForm').classList.add('hidden');
  $('#newAgentDef').classList.remove('hidden');
}

$('#newAgentDef').onclick = () => openAgentForm();
$('#agentFormCancel').onclick = closeAgentForm;
$('#agentFormSave').onclick = async () => {
  const f = $('#skillsForm');
  const r = await ab.agentsSave({
    file: editingAgent?.file || null,
    name: f.adName.value.trim(), project: f.adProject.value || null,
    description: f.adDescription.value, model: f.adModel.value, tools: f.adTools.value, prompt: f.adPrompt.value,
  });
  if (!r.ok) { $('#agentFormError').textContent = r.error; return; }
  toast(`Agent <b>${esc(f.adName.value.trim())}</b> saved`);
  closeAgentForm();
  await refreshSkills();
};

function renderConnect(bridge) {
  const box = $('#mcpRows');
  box.innerHTML = '';
  for (const key of Object.keys(PROVIDERS)) {
    const installed = agentAvailable[key] !== false;
    const on = bridge.connected[key];
    const row = document.createElement('div');
    row.className = 'hub-row';
    row.innerHTML = `
      <span class="dot" style="background:${esc(PROVIDERS[key].color())};color:${esc(PROVIDERS[key].color())}"></span>
      <span class="meta"><strong>${esc(PROVIDERS[key].label)}</strong>
        <small>${!installed ? 'Not installed' : on ? 'Can see and message the other agents on the board' : 'Does not know the other agents yet'}</small></span>
      <span class="badge ${on ? 'ok' : ''}">${on ? 'Connected' : 'Not connected'}</span>
      <span class="acts"><button type="button" ${installed ? '' : 'disabled'} title="${on ? 'Remove the AgentBoard MCP server from this CLI' : 'Register the AgentBoard MCP server in this CLI'}">${on ? 'Disconnect' : 'Connect'}</button></span>`;
    $('button', row).onclick = () => {
      $('#skills').close();
      newCard('term', 'shell', { cwd: null, title: `${on ? 'Disconnect' : 'Connect'} ${PROVIDERS[key].label}`, startCmd: bridge.commands[key][on ? 'remove' : 'add'] });
      toast(on ? 'Disconnecting…' : 'Connecting… Restart the agents that were already open so they see the connection.', 5000);
    };
    box.appendChild(row);
  }

  const list = $('#boardAgentRows');
  const agents = cfg.cards.filter((c) => c.type === 'term' && agentOf(c).command && !c.startCmd);
  list.innerHTML = agents.length ? '' : '<div class="empty-note">No agents are open on the board.</div>';
  for (const c of agents) {
    const st = runtime.get(c.id)?.status || '';
    const row = document.createElement('div');
    row.className = 'hub-row';
    row.style.setProperty('--agent', agentOf(c).color);
    row.innerHTML = `
      <span class="status ${st}" title="${STATUS_LABEL[st] || ''}"></span>
      <span class="meta"><strong>${esc(c.title)}</strong><small>${esc(agentOf(c).label)} · ${esc(basename(c.cwd) || '~')}</small></span>
      <label class="switch"><input type="checkbox" ${c.bridge !== false ? 'checked' : ''}/> accepts messages</label>
      <span class="acts"><button type="button" title="Go to this agent's card">Go</button></span>`;
    $('input', row).onchange = (e) => { c.bridge = e.target.checked; save(); };
    $('button', row).onclick = () => { $('#skills').close(); focusCardView(c); focusCard(c.id); };
    list.appendChild(row);
  }
}

$('#skillsBtn').onclick = () => openSkills();
$('#selClose').onclick = () => closeMany('selected');
$('#selNone').onclick = clearSelection;
$('#skillsRefresh').onclick = refreshSkills;
$('#skills .tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) showTab(t); });
// Enter in a field must not close the dialog (it is a <form method="dialog">).
$('#skillsForm').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); });
