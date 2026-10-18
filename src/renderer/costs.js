// AgentBoard — what tasks cost while they run: tokens per task (read live from Claude's
// session logs), a budget per task and per day, and the history the router learns from.
'use strict';
/* global cfg, $, esc, ab, toast, save, cardData, runtime, tasks, renderTasks, updateTaskLive */

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
const usageCache = { today: 0, byAgent: {}, at: 0 };
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Budgets are set in thousands of tokens in Settings → Tasks (0 = no budget).
const taskBudget = () => (cfg.taskBudgetK || 0) * 1000;
const dailyBudget = () => (cfg.dailyBudgetK || 0) * 1000;
const overDailyBudget = () => dailyBudget() > 0 && usageCache.today >= dailyBudget();

// Every 10 s: tokens of the running tasks; once a budget is reached, warn or ask the agent to wrap up.
async function pollTaskTokens() {
  const running = tasks().filter((t) => t.status === 'running' && t.sessionId);
  if (!running.length) return;
  const r = await ab.usageSessions(running.map((t) => t.sessionId));
  if (!r.ok) return;
  for (const t of running) {
    t.tokens = r.value[t.sessionId] || t.tokens || 0;
    const budget = taskBudget();
    if (!budget || t.budgetHit || t.tokens < budget) continue;
    t.budgetHit = true;
    toast(`<b>${esc(t.text.slice(0, 50))}</b> reached its budget (${fmtTokens(budget)} tokens).`, 6000);
    const c = t.cardId && cardData(t.cardId);
    if (cfg.budgetAction === 'wrap' && c && runtime.get(c.id)?.alive) {
      ab.ptyPaste(c.id, 'You reached the token budget for this task. Stop exploring: finish the smallest change that works now, and end with a «DONE: …» or «BLOCKED: …» line.');
    }
  }
  save();
  if (cfg.tasksOpen) updateTaskLive();
}

// Every 5 min: today's total (daily budget) and how each subscription did on finished tasks.
async function refreshUsageSummary() {
  const r = await ab.usageScan(tasks().map((t) => ({ ...t })));
  if (!r.ok) return;
  usageCache.today = r.value.days[todayKey()]?.tokens || 0;
  usageCache.byAgent = r.value.taskStats?.byAgent || {};
  usageCache.at = Date.now();
}

// "claude: 12 done, 1 blocked; codex: 4 done, 3 blocked" for the router.
function historyForRouting() {
  return Object.entries(usageCache.byAgent).filter(([k]) => cfg.agents[k])
    .map(([k, s]) => `${k}: ${s.done || 0} done, ${s.blocked || 0} blocked`).join('; ');
}

setInterval(pollTaskTokens, 10_000);
setInterval(refreshUsageSummary, 5 * 60_000);
setTimeout(refreshUsageSummary, 8000);
