// AgentBoard — every branch of a project at a glance: which ones are being worked on (a task's
// worktree, an agent card on it, commits ahead of the main branch), their last commit, and
// whether they are pushed. Opened from the Tasks panel (chosen project) or a card's git pill.
'use strict';
/* global $, ab, esc, cfg, fmt, icon, tasks, gitCache, runtime, agentOf, composerDefaults, toast, openPopover, closePopover,
   basename, focusCard, focusCardView, cardData, refreshGit */

const TASK_STATE = { pending: 'queued', running: 'running', review: 'to review', done: 'done', blocked: 'blocked' };

class BranchOverview {
  constructor() {
    $('#taskBranches').onclick = (e) => {
      const { cwd } = composerDefaults();
      if (!cwd) return toast('Choose a project in the Tasks panel first.');
      this.open(cwd, e.currentTarget);
    };
    this.query = '';
  }

  // Tasks and agent cards on each branch of the repository at `top`.
  static work(top, branches) {
    const inRepo = (dir) => !!dir && (dir === top || dir.startsWith(top + '/') || dir.startsWith(top + '\\'));
    const byBranch = Object.fromEntries(branches.map((b) => [b.name, { tasks: [], cards: [] }]));
    for (const t of tasks()) {
      if (t.branch && byBranch[t.branch] && !t.mergedInto) byBranch[t.branch].tasks.push(t);
    }
    for (const c of cfg.cards) {
      if (c.type !== 'term' || !inRepo(c.cwd)) continue;
      const b = gitCache[c.cwd]?.branch;
      if (b && byBranch[b]) byBranch[b].cards.push(c);
    }
    return byBranch;
  }

  // Branches with something going on first, then the rest by their last commit.
  static active(b, w, base) {
    return b.name !== base && (w.tasks.some((t) => t.status !== 'done') || w.cards.length > 0 || !!b.worktree || b.aheadBase > 0);
  }

  static row(b, w, ctx) {
    const isCurrent = b.name === ctx.current;
    const chips = [
      isCurrent ? '<span class="br-chip accent" title="Checked out in the project folder">current</span>' : '',
      b.name === ctx.base ? '<span class="br-chip" title="The branch others are compared with">base</span>' : '',
      b.worktree && b.worktree !== ctx.top ? `<span class="br-chip" title="Checked out in its own worktree: ${esc(b.worktree)}">${icon('folder', 10)} worktree</span>` : '',
      !b.upstream ? '<span class="br-chip muted" title="This branch has no remote branch: it is only on this computer">local only</span>'
        : b.gone ? `<span class="br-chip warn" title="${esc(b.upstream)} was deleted on the remote">remote gone</span>`
        : b.ahead || b.behind ? `<span class="br-chip warn" title="Compared with ${esc(b.upstream)}">${b.ahead ? `${b.ahead} to push` : ''}${b.ahead && b.behind ? ' · ' : ''}${b.behind ? `${b.behind} to pull` : ''}</span>` : '',
    ].join('');
    const vsBase = b.name === ctx.base ? '' : `<span class="br-ab" title="Commits ahead of and behind ${esc(ctx.base)}"><b class="${b.aheadBase ? 'ok' : ''}">+${b.aheadBase}</b> <b class="${b.behindBase ? 'warn' : ''}">−${b.behindBase}</b></span>`;
    const work = [
      ...w.tasks.map((t) => `<span class="br-work task st-${esc(t.status)}" title="Task: ${esc(t.text.slice(0, 200))}">${icon('tasks', 11)} ${esc(t.text.slice(0, 48))}<em>${esc(TASK_STATE[t.status] || t.status)}</em></span>`),
      ...w.cards.map((c) => `<button type="button" class="br-work br-card" data-card="${esc(c.id)}" title="Show this card on the board">${icon('terminal', 11)} ${esc(c.title || agentOf(c)?.label || 'Terminal')}</button>`),
    ].join('');
    const canSwitch = !isCurrent && !b.worktree;
    return `<div class="br-item${isCurrent ? ' current' : ''}" data-b="${esc(b.name)}">
      <div class="br-top">${icon('branch', 13)}<span class="br-name" title="${esc(b.name)}">${esc(b.name)}</span>${chips}<span class="spacer"></span>${vsBase}</div>
      <div class="br-commit"><span class="mono">${esc(b.sha)}</span> <span class="br-subject" title="${esc(b.subject)}">${esc(b.subject || '(no message)')}</span></div>
      <div class="br-meta"><span>${esc(b.author)}</span><span class="sep">·</span><span title="${esc(new Date(b.at).toLocaleString())}">${esc(fmt.ago(b.at))}</span>
        <span class="spacer"></span>
        <button type="button" class="card-btn" data-copy title="Copy the branch name">${icon('copy', 12)}</button>
        ${canSwitch ? `<button type="button" class="card-btn" data-switch title="Check out this branch in the project folder">Switch</button>` : ''}</div>
      ${work ? `<div class="br-works">${work}</div>` : ''}
    </div>`;
  }

