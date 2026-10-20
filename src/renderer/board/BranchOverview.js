// AgentBoard — every branch of a project at a glance: which ones are being worked on (a task's
// worktree, an agent card on it, commits ahead of the main branch), their last commit, and
// whether they are pushed. Opened from the Tasks panel (chosen project) or a card's git pill.
'use strict';
/* global $, ab, esc, cfg, fmt, icon, tasks, gitCache, runtime, agentOf, composerDefaults, toast, openPopover, closePopover,
   basename, branchGraph, githubSync, focusCard, focusCardView, cardData, refreshGit */

const TASK_STATE = { pending: 'queued', running: 'running', review: 'to review', done: 'done', blocked: 'blocked' };
const CHECKS_TEXT = { passing: 'checks passing', failing: 'checks failing', pending: 'checks running', none: 'no checks' };

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
  static active(b, w, base, pr) {
    // commits ahead of the base only mean work in progress until the branch's pull request is merged or closed
    const shipped = pr?.state === 'merged' || pr?.state === 'closed';
    return b.name !== base && (w.tasks.some((t) => t.status !== 'done') || w.cards.length > 0 || !!b.worktree
      || (b.aheadBase > 0 && !shipped) || pr?.state === 'open' || pr?.state === 'draft');
  }

  // The issue a branch works on, from its name: fix/issue-12, feat/gh-12, issue_12, fix/12-title.
  static issueFromName(name) {
    const m = /(?:^|[/_-])(?:issues?|gh)[-_/]?(\d{1,7})(?!\d)/i.exec(name) || /^[\w.-]+\/(\d{1,7})(?=$|[-_])/.exec(name);
    return m ? +m[1] : null;
  }

  // Issue number -> branches working on it (by name or because their pull request closes it).
  static issueLinks(branches, prs = {}) {
    const map = {};
    const link = (n, b) => { if (n && !(map[n] ||= []).some((x) => x.branch === b)) map[n].push({ branch: b, pr: prs[b] || null }); };
    for (const b of branches) {
      link(BranchOverview.issueFromName(b.name), b.name);
      for (const n of prs[b.name]?.closes || []) link(n, b.name);
    }
    return map;
  }

  static issuesOf(name, pr) {
    return [...new Set([BranchOverview.issueFromName(name), ...(pr?.closes || [])].filter(Boolean))];
  }

  // The tasks' worktrees and the cards' folders: cleanup never touches them.
  static busyFolders() {
    return [
      ...tasks().filter((t) => t.workdir && !['done', 'blocked'].includes(t.status)).map((t) => t.workdir),
      ...cfg.cards.filter((c) => c.type === 'term' && c.cwd).map((c) => c.cwd),
    ];
  }

  // The branch's pull request and its checks, linking to GitHub.
  static prChip(pr) {
    if (!pr || !/^https:\/\/github\.com\//.test(pr.url || '')) return '';
    const c = pr.checks || {};
    const tone = pr.state === 'merged' ? 'ok' : pr.state === 'closed' ? 'muted' : c.state === 'failing' ? 'bad' : c.state === 'pending' ? 'warn' : c.state === 'passing' ? 'ok' : '';
    const checks = pr.state === 'open' || pr.state === 'draft'
      ? ` · ${CHECKS_TEXT[c.state] || ''}${c.state === 'failing' ? ` (${c.failed}/${c.total})` : ''}` : '';
    return `<a class="br-pr ${tone}" href="${esc(pr.url)}" target="_blank" title="Open pull request #${pr.number} on GitHub: ${esc(pr.title)}">${icon('external', 10)} PR #${pr.number} ${esc(pr.state)}${esc(checks)}</a>`;
  }

  static row(b, w, ctx, pr) {
    const issues = BranchOverview.issuesOf(b.name, pr);
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
      ${pr || issues.length ? `<div class="br-prs">${BranchOverview.prChip(pr)}${issues.map((n) => (ctx.repoUrl
        ? `<a class="br-pr" href="${esc(ctx.repoUrl)}/issues/${n}" target="_blank" title="Open issue #${n} on GitHub">Issue #${n}</a>`
        : `<span class="br-pr" title="This branch works on issue #${n}">Issue #${n}</span>`)).join('')}</div>` : ''}
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
    openPopover(pop, anchor, 520);
    // pull requests are optional: without gh (or offline) the view still shows the branches
    const [r, pulls] = await Promise.all([ab.gitOverview(cwd), ab.githubPulls(cwd)]);
    if (!pop.isConnected) return;
    if (!r.ok) { pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`; return; }
    const prs = pulls.ok ? pulls.value : {};
    const { top, base, current, branches, repoUrl, remoteOnly = [], fetchedAt } = r.value;
    const toPush = branches.filter((b) => b.ahead > 0 || !b.upstream || b.gone).length;
    const proj = cfg.projects.find((p) => p.path === cwd || p.path === top)?.name || basename(top);
    const work = BranchOverview.work(top, branches);
    const ctx = { top, base, current, repoUrl };
    const live = branches.filter((b) => BranchOverview.active(b, work[b.name], base, prs[b.name]));
    const rest = branches.filter((b) => !live.includes(b));
    pop.innerHTML = `<div class="is-head"><b>Branches</b><span class="muted">${esc(proj)}</span><span class="spacer"></span>
        <span class="muted small">compared with <span class="mono">${esc(base)}</span></span><span class="badge">${branches.length}</span></div>
      <div class="br-tools">
        <button type="button" data-pull title="Fetch from GitHub and fast-forward every local branch that is behind; branches with local commits are left alone">${icon('down', 12)} Pull All</button>
        <button type="button" data-push title="Push local branches to GitHub; you pick which">${icon('up', 12)} Push${toPush ? ` <span class="br-n">${toPush}</span>` : ''}</button>
        <span class="br-synced muted small" title="${fetchedAt ? esc(new Date(fetchedAt).toLocaleString()) : 'Never fetched from GitHub'}">${fetchedAt ? `synced ${esc(fmt.ago(fetchedAt))}` : 'never synced'}</span>
        <label class="br-auto" title="Every ${githubSync.minutes} minutes, fetch from GitHub and fast-forward the branches that are not checked out, for every project"><input type="checkbox" data-auto ${githubSync.enabled() ? 'checked' : ''}/> Auto</label>
        <span class="spacer"></span>
        <button type="button" data-graph title="Graph: every branch as colored lines, where they split, where they merge, and each commit">${icon('diagram', 12)} Graph</button>
        <button type="button" class="icon" data-cleanup title="Clean up: delete branches already merged and task worktrees no task uses; you pick which">${icon('trash', 12)}</button></div>
      <input class="is-search" type="search" placeholder="Filter by name, commit or author" value="${esc(this.query)}" title="Filter the branches" />
      <div class="br-list"></div>
      ${pulls.ok ? '' : `<div class="br-foot muted small" title="${esc(pulls.error)}">Pull requests are not shown: ${esc(pulls.error)}</div>`}`;
    const box = pop.querySelector('.br-list');
    const draw = () => {
      const q = this.query.toLowerCase();
      const hit = (b) => !q || b.name.toLowerCase().includes(q) || b.subject.toLowerCase().includes(q) || b.author.toLowerCase().includes(q);
      const section = (title, hint, list) => (list.length ? `<div class="br-section" title="${esc(hint)}">${esc(title)} <span>${list.length}</span></div>${list.map((b) => BranchOverview.row(b, work[b.name], ctx, prs[b.name])).join('')}` : '');
      const remote = remoteOnly.filter((x) => !q || x.name.toLowerCase().includes(q) || x.subject.toLowerCase().includes(q));
      box.innerHTML = section('In progress', 'Branches with a task, an agent card, a worktree or commits not yet in the base branch', live.filter(hit))
        + section('Other branches', 'Everything else, most recent commit first', rest.filter(hit))
        + (remote.length ? `<div class="br-section" title="Branches on GitHub that have no local branch">Only on GitHub <span>${remote.length}</span></div>${remote.map((x) => `<div class="br-item remote">
            <div class="br-top">${icon('branch', 13)}<span class="br-name" title="${esc(x.ref)}">${esc(x.name)}</span><span class="spacer"></span>
              <button type="button" class="card-btn" data-track="${esc(x.name)}" title="Create a local branch that follows ${esc(x.ref)} (does not switch to it)">${icon('down', 12)} Track</button></div>
            <div class="br-commit"><span class="br-subject" title="${esc(x.subject)}">${esc(x.subject)}</span></div>
            <div class="br-meta"><span>${esc(x.author)}</span><span class="sep">·</span><span>${esc(fmt.ago(x.at))}</span></div></div>`).join('')}` : '')
        || '<div class="hint">No branch matches this filter.</div>';
    };
    draw();
    pop.querySelector('.is-search').addEventListener('input', (e) => { this.query = e.target.value.trim(); draw(); });
    pop.querySelector('[data-auto]').addEventListener('change', (e) => githubSync.setEnabled(e.target.checked));
    pop.addEventListener('click', async (e) => {
      if (e.target.closest('[data-graph]')) { closePopover(); branchGraph.open(cwd); return; }
      const pullBtn = e.target.closest('[data-pull]');
      if (pullBtn) { pullBtn.disabled = true; pullBtn.lastChild.textContent = ' Pulling…'; await githubSync.pullNow(top); this.open(cwd, anchor); return; }
      if (e.target.closest('[data-push]')) { this.pushPicker(pop, cwd, anchor, branches, current); return; }
      const tr = e.target.closest('[data-track]');
      if (tr) {
        const res = await ab.gitTrack(top, tr.dataset.track);
        toast(res.ok ? `Created the local branch <b>${esc(tr.dataset.track)}</b>, following GitHub.` : `Could not track it: ${esc(res.error)}`, res.ok ? 4000 : 6000);
        if (res.ok) this.open(cwd, anchor);
        return;
      }
      if (e.target.closest('[data-cleanup]')) { this.cleanup(pop, cwd, anchor); return; }
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

// Push, in the same popover: branches with commits GitHub does not have are picked; branches
// that only exist here are listed unpicked (pushing publishes them).
BranchOverview.prototype.pushPicker = function pushPicker(pop, cwd, anchor, branches, current) {
  const ahead = branches.filter((b) => b.upstream && !b.gone && b.ahead > 0);
  const local = branches.filter((b) => !b.upstream || b.gone);
  const item = (b, checked, sub) => `<label class="cl-item"><input type="checkbox" data-pushb value="${esc(b.name)}" ${checked ? 'checked' : ''}/>
    <span><span class="br-name">${esc(b.name)}${b.name === current ? ' <em class="muted small">current</em>' : ''}</span><span class="cl-sub">${sub}</span></span></label>`;
  const body = [
    ahead.length ? `<div class="br-section">Commits to push <span>${ahead.length}</span></div>${ahead.map((b) => item(b, true, `${b.ahead} commit${b.ahead === 1 ? '' : 's'} not on ${esc(b.upstream)}${b.behind ? ` · also ${b.behind} behind: pull it first` : ''}`)).join('')}` : '',
    local.length ? `<div class="br-section">Only on this computer <span>${local.length}</span></div>${local.map((b) => item(b, false, b.gone ? 'its GitHub branch was deleted: pushing creates it again' : `${esc(b.subject)} · ${esc(fmt.ago(b.at))}`)).join('')}` : '',
  ].join('');
  pop.innerHTML = `<div class="is-head"><b>Push to GitHub</b><span class="muted">pick the branches to push</span></div>
    <div class="br-list">${body || '<div class="hint">Everything is already on GitHub.</div>'}</div>
    <div class="is-foot"><button type="button" data-back title="Back to the branches">Back</button><span class="spacer"></span>
      ${body ? '<button type="button" class="primary" data-go title="Push the selected branches to GitHub (never forced)">Push</button>' : ''}</div>`;
  const go = pop.querySelector('[data-go]');
  const picked = () => [...pop.querySelectorAll('[data-pushb]:checked')].map((x) => x.value);
  const sync = () => { if (!go) return; const n = picked().length; go.disabled = !n; go.textContent = n ? `Push ${n}` : 'Push'; };
  sync();
  pop.addEventListener('change', sync);
  pop.querySelector('[data-back]').onclick = () => this.open(cwd, anchor);
  if (go) go.onclick = async () => {
    const names = picked();
    if (!confirm(`Push ${names.length} branch${names.length === 1 ? '' : 'es'} to GitHub?\n\n${names.join('\n')}`)) return;
    go.disabled = true; go.textContent = 'Pushing…';
    const res = await ab.gitPush(cwd, names);
    if (!res.ok) toast(`Could not push: ${esc(res.error)}`, 7000);
    else {
      const { pushed, failed } = res.value;
      toast(`${pushed.length ? `Pushed ${pushed.map((n) => `<b>${esc(n)}</b>`).join(', ')}.` : 'Nothing was pushed.'}${failed.length ? ` Not pushed: ${failed.map((f) => `${esc(f.name)} (${esc(f.why)})`).join('; ')}` : ''}`, failed.length ? 9000 : 4500);
    }
    refreshGit();
    this.open(cwd, anchor);
  };
};

// Cleanup, in the same popover: what can go, picked by you, confirmed, then the list again.
BranchOverview.prototype.cleanup = async function cleanup(pop, cwd, anchor) {
  pop.innerHTML = '<div class="hint">Looking for merged branches and unused worktrees…</div>';
  const busy = BranchOverview.busyFolders();
  const r = await ab.gitCleanupCandidates(cwd, busy);
  if (!pop.isConnected) return;
  if (!r.ok) { pop.innerHTML = `<div class="hint">${esc(r.error)}</div>`; return; }
  const { base, branches, worktrees } = r.value;
  const item = (kind, value, checked, label, sub, disabled = false) => `<label class="cl-item${disabled ? ' off' : ''}"><input type="checkbox" data-${kind} value="${esc(value)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/>
    <span><span class="br-name">${esc(label)}</span><span class="cl-sub">${sub}</span></span></label>`;
  const body = [
    branches.length ? `<div class="br-section">Merged branches <span>${branches.length}</span></div>${branches.map((b) => item('branch', b.name, true, b.name,
      `${b.how === 'merged' ? `merged into ${esc(base)}` : `pull request #${b.pr} merged`} · ${esc(fmt.ago(b.at))} · ${esc(b.subject)}`)).join('')}` : '',
    worktrees.length ? `<div class="br-section">Task worktrees no task uses <span>${worktrees.length}</span></div>${worktrees.map((w) => item('tree', w.dir, w.removable, w.branch,
      w.removable ? esc(w.dir) : `kept: ${esc(w.reason)}`, !w.removable)).join('')}` : '',
  ].join('');
  pop.innerHTML = `<div class="is-head"><b>Clean Up</b><span class="muted">compared with <span class="mono">${esc(base)}</span></span></div>
    <div class="br-list">${body || '<div class="hint">Nothing to clean up: no merged branches and no unused task worktrees.</div>'}</div>
    <div class="is-foot"><button type="button" data-back title="Back to the branches">Back</button><span class="spacer"></span>
      ${body ? '<button type="button" class="primary" data-go title="Delete the selected branches and worktrees">Delete</button>' : ''}</div>`;
  const go = pop.querySelector('[data-go]');
  const picked = () => ({
    branches: [...pop.querySelectorAll('[data-branch]:checked')].map((x) => x.value),
    worktrees: [...pop.querySelectorAll('[data-tree]:checked')].map((x) => x.value),
  });
  const sync = () => { if (!go) return; const p = picked(); const n = p.branches.length + p.worktrees.length; go.disabled = !n; go.textContent = n ? `Delete ${n}` : 'Delete'; };
  sync();
  pop.addEventListener('change', sync);
  pop.querySelector('[data-back]').onclick = () => this.open(cwd, anchor);
  if (go) go.onclick = async () => {
    const p = picked();
    if (!confirm(`Delete ${p.branches.length} branch${p.branches.length === 1 ? '' : 'es'} and ${p.worktrees.length} worktree${p.worktrees.length === 1 ? '' : 's'}? `
      + 'They are merged or have no work of their own, and git keeps their commits for a while, but this cannot be undone from AgentBoard.')) return;
    go.disabled = true; go.textContent = 'Deleting…';
    const res = await ab.gitCleanup(cwd, p, busy);
    if (!res.ok) { toast(`Could not clean up: ${esc(res.error)}`, 6000); return this.open(cwd, anchor); }
    const { branches: b, worktrees: w, errors } = res.value;
    toast(`Deleted ${b.length} branch${b.length === 1 ? '' : 'es'} and ${w.length} worktree${w.length === 1 ? '' : 's'}.${errors.length ? ` Not deleted: ${esc(errors.join('; '))}` : ''}`, errors.length ? 8000 : 4500);
    refreshGit();
    this.open(cwd, anchor);
  };
};

const branchOverview = new BranchOverview();
