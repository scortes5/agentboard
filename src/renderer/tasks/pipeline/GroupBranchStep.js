// AgentBoard — one branch per #group (Settings → Tasks): the group's tasks share a worktree on
// agentboard/group-<name>. Each task that finishes done is committed there, and once none of the
// group's tasks is left to run (reviews included) the branch is pushed to origin.
'use strict';
/* global cfg, esc, ab, toast, save, renderTasks, tasks, projectOfPath, taskPipeline */

const OPEN = ['pending', 'running', 'verifying', 'review'];

class GroupBranchStep {
  constructor() {
    this.queue = Promise.resolve(); // git work for the groups, one step at a time
  }

  // Reviews and comment follow-ups run in the group's folder without owning it: they still
  // count, so the branch is pushed after the last of them.
  afterFinish(t) {
    const ref = t.groupBranch && t.workdir ? t : t.group && this.members(t).find((x) => x.groupBranch && x.workdir);
    if (!ref) return;
    this.queue = this.queue.then(() => this.settle(t, ref)).catch((err) => console.warn('Group branch:', err));
  }

  // Tasks of the same group in the same project, wherever they run.
  members(t) {
    const project = projectOfPath(t.cwd || '');
    return tasks().filter((x) => x.group === t.group && projectOfPath(x.cwd || '') === project);
  }

  async settle(t, ref) {
    const others = this.members(t).filter((x) => x !== t);
    // A task still working in the same folder would get its half-done files committed here:
    // its own finish (or the agents' own commits) picks them up instead.
    const sharing = others.some((x) => (x.workdir || x.cwd) === ref.workdir && ['running', 'verifying'].includes(x.status));
    if (t.status === 'done' && !t.reviewOf && !sharing) {
      const c = await ab.gitGroupCommit(ref.workdir, `${t.text.split('\n')[0].slice(0, 100)}\n\nAgentBoard task · group ${t.group}`);
      if (!c.ok) toast(`Could not commit <b>${esc(t.text.slice(0, 50))}</b>: ${esc(c.error)}`, 7000);
      else if (c.value.committed) { t.commit = c.value.sha; save(); renderTasks(); }
    }
    if (others.some((x) => OPEN.includes(x.status)) || cfg.groupPush === false) return;
    if (!this.members(t).some((x) => x.status === 'done' && x.groupBranch)) return;
    const p = await ab.gitGroupPush(ref.workdir, ref.branch);
    if (!p.ok) return toast(`Group <b>${esc(t.group)}</b> finished, but its branch was not pushed: ${esc(p.error)}`, 9000);
    for (const x of this.members(t)) if (x.groupBranch) x.pushed = true;
    save(); renderTasks();
    toast(`Group <b>${esc(t.group)}</b> finished: <b>${esc(ref.branch)}</b> pushed to origin.${p.value.pending ? ' Uncommitted changes (from blocked tasks) stayed in its worktree.' : ''}`, 8000);
  }
}

taskPipeline.use(new GroupBranchStep());
