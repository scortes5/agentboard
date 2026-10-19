// AgentBoard — cross-review (Settings → Tasks): another subscription reads a finished task's
// changes without editing them and either approves them or sends the problems back.
'use strict';
/* global cfg, esc, ab, toast, save, cardData, runtime, renderTasks, startTaskAgain, addTask, taskById, autoAgents, taskPipeline */

class CrossReviewStep {
  prompt(t) {
    if (!t.reviewOf) return null;
    const orig = taskById(t.reviewOf);
    const from = orig?.base || orig?.checkpoint;
    const how = from ? `git diff ${from} (run in ${orig.workdir || orig.cwd}; it includes uncommitted changes) and git status for new files` : 'git diff and git status';
    return `[AgentBoard task ${t.id}] Review, without editing any file, the changes another agent made for: "${orig?.text || ''}".\n`
      + `See them with: ${how}. Check that they do what was asked, look for bugs, missing cases and broken tests.\n`
      + 'End with exactly one line: «DONE: …» when it is right (say why in a few words), or «BLOCKED: …» listing the problems to fix, concrete and short.';
  }

  afterFinish(t) {
    if (t.reviewOf) return this.apply(t);
    if (t.status === 'done' && cfg.crossReview && !t.review && !t.flowRun) this.start(t);
  }

  start(t) {
    const reviewer = autoAgents().find((k) => k !== t.assigned);
    if (!reviewer) return;
    addTask({ text: `Review: ${t.text}`, agent: reviewer, cwd: t.workdir || t.cwd, worktree: false, reviewOf: t.id, group: t.group });
    toast(`Cross-review of <b>${esc(t.text.slice(0, 50))}</b> queued for ${esc(cfg.agents[reviewer].label)}.`);
  }

  // The reviewer finished: approve the original task or send the problems back to it.
  async apply(review) {
    const t = taskById(review.reviewOf);
    if (!t) return;
    t.review = { by: cfg.agents[review.assigned]?.label || review.assigned, status: review.status, text: review.summary };
    if (review.status === 'done') { save(); renderTasks(); return; }
    const c = t.cardId && cardData(t.cardId);
    if (c && runtime.get(c.id)?.alive) {
      startTaskAgain(t);
      await ab.ptyPaste(c.id, `A reviewer (${t.review.by}) found problems in your changes:\n${review.summary}\nFix them and end with a new «DONE: …» line.`);
    } else {
      t.status = 'review';
      save(); renderTasks();
    }
  }
}

taskPipeline.use(new CrossReviewStep());
