// AgentBoard — GitHub issues as tasks: lists the open issues of the project chosen in the
// Tasks panel (through the gh CLI) and queues the ones you pick. The agent gets the issue's
// text, marked as a description to read and not instructions to follow, and the pull request
// made from the task says "Closes #n". Issues from people outside the project are flagged and
// their text is shown before you queue them: anyone can open an issue on a public repo.
'use strict';
/* global $, ab, esc, cfg, fmt, icon, tasks, addTask, composerDefaults, tickTasks, toast, openPopover, closePopover, basename,
   toggleFlows, flowTemplates, BranchOverview */

class IssueImporter {
  constructor() {
    $('#taskIssues').onclick = (e) => this.open(e.currentTarget);
    this.query = '';
    this.label = '';
  }

  static imported(cwd) {
    return new Set(tasks().filter((t) => t.issue && t.cwd === cwd).map((t) => t.issue.number));
  }

  // The labels used most, for the filter row.
  static topLabels(list, max = 6) {
    const n = {};
    for (const i of list) for (const l of i.labels) n[l] = (n[l] || 0) + 1;
    return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b)).slice(0, max);
  }

  static matches(i, query, label) {
    if (label && !i.labels.includes(label)) return false;
    if (!query) return true;
    const q = query.toLowerCase().replace(/^#/, '');
    return String(i.number).startsWith(q) || i.title.toLowerCase().includes(q) || i.labels.some((l) => l.toLowerCase().includes(q)) || i.author.toLowerCase().includes(q);
  }

  static labelChip(i, l) {
    const c = i.labelColors?.[l];
    return `<span class="is-label" title="Label: ${esc(l)}">${c ? `<i style="background:#${esc(c)}"></i>` : '<i></i>'}${esc(l)}</span>`;
  }

  // The branches (and their pull requests) already working on an issue.
  static workChips(links = []) {
    return links.map(({ branch, pr }) => `<span class="is-branch" title="Branch ${esc(branch)} works on this issue${pr ? `; pull request #${pr.number} is ${esc(pr.state)}` : ''}">${icon('branch', 10)} ${esc(branch)}${pr ? `<em>PR #${pr.number} ${esc(pr.state)}</em>` : ''}</span>`).join('');
  }

  static row(i, links) {
    const meta = [
      `<span class="mono">#${i.number}</span>`,
      i.createdAt ? `<span title="${esc(new Date(i.createdAt).toLocaleString())}">opened ${esc(fmt.ago(i.createdAt))}</span>` : '',
      i.author ? `<span>by ${esc(i.author)}</span>` : '',
      i.comments ? `<span title="${i.comments} comment${i.comments === 1 ? '' : 's'}">${icon('chat', 11)} ${i.comments}</span>` : '',
      i.assignees?.length ? `<span title="Assigned to ${esc(i.assignees.join(', '))}">${icon('agent', 11)} ${esc(i.assignees.join(', '))}</span>` : '',
      i.milestone ? `<span title="Milestone">${icon('bolt', 11)} ${esc(i.milestone)}</span>` : '',
    ].filter(Boolean).join('<span class="sep">·</span>');
    return `<div class="is-item${i.trusted ? '' : ' external'}" data-n="${i.number}">
      <label class="is-main"><input type="checkbox" data-issue value="${i.number}" />
        <span class="is-text">
          <span class="is-title">${esc(i.title)}</span>
          <span class="is-meta">${meta}</span>
          ${links?.length ? `<span class="is-labels">${IssueImporter.workChips(links)}</span>` : ''}
          ${i.labels.length || !i.trusted ? `<span class="is-labels">${i.trusted ? '' : `<span class="tchip warn" title="${esc(i.author)} is not a collaborator of this repository: read the text before queuing it">${icon('alert', 10)} outside contributor</span>`}${i.labels.map((l) => IssueImporter.labelChip(i, l)).join('')}</span>` : ''}
        </span></label>
      <span class="is-actions">
        <button type="button" class="card-btn" data-fix title="Create an automation that fixes this issue on its own branch, runs the checks and opens a pull request">${icon('flows', 12)}</button>
        ${i.body ? `<button type="button" class="card-btn" data-toggle title="Show or hide the text of this issue">${icon('chevron', 12)}</button>` : ''}
        ${/^https:\/\/github\.com\//.test(i.url || '') ? `<a class="card-btn" href="${esc(i.url)}" target="_blank" title="Open this issue on GitHub">${icon('external', 12)}</a>` : ''}
      </span>
      ${i.body ? `<pre class="is-body hidden">${esc(i.body.slice(0, 1500))}</pre>` : ''}
    </div>`;
  }

  async open(anchor) {
    const d = composerDefaults();
    if (!d.cwd) return toast('Choose a project in the Tasks panel first.');
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'popover issues';
    pop.innerHTML = '<div class="hint">Loading issues…</div>';
    openPopover(pop, anchor, 480);
    // branches and pull requests only add "in progress on…" chips: the list works without them
    const [r, ov, pulls] = await Promise.all([ab.githubIssues(d.cwd), ab.gitOverview(d.cwd), ab.githubPulls(d.cwd)]);
    if (!pop.isConnected) return;
    const links = ov.ok ? BranchOverview.issueLinks(ov.value.branches, pulls.ok ? pulls.value : {}) : {};
    if (!r.ok) { pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`; return; }
    const done = IssueImporter.imported(d.cwd);
    const list = r.value.filter((i) => !done.has(i.number)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const proj = cfg.projects.find((p) => p.path === d.cwd)?.name || basename(d.cwd);
    if (!list.length) {
      pop.innerHTML = `<div class="hint">No open issues to import in ${esc(proj)}${done.size ? ` (${done.size} already queued as tasks)` : ''}.</div>`;
      return;
    }
    if (this.label && !list.some((i) => i.labels.includes(this.label))) this.label = '';
    const labels = IssueImporter.topLabels(list);
    pop.innerHTML = `<div class="is-head"><b>Open issues</b><span class="muted">${esc(proj)}</span><span class="spacer"></span><span class="badge">${list.length}</span></div>
      <input class="is-search" type="search" placeholder="Filter by title, number, label or author" value="${esc(this.query)}" title="Filter the issues" />
      ${labels.length ? `<div class="is-filters"><button type="button" data-label="" title="Show every issue">All</button>${labels.map((l) => `<button type="button" data-label="${esc(l)}" title="Show only issues labeled ${esc(l)}">${esc(l)}</button>`).join('')}</div>` : ''}
      <div class="is-list"></div>
      <div class="is-foot"><label class="is-all" title="Select or clear every issue shown"><input type="checkbox" data-all /> <span>Select all</span></label>
        ${done.size ? `<span class="muted small" title="Issues already queued as tasks are hidden">${done.size} already queued</span>` : ''}
        <span class="spacer"></span><button type="button" data-add class="primary" disabled title="Queue the selected issues as tasks in this project">Add as Tasks</button></div>`;
    const box = pop.querySelector('.is-list');
    const add = pop.querySelector('[data-add]');
    const all = pop.querySelector('[data-all]');
    const picked = new Set();
    const shown = () => list.filter((i) => IssueImporter.matches(i, this.query, this.label));
    const sync = () => {
      const n = picked.size;
      add.disabled = !n;
      add.textContent = n ? `Add ${n} Task${n === 1 ? '' : 's'}` : 'Add as Tasks';
      const vis = shown();
      all.checked = vis.length > 0 && vis.every((i) => picked.has(i.number));
      all.indeterminate = !all.checked && vis.some((i) => picked.has(i.number));
    };
    const draw = () => {
      const vis = shown();
      box.innerHTML = vis.map((i) => IssueImporter.row(i, links[i.number])).join('') || '<div class="hint">No issue matches this filter.</div>';
      box.querySelectorAll('[data-issue]').forEach((x) => { x.checked = picked.has(+x.value); x.closest('.is-item').classList.toggle('picked', x.checked); });
      pop.querySelectorAll('[data-label]').forEach((b) => b.classList.toggle('active', b.dataset.label === this.label));
      sync();
    };
    draw();
    pop.querySelector('.is-search').addEventListener('input', (e) => { this.query = e.target.value.trim(); draw(); });
    pop.addEventListener('click', (e) => {
      const lb = e.target.closest('[data-label]');
      if (lb) { this.label = lb.dataset.label; draw(); return; }
      const fx = e.target.closest('[data-fix]');
      if (fx) { this.fix(list.find((i) => i.number === +fx.closest('.is-item').dataset.n), d.cwd); return; }
      const tg = e.target.closest('[data-toggle]');
      if (tg) {
        const item = tg.closest('.is-item');
        item.querySelector('.is-body')?.classList.toggle('hidden');
        item.classList.toggle('open');
      }
    });
    pop.addEventListener('change', (e) => {
      if (e.target.matches('[data-all]')) {
        for (const i of shown()) e.target.checked ? picked.add(i.number) : picked.delete(i.number);
        draw(); return;
      }
      if (!e.target.matches('[data-issue]')) return;
      e.target.checked ? picked.add(+e.target.value) : picked.delete(+e.target.value);
      e.target.closest('.is-item').classList.toggle('picked', e.target.checked);
      sync();
    });
    add.onclick = () => {
      const chosen = list.filter((i) => picked.has(i.number));
      const outside = chosen.filter((i) => !i.trusted);
      if (outside.length && !confirm(`${outside.length} of these issues ${outside.length === 1 ? 'was' : 'were'} written by people outside the project (${[...new Set(outside.map((i) => i.author))].join(', ')}). `
        + 'Their text could try to give the agent instructions. The agent is told to treat it only as a description, but read it first.\n\nQueue them?')) return;
      this.add(chosen, d);
      closePopover();
    };
  }

  // The "Fix a GitHub issue" automation, filled in for this issue and project, ready to run.
  async fix(i, cwd) {
    if (!i) return;
    if (!i.trusted && !confirm(`Issue #${i.number} was written by ${i.author}, who is outside the project. Its text could try to give the agent instructions; the agent is told to treat it only as a description, but read it first.\n\nCreate the automation?`)) return;
    closePopover();
    toggleFlows(true);
    await flowTemplates.create('fix-issue', { issue: i.number, path: cwd });
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
