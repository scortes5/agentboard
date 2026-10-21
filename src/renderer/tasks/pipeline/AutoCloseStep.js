// AgentBoard — closes a task's terminals (its agent and the subagents it opened) once the task
// is done, so finished agents stop holding a session. Blocked tasks and locked cards stay open.
// With cross-review on, the author's card waits for the reviewer: problems go back to it.
'use strict';
/* global cfg, taskById, taskCards, closeCards, autoAgents, taskPipeline */

const AUTO_CLOSE_DELAY_MS = 5000; // long enough to see the DONE line

class AutoCloseStep {
  afterFinish(t) {
    if (cfg.autoCloseDone === false || t.status !== 'done') return;
    if (t.reviewOf) {
      this.later(t);
      const orig = taskById(t.reviewOf);
      if (orig?.status === 'done') this.later(orig);
      return;
    }
    const reviewComing = cfg.crossReview && !t.review && !t.flowRun && autoAgents().some((k) => k !== t.assigned);
    if (!reviewComing) this.later(t);
  }

  // Closed only if it is still done by then (comments or failed checks may reopen it).
  later(t) {
    setTimeout(() => {
      if (t.status !== 'done') return;
      const cards = taskCards(t).filter((c) => !c.locked);
      if (cards.length) closeCards(cards, { ask: false });
    }, AUTO_CLOSE_DELAY_MS);
  }
}

taskPipeline.use(new AutoCloseStep());
