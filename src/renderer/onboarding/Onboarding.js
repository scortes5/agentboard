// AgentBoard — first-run wizard: which agent CLIs you have, your first project, connecting the
// agents, ground rules and a first task. Shown once on a new board; the palette opens it again.
// Each step is an object in `steps` ({ id, title, render(el) }), so a new step is a new entry.
'use strict';
/* global $, ab, cfg, esc, toast, save, newCard, addProject, openTasks, groundRules, SUGGESTED_RULES */

const SAMPLE_TASK = 'Explain in a few lines what this project does and suggest three small improvements !';

class Onboarding {
  constructor() {
    this.dlg = $('#onboarding');
    this.at = 0;
    this.steps = [
      { id: 'agents', title: 'Your agents', render: (el) => this.agents(el) },
      { id: 'project', title: 'Your first project', render: (el) => this.project(el) },
      { id: 'connect', title: 'Connect them', render: (el) => this.connect(el) },
      { id: 'rules', title: 'Ground rules', render: (el) => this.rules(el) },
      { id: 'task', title: 'A first task', render: (el) => this.task(el) },
    ];
    $('#obBack').onclick = () => this.go(this.at - 1);
    $('#obNext').onclick = () => (this.at === this.steps.length - 1 ? this.finish() : this.go(this.at + 1));
    $('#obSkip').onclick = () => this.finish();
    this.dlg.addEventListener('cancel', () => this.finish());
  }

  // A new board (no projects, no cards) gets the wizard; boards from older versions do not.
  maybeShow() {
    if (cfg.onboarded) return;
    if (cfg.projects.length || cfg.cards.length) { cfg.onboarded = true; save(); return; }
    this.open();
  }

  open() {
    this.dlg.showModal();
    this.go(0);
  }

  finish() {
    cfg.onboarded = true;
    save();
    if (this.dlg.open) this.dlg.close();
  }

  go(i) {
    this.at = Math.max(0, Math.min(this.steps.length - 1, i));
    const step = this.steps[this.at];
    $('#obDots').innerHTML = this.steps.map((s, n) => `<span class="${n === this.at ? 'on' : n < this.at ? 'done' : ''}" title="${esc(s.title)}"></span>`).join('');
    $('#obTitle').textContent = step.title;
    $('#obBack').disabled = this.at === 0;
    $('#obNext').textContent = this.at === this.steps.length - 1 ? 'Finish' : 'Next';
    const body = $('#obBody');
    body.innerHTML = '';
    body.dataset.step = step.id;
    step.render(body);
  }

  // A terminal on the board running a command (installing, signing in, connecting).
  static run(title, cmd) {
    newCard('term', 'shell', { cwd: null, title, startCmd: cmd });
    toast(`${esc(title)}: running in a terminal on the board.`, 4000);
  }

  async agents(el) {
    el.innerHTML = '<p class="muted">Looking for the agent CLIs on this computer…</p>';
    const list = await ab.catalogStatus();
    if (!el.isConnected || el.dataset.step !== 'agents') return;
    const have = list.filter((a) => a.installed);
    el.innerHTML = `<p>AgentBoard runs the coding agents you already pay for, each in its own terminal. ${have.length
      ? `Found <b>${have.length}</b>: you can start right away.` : 'None found yet: install at least one.'}</p>
      <div class="ob-list">${list.map((a) => `<div class="ob-row" data-key="${esc(a.key)}">
        <span class="dot" style="background:${esc(a.color)}"></span><span class="meta"><b>${esc(a.label)}</b><small>${esc(a.plan)}</small></span>
        ${!a.installed ? `<button type="button" class="ghost" data-install title="${esc(a.install)}">Install</button>`
          : a.loggedIn === false ? '<button type="button" class="ghost" data-login>Sign In</button>'
            : '<span class="badge ok">Ready</span>'}</div>`).join('')}</div>`;
    el.onclick = (e) => {
      const a = list.find((x) => x.key === e.target.closest('.ob-row')?.dataset.key);
      if (!a) return;
      if (e.target.closest('[data-install]')) Onboarding.run(`Install ${a.label}`, a.install);
      if (e.target.closest('[data-login]')) Onboarding.run(`Sign in to ${a.label}`, a.login);
    };
  }

