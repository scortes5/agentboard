// AgentBoard — GitHub issues as tasks: lists the open issues of the project chosen in the
// Tasks panel (through the gh CLI) and queues the ones you pick. The agent gets the issue's
// text, and the pull request made from the task says "Closes #n".
'use strict';
/* global $, ab, esc, cfg, tasks, addTask, composerDefaults, tickTasks, toast, openPopover, closePopover, basename */

class IssueImporter {
  constructor() {
    $('#taskIssues').onclick = (e) => this.open(e.currentTarget);
  }

  static imported(cwd) {
    return new Set(tasks().filter((t) => t.issue && t.cwd === cwd).map((t) => t.issue.number));
  }

  async open(anchor) {
    const d = composerDefaults();
    if (!d.cwd) return toast('Choose a project in the Tasks panel first.');
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'popover issues';
    pop.innerHTML = '<div class="hint">Loading issues…</div>';
    openPopover(pop, anchor, 380);
    const r = await ab.githubIssues(d.cwd);
    if (!pop.isConnected) return;
    if (!r.ok) { pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`; return; }
    const done = IssueImporter.imported(d.cwd);
    const list = r.value.filter((i) => !done.has(i.number));
    const proj = cfg.projects.find((p) => p.path === d.cwd)?.name || basename(d.cwd);
    if (!list.length) { pop.innerHTML = `<div class="hint">No open issues to import in ${esc(proj)}.</div>`; return; }
    pop.innerHTML = `<div class="ap-head"><b>Open issues · ${esc(proj)}</b></div>
      <div class="is-list">${list.map((i) => `<label class="is-item"><input type="checkbox" value="${i.number}" />
        <span><b>#${i.number}</b> ${esc(i.title)}${i.labels.length ? ` <span class="muted small">${esc(i.labels.join(', '))}</span>` : ''}</span></label>`).join('')}</div>
      <div class="row"><span class="spacer"></span><button data-add class="primary" disabled>Add as Tasks</button></div>`;
    const add = pop.querySelector('[data-add]');
    pop.addEventListener('change', () => {
      const n = pop.querySelectorAll('input:checked').length;
      add.disabled = !n;
      add.textContent = n ? `Add ${n} Task${n === 1 ? '' : 's'}` : 'Add as Tasks';
    });
    add.onclick = () => {
      const picked = new Set([...pop.querySelectorAll('input:checked')].map((x) => +x.value));
      this.add(list.filter((i) => picked.has(i.number)), d);
      closePopover();
    };
  }

  add(issues, d) {
    for (const i of issues) {
      addTask({ text: `#${i.number} ${i.title}`, agent: d.agent, cwd: d.cwd, light: d.light, issue: { number: i.number, title: i.title, url: i.url, body: i.body } });
    }
    toast(`${issues.length} issue${issues.length === 1 ? '' : 's'} queued as tasks.`);
    tickTasks();
  }
}

const issueImporter = new IssueImporter();
