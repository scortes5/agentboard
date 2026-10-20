// AgentBoard — reviewing what a task changed: the full diff file by file, comments that go
// back to its agent, and the way out (merge, pull request, discard, or back to the checkpoint
// taken before the task started).
'use strict';
/* global $, esc, ab, toast, save, cardData, closeCard, runtime, renderTasks, finishTask, addTask, startTaskAgain, UnifiedDiff */

class ReviewDialog {
  constructor() {
    this.task = null;
    $('#reviewFiles').addEventListener('click', (e) => {
      const i = e.target.closest('[data-f]')?.dataset.f;
      if (i != null) $(`#df-${i}`).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    // Clicking a line quotes it in the comment box, like a line comment.
    $('#reviewDiff').addEventListener('click', (e) => {
      const l = e.target.closest('.dl[data-line]');
      if (!l) return;
      const box = $('#reviewComment');
      box.value += `${box.value && !box.value.endsWith('\n') ? '\n' : ''}${l.dataset.path}:${l.dataset.line} — `;
      box.focus();
    });
    $('#reviewSend').onclick = () => this.sendComments();
    $('#reviewMerge').onclick = () => this.merge();
    $('#reviewPR').onclick = () => this.pullRequest();
    $('#reviewDiscard').onclick = () => this.discard();
    $('#reviewRestore').onclick = () => this.restore();
  }

  hasWorktree(t = this.task) { return !!(t?.workdir && t.branch); }
  close() { if ($('#review').open) $('#review').close(); }

  async open(t) {
    this.task = t;
    const wt = this.hasWorktree(t);
    $('#reviewTitle').textContent = t.text.length > 70 ? `${t.text.slice(0, 68)}…` : t.text;
    $('#reviewMeta').textContent = t.groupBranch ? `Branch ${t.branch}, shared by group "${t.group}": the diff is the whole group's work`
      : wt ? `Worktree branch ${t.branch}` : t.checkpoint ? `Changes since the checkpoint taken when the task started (${t.checkpoint.slice(0, 8)})` : '';
    $('#reviewComment').value = '';
    $('#reviewFiles').innerHTML = '';
    $('#reviewDiff').innerHTML = '<p class="muted small">Reading the changes…</p>';
    // A group's branch belongs to all its tasks: merging or discarding it from one task would
    // pull the worktree from under the others, so only the pull request is offered.
    for (const id of ['#reviewMerge', '#reviewDiscard']) $(id).classList.toggle('hidden', !wt || !!t.groupBranch);
    $('#reviewPR').classList.toggle('hidden', !wt);
    $('#reviewRestore').classList.toggle('hidden', !t.checkpoint || wt);
    if (!$('#review').open) $('#review').showModal();
    const r = await ab.gitFullDiff({ dir: t.workdir || t.cwd, branch: wt ? t.branch : null, checkpoint: t.checkpoint });
    if (this.task !== t) return;
    if (!r.ok) { $('#reviewDiff').innerHTML = `<p class="muted small">${esc(r.error)}</p>`; return; }
    this.render(UnifiedDiff.parse(r.value.diff));
  }

  render(files) {
    $('#reviewFiles').innerHTML = files.map((f, i) => {
      const s = UnifiedDiff.stats(f);
      return `<button type="button" data-f="${i}" class="rf ${f.status}" title="${esc(f.path)}"><span class="rf-name">${esc(f.path)}</span><span class="rf-n"><i class="add">+${s.add}</i> <i class="del">−${s.del}</i></span></button>`;
    }).join('') || '<div class="hint">No changes.</div>';
    $('#reviewDiff').innerHTML = files.map((f, i) => `
      <section class="df" id="df-${i}">
        <header>${esc(f.path)} <span class="muted">${f.status}</span></header>
        ${f.lines.map((l) => `<div class="dl ${l.kind}" ${l.newNo ? `data-path="${esc(f.path)}" data-line="${l.newNo}"` : ''}><span class="no">${l.oldNo ?? ''}</span><span class="no">${l.newNo ?? ''}</span><code>${esc(l.text)}</code></div>`).join('')}
      </section>`).join('');
  }

  // Comments go back to the task's agent; if its card is gone, a new task carries them.
  async sendComments() {
    const t = this.task;
    const text = $('#reviewComment').value.trim();
    if (!t || !text) return toast('Write a comment first (click a line to quote it).');
    const msg = `Review comments on your changes for "${t.text.slice(0, 80)}":\n${text}\nAddress them, then end with a new «DONE: …» line.`;
    const c = t.cardId && cardData(t.cardId);
    if (c && runtime.get(c.id)?.alive) {
      await ab.ptyPaste(c.id, msg);
      startTaskAgain(t);
      toast(`Comments sent to <b>${esc(c.title)}</b>.`);
    } else {
      addTask({ text: `${msg}\n(Work in ${t.workdir || t.cwd})`, agent: t.assigned || 'auto', cwd: t.workdir || t.cwd, worktree: false, group: t.group });
      toast('The agent card was closed: the comments were queued as a new task.');
    }
    this.close();
  }

  async merge() {
    const t = this.task;
    const m = await ab.worktreeMerge(t.workdir, t.branch, `${t.text.slice(0, 120)}\n\nAgentBoard task`);
    if (!m.ok) return toast(esc(m.error), 8000);
    const c = t.cardId && cardData(t.cardId);
    if (c) closeCard(c);
    t.workdir = null; t.mergedInto = m.value.base;
    if (t.status !== 'done') finishTask(t, 'done', t.summary || 'Merged.');
    save(); renderTasks(); this.close();
    toast(`Merged into <b>${esc(m.value.base)}</b>`, 4000);
  }

  async pullRequest() {
    const t = this.task;
    const btn = $('#reviewPR');
    btn.disabled = true; btn.textContent = 'Pushing…';
    const body = [t.summary && `Summary: ${t.summary}`, t.review && `Review (${t.review.by}): ${t.review.text}`, t.issue && `Closes #${t.issue.number}`]
      .filter(Boolean).concat('', 'Made with AgentBoard.').join('\n');
    const r = await ab.gitPullRequest({ dir: t.workdir, branch: t.branch, title: t.text.slice(0, 120), body });
    btn.disabled = false; btn.textContent = 'Create Pull Request';
    if (!r.ok) return toast(esc(r.error), 8000);
    t.pr = r.value.url; save(); renderTasks();
    toast(r.value.created ? `Pull request created: <a href="${esc(r.value.url)}">${esc(r.value.url)}</a>` : 'Branch pushed: finish the pull request in the browser.', 7000);
  }

  async discard() {
    const t = this.task;
    if (!confirm(`Discard the work of "${t.text.slice(0, 60)}"? The worktree and the branch ${t.branch} are deleted.`)) return;
    const d = await ab.worktreeDiscard(t.workdir, t.branch);
    if (!d.ok) return toast(esc(d.error), 6000);
    t.workdir = null; t.branch = null; save(); renderTasks(); this.close();
    toast('Worktree discarded.');
  }

  // Undo a task that ran without a worktree: back to the checkpoint taken when it started.
  async restore(t = this.task) {
    if (!t?.checkpoint) return;
    if (!confirm(`Put ${t.cwd} back as it was before "${t.text.slice(0, 60)}"?\nFiles the task created are deleted and the ones it changed come back. Other changes made since then are lost too.`)) return;
    const r = await ab.gitRestore(t.cwd, t.checkpoint);
    if (!r.ok) return toast(esc(r.error), 8000);
    t.restored = true; save(); renderTasks(); this.close();
    toast(`Back to the checkpoint${r.value.removed ? ` (${r.value.removed} new file${r.value.removed === 1 ? '' : 's'} removed)` : ''}.`, 5000);
  }
}

const reviewDialog = new ReviewDialog();
