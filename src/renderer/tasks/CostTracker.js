// AgentBoard — what tasks cost while they run: tokens per task (read live from Claude's
// session logs), a budget per task and per day, and the history the router learns from.
'use strict';
/* global cfg, esc, ab, toast, save, cardData, runtime, tasks, updateTaskLive, fmt */

const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

class CostTracker {
  constructor() {
    this.today = 0;      // tokens used today
    this.byAgent = {};   // subscription → { done, blocked } on finished tasks
    setInterval(() => this.pollTasks(), 10_000);
    setInterval(() => this.refreshSummary(), 5 * 60_000);
    setTimeout(() => this.refreshSummary(), 8000);
  }

  // Budgets are set in thousands of tokens in Settings → Tasks (0 = no budget).
  taskBudget() { return (cfg.taskBudgetK || 0) * 1000; }
  dailyBudget() { return (cfg.dailyBudgetK || 0) * 1000; }
  overDailyBudget() { return this.dailyBudget() > 0 && this.today >= this.dailyBudget(); }

  // Tokens of the running tasks; once a task reaches its budget, warn or ask it to wrap up.
  async pollTasks() {
    const running = tasks().filter((t) => t.status === 'running' && t.sessionId);
    if (!running.length) return;
    const r = await ab.usageSessions(running.map((t) => t.sessionId));
    if (!r.ok) return;
    for (const t of running) {
      t.tokens = r.value[t.sessionId] || t.tokens || 0;
      if (this.taskBudget() && !t.budgetHit && t.tokens >= this.taskBudget()) this.budgetReached(t);
    }
    save();
    if (cfg.tasksOpen) updateTaskLive();
  }

  budgetReached(t) {
    t.budgetHit = true;
    toast(`<b>${esc(t.text.slice(0, 50))}</b> reached its budget (${fmt.tokens(this.taskBudget())} tokens).`, 6000);
    const c = t.cardId && cardData(t.cardId);
    if (cfg.budgetAction === 'wrap' && c && runtime.get(c.id)?.alive) {
      ab.ptyPaste(c.id, 'You reached the token budget for this task. Stop exploring: finish the smallest change that works now, and end with a «DONE: …» or «BLOCKED: …» line.');
    }
  }

  // Today's total (daily budget) and how each subscription did on finished tasks.
  async refreshSummary() {
    const r = await ab.usageScan(tasks().map((t) => ({ ...t })));
    if (!r.ok) return;
    this.today = r.value.days[todayKey()]?.tokens || 0;
    this.byAgent = r.value.taskStats?.byAgent || {};
  }

  // "claude: 12 done, 1 blocked; codex: 4 done, 3 blocked" for the router.
  historyForRouting() {
    return Object.entries(this.byAgent).filter(([k]) => cfg.agents[k]).map(([k, s]) => `${k}: ${s.done || 0} done, ${s.blocked || 0} blocked`).join('; ');
  }
}

const costTracker = new CostTracker();
