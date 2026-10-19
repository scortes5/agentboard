// AgentBoard — a card's options menu: name, agent, project, arguments, duplicate.
'use strict';

// ---------- Edit card ----------
function editMenu(c, anchor) {
  closePopover();
  const isTerm = c.type === 'term';
  const projects = [...cfg.projects];
  if (isTerm && c.cwd && !projects.some((p) => p.path === c.cwd)) projects.push({ path: c.cwd, name: basename(c.cwd) });

  const pop = document.createElement('div');
  pop.className = 'popover edit';
  pop.innerHTML = `
    <label>Name <input name="title" value="${esc(c.title)}" /></label>
    ${isTerm ? `
      <label>Agent <select name="agent">${Object.entries(cfg.agents).map(([k, a]) =>
        `<option value="${esc(k)}" ${k === c.agent ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}</select></label>
      <label>Project <select name="cwd"><option value="" ${c.cwd ? '' : 'selected'}>Home folder (~)</option>${projects.map((p) =>
        `<option value="${esc(p.path)}" ${p.path === c.cwd ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label>Extra arguments <input name="args" value="${esc(c.args || '')}" placeholder="e.g. --model opus" /></label>
      ${agentOf(c).lightArgs ? `<label class="switch" title="Adds ${esc(agentOf(c).lightArgs)} to the arguments"><input type="checkbox" name="light" ${c.args && c.args.includes(agentOf(c).lightArgs) ? 'checked' : ''} /> Saving mode (cheaper model)</label>` : ''}
      ${agentOf(c).command ? `<label class="switch"><input type="checkbox" name="bridge" ${c.bridge !== false ? 'checked' : ''} /> Other agents can message it</label>` : ''}
      <div class="hint"></div>` : ''}
    <div class="row">
      ${isTerm ? '<button data-x="handoff" title="Send the selection or the last lines to another agent, with an instruction">Send to…</button>' : ''}
      <button data-x="dup" title="Create a copy of this card next to it">Duplicate</button>
      <button data-x="cancel">Cancel</button>
      <button data-x="ok" class="primary">Apply</button>
    </div>`;
  openPopover(pop, anchor, 280);

  const field = (n) => pop.querySelector(`[name=${n}]`);
  const draft = () => ({ agent: field('agent').value, cwd: field('cwd').value || null, args: field('args').value.trim() });
  const changed = (d) => d.agent !== c.agent || d.cwd !== c.cwd || d.args !== (c.args || '');
  const updateHint = () => {
    if (!isTerm) return;
    const d = draft();
    const cmd = commandFor({ ...c, ...d, startCmd: changed(d) ? '' : c.startCmd }, false) || '(shell only)';
    $('.hint', pop).innerHTML = `Command: <code>${esc(cmd)}</code>${changed(d) ? '<br/>Applying restarts the agent.' : ''}`;
  };
  pop.addEventListener('input', (e) => {
    if (e.target.name === 'light') {
      const la = (cfg.agents[field('agent').value] || {}).lightArgs || '';
      const rest = field('args').value.replace(la, '').trim();
      field('args').value = e.target.checked ? [la, rest].filter(Boolean).join(' ') : rest;
    }
    if (e.target.name !== 'bridge') updateHint();
  });
  updateHint();

  const apply = () => {
    let title = field('title').value.trim() || c.title;
    let restart = false;
    if (isTerm) {
      const d = draft();
      restart = changed(d);
      if (restart) {
        // if it had the default name, follow the new agent
        if (title === agentOf(c).label && d.agent !== c.agent) title = cfg.agents[d.agent].label;
        const newSession = d.agent !== c.agent || d.cwd !== c.cwd;
        Object.assign(c, d, { startCmd: '' });
        if (!isClaude(agentOf(c))) { delete c.sessionId; delete c.sessionUsed; }
        else if (newSession || !c.sessionId) { c.sessionId = newSessionId(); c.sessionUsed = false; }
      }
      if (field('bridge')) c.bridge = field('bridge').checked;
    }
    c.title = title;
    closePopover();
    refreshCardHead(c);
    save(); renderSidebar(); refreshGit();
    if (restart) restartCard(c);
  };

  pop.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'ok') apply();
    else if (x === 'cancel') closePopover();
    else if (x === 'dup') { closePopover(); duplicateCard(c); }
    else if (x === 'handoff') { closePopover(); handoffMenu(c, anchor); }
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); apply(); }
  });
  field('title').focus();
  field('title').select();
}

function refreshCardHead(c) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  $('.title', rt.el).textContent = c.title;
  if (c.type !== 'term') return;
  const a = agentOf(c);
  rt.el.style.setProperty('--agent', a.color);
  const proj = $('.proj', rt.el);
  proj.textContent = basename(c.cwd) || '~';
  proj.title = c.cwd || 'Home folder';
  if (rt.term) rt.term.options.theme = termTheme(c);
}