  async open(cwd, anchor) {
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'popover branches';
    pop.innerHTML = '<div class="hint">Reading branches…</div>';
    openPopover(pop, anchor, 500);
    const r = await ab.gitOverview(cwd);
    if (!pop.isConnected) return;
    if (!r.ok) { pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`; return; }
    const { top, base, current, branches } = r.value;
    const proj = cfg.projects.find((p) => p.path === cwd || p.path === top)?.name || basename(top);
    const work = BranchOverview.work(top, branches);
    const ctx = { top, base, current };
    const live = branches.filter((b) => BranchOverview.active(b, work[b.name], base));
    const rest = branches.filter((b) => !live.includes(b));
    pop.innerHTML = `<div class="is-head"><b>Branches</b><span class="muted">${esc(proj)}</span><span class="spacer"></span>
        <span class="muted small">compared with <span class="mono">${esc(base)}</span></span><span class="badge">${branches.length}</span></div>
      <input class="is-search" type="search" placeholder="Filter by name, commit or author" value="${esc(this.query)}" title="Filter the branches" />
      <div class="br-list"></div>`;
    const box = pop.querySelector('.br-list');
    const draw = () => {
      const q = this.query.toLowerCase();
      const hit = (b) => !q || b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
      const section = (title, hint, list) => (list.length ? `<div class="br-section" title="${esc(hint)}">${esc(title)} <span>${list.length}</span></div>${list.map((b) => BranchOverview.row(b, work[b.name], ctx)).join('')}` : '');
      box.innerHTML = section('In progress', 'Branches with a task, an agent card, a worktree or commits not yet in the base branch', live.filter(hit))
        + section('Other branches', 'Everything else, most recent commit first', rest.filter(hit))
        || '<div class="hint">No branch matches this filter.</div>';
    };
    draw();
    pop.querySelector('.is-search').addEventListener('input', (e) => { this.query = e.target.value.trim(); draw(); });
    pop.addEventListener('click', async (e) => {
      const name = e.target.closest('[data-b]')?.dataset.b;
      const card = e.target.closest('[data-card]')?.dataset.card;
      if (card) {
        const c = cardData(card);
        if (c) { closePopover(); focusCardView(c); focusCard(c.id); }
        return;
      }
      if (!name) return;
      if (e.target.closest('[data-copy]')) { ab.copy(name); toast(`Copied <b>${esc(name)}</b>`); return; }
      if (e.target.closest('[data-switch]')) {
        closePopover();
        if (await ab.gitCheckout(top, name, false)) toast(`Switched ${esc(proj)} to <b>${esc(name)}</b>`);
        else toast(`Could not switch to "${esc(name)}". Commit or stash the uncommitted changes first.`, 6000);
        refreshGit();
      }
    });
  }
}

const branchOverview = new BranchOverview();
