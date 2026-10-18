// AgentBoard — GitHub issues as tasks: lists the open issues of the project chosen in the
// Tasks panel (through the gh CLI) and queues the ones you pick. The agent gets the issue's
// text, marked as a description to read and not instructions to follow, and the pull request
// made from the task says "Closes #n". Issues from people outside the project are flagged and
// their text is shown before you queue them: anyone can open an issue on a public repo.
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
      <div class="is-list">${list.map((i) => `<div class="is-item${i.trusted ? '' : ' external'}"><label><input type="checkbox" value="${i.number}" />
        <span><b>#${i.number}</b> ${esc(i.title)}${i.labels.length ? ` <span class="muted small">${esc(i.labels.join(', '))}</span>` : ''}
        ${i.trusted ? '' : `<span class="tchip warn" title="${esc(i.author)} is not a collaborator of this repository: read the text before queuing it">outside · ${esc(i.author)}</span>`}</span></label>
        ${i.body ? `<details><summary>Text</summary><pre>${esc(i.body.slice(0, 1500))}</pre></details>` : ''}</div>`).join('')}</div>
      <div class="row"><span class="spacer"></span><button data-add class="primary" disabled>Add as Tasks</button></div>`;
    const add = pop.querySelector('[data-add]');
    pop.addEventListener('change', () => {
      const n = pop.querySelectorAll('input:checked').length;
      add.disabled = !n;
      add.textContent = n ? `Add ${n} Task${n === 1 ? '' : 's'}` : 'Add as Tasks';
    });
    add.onclick = () => {
      const picked = new Set([...pop.querySelectorAll('input:checked')].map((x) => +x.value));
      const chosen = list.filter((i) => picked.has(i.number));
      const outside = chosen.filter((i) => !i.trusted);
      if (outside.length && !confirm(`${outside.length} of these issues ${outside.length === 1 ? 'was' : 'were'} written by people outside the project (${[...new Set(outside.map((i) => i.author))].join(', ')}). `
        + 'Their text could try to give the agent instructions. The agent is told to treat it only as a description, but read it first.\n\nQueue them?')) return;
      this.add(chosen, d);
      closePopover();
    };
  }

  add(issues, d) {
    for (const i of issues) {
      addTask({ text: `#${i.number} ${i.title}`, agent: d.agent, cwd: d.cwd, light: d.light, issue: { number: i.number, title: i.title, url: i.url, body: i.body, author: i.author, trusted: i.trusted } });
    }
    toast(`${issues.length} issue${issues.length === 1 ? '' : 's'} queued as tasks.`);
    tickTasks();
  }
}

const issueImporter = new IssueImporter();
