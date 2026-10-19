// AgentBoard — what tasks cost while they run: tokens per task (read live from Claude's
// session logs), a budget per task, the usage that the day/week/month budgets are measured
// against (Budgets) and the history the router learns from.
'use strict';
/* global cfg, esc, ab, toast, save, cardData, runtime, tasks, updateTaskLive, fmt, viewLayout, budgets, openUsage */

// A session that re-reads this much on every turn is worth compacting or restarting.
const CONTEXT_WARN = 150_000;

class CostTracker {
  constructor() {
    this.byAgent = {};   // subscription → { done, blocked } on finished tasks
    setInterval(() => this.pollTasks(), 10_000);
    setInterval(() => this.refreshSummary(), 5 * 60_000);
    setTimeout(() => this.refreshSummary(), 8000);
  }

  // Budgets are set in thousands of tokens in Settings → Tasks (0 = no budget).
  taskBudget() { return (cfg.taskBudgetK || 0) * 1000; }

  // The day/week/month budget a task in `cwd` is over ("weekly budget of shop-api"), or null.
  overBudget(cwd) { return budgets.over(cwd); }

  // Tokens of the running tasks and of every Claude card's session, read in one call. Once a
  // task reaches its budget, warn or ask it to wrap up.
  async pollTasks() {
    const running = tasks().filter((t) => t.status === 'running' && t.sessionId);
    const cards = cfg.cards.filter((c) => c.type === 'term' && c.sessionId && c.sessionUsed && runtime.get(c.id)?.tokEl);
    const ids = [...new Set([...running.map((t) => t.sessionId), ...cards.map((c) => c.sessionId)])];
    if (!ids.length) return;
    const r = await ab.usageSessions(ids);
    if (!r.ok) return;
    for (const c of cards) this.showCardTokens(c, r.value[c.sessionId]);
    if (!running.length) return;
    for (const t of running) {
      t.tokens = r.value[t.sessionId]?.tokens || t.tokens || 0;
      if (this.taskBudget() && !t.budgetHit && t.tokens >= this.taskBudget()) this.budgetReached(t);
    }
    save();
    if (viewLayout.visible('tasks')) updateTaskLive();
  }

  // The card's session so far, in its header; the tooltip splits it and flags a heavy context.
  showCardTokens(c, s) {
    const el = runtime.get(c.id)?.tokEl;
    if (!el) return;
    el.classList.toggle('hidden', !s?.tokens);
    if (!s?.tokens) return;
    const heavy = s.context >= CONTEXT_WARN;
    el.textContent = `${fmt.tokens(s.tokens)} tok`;
    el.classList.toggle('warn', heavy);
    el.title = `This session: ${fmt.count(s.tokens)} tokens (input ${fmt.count(s.input)}, cache read ${fmt.count(s.cacheRead)}, `
      + `cache write ${fmt.count(s.cacheWrite)}, output ${fmt.count(s.output)}).\nEach turn re-reads ${fmt.count(s.context)} tokens of context.`
      + (heavy ? ' That is a lot: /compact or a new session would save tokens.' : '')
      + '\nClick to open Usage.';
    el.onclick = openUsage;
  }

  budgetReached(t) {
    t.budgetHit = true;
    toast(`<b>${esc(t.text.slice(0, 50))}</b> reached its budget (${fmt.tokens(this.taskBudget())} tokens).`, 6000);
    const c = t.cardId && cardData(t.cardId);
    if (cfg.budgetAction === 'wrap' && c && runtime.get(c.id)?.alive) {
      ab.ptyPaste(c.id, 'You reached the token budget for this task. Stop exploring: finish the smallest change that works now, and end with a «DONE: …» or «BLOCKED: …» line.');
    }
  }

  // Usage for the budgets (and their alerts) and how each subscription did on finished tasks.
  async refreshSummary() {
    const r = await ab.usageScan(tasks().map((t) => ({ ...t })));
    if (!r.ok) return;
    budgets.update(r.value);
    budgets.checkAlerts();
    this.byAgent = r.value.taskStats?.byAgent || {};
  }

  // "claude: 12 done, 1 blocked; codex: 4 done, 3 blocked" for the router.
  historyForRouting() {
    return Object.entries(this.byAgent).filter(([k]) => cfg.agents[k]).map(([k, s]) => `${k}: ${s.done || 0} done, ${s.blocked || 0} blocked`).join('; ');
  }
}

const costTracker = new CostTracker();