  project(el) {
    const render = () => {
      el.innerHTML = `<p>A project is a folder with your code. Each one gets a tab, and its agents keep working while you look at another.</p>
        ${cfg.projects.length ? `<div class="ob-list">${cfg.projects.map((p) => `<div class="ob-row"><span class="meta"><b>${esc(p.name)}</b><small>${esc(p.path)}</small></span><span class="badge ok">Added</span></div>`).join('')}</div>` : ''}
        <button type="button" class="primary" data-add>${cfg.projects.length ? 'Add Another Project…' : 'Choose a Folder…'}</button>`;
    };
    render();
    el.onclick = async (e) => { if (e.target.closest('[data-add]') && await addProject()) render(); };
  }

  async connect(el) {
    el.innerHTML = `<p>Two optional extras for the agents you have:</p>
      <div class="ob-list">
        <div class="ob-row"><span class="meta"><b>Agent Connection</b><small>Agents see each other, send each other messages and open helpers you can see on the board.</small></span><button type="button" class="ghost" data-connect>Connect</button></div>
        <div class="ob-row"><span class="meta"><b>Token-saving skills</b><small>Short instructions that make each subscription spend fewer tokens on tasks.</small></span><button type="button" class="ghost" data-pack>Install</button></div>
      </div>`;
    el.onclick = async (e) => {
      if (e.target.closest('[data-connect]')) {
        const [bridge, list] = await Promise.all([ab.bridgeStatus(), ab.catalogStatus()]);
        const cmds = list.filter((a) => a.installed && bridge.commands[a.key] && !bridge.connected[a.key]).map((a) => bridge.commands[a.key].add);
        if (!cmds.length) return toast('Every installed agent is already connected.');
        Onboarding.run('Connect the agents', cmds.join(' ; '));
        e.target.closest('button').disabled = true;
      }
      if (e.target.closest('[data-pack]')) {
        const list = await ab.catalogStatus();
        const r = await ab.packInstall(list.filter((a) => a.installed).map((a) => a.key));
        toast(r.ok ? 'Token-saving skills installed.' : `Could not install them: ${esc(r.error)}`);
        if (r.ok) e.target.closest('button').disabled = true;
      }
    };
  }

  rules(el) {
    el.innerHTML = `<p>Rules every agent follows, so you don't repeat them in each task. They go into each CLI's own instructions file; change them later in <b>Settings → Ground Rules</b>.</p>
      <textarea id="obRules" rows="8" spellcheck="false"></textarea>
      <div class="row-end"><button type="button" class="primary" data-save>Save Rules</button></div>`;
    $('#obRules').value = cfg.groundRules || SUGGESTED_RULES;
    el.onclick = async (e) => {
      if (!e.target.closest('[data-save]')) return;
      cfg.groundRules = $('#obRules').value.trim();
      save();
      await groundRules.saved();
      toast('Ground rules saved.');
    };
  }

  task(el) {
    el.innerHTML = `<p>Write to-dos in <b>Tasks</b> (${keyLabel('⇧⌘T')}), one per line. They are spread across your subscriptions and run in parallel, each in its own terminal; you see their progress live and review the changes before keeping them.</p>
      <p class="muted small"><code>@claude</code> picks who does it · <code>!</code> uses a cheaper model · <code>&gt;</code> waits for the line above</p>
      <button type="button" class="primary" data-try>Try a Sample Task</button>`;
    el.onclick = (e) => {
      if (!e.target.closest('[data-try]')) return;
      this.finish();
      openTasks(SAMPLE_TASK);
    };
  }
}

const onboarding = new Onboarding();
