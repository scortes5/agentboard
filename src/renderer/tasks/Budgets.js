// AgentBoard — token budgets by day, week and month, for all projects and for each one, and the
// cost history they are measured against (tokens per project per day, from the agents' logs).
// At 80% and at 100% of a budget you get a notice once per period (and, if you want, a message
// in the daily summary's chat); past a budget, new tasks there use light models.
'use strict';
/* global cfg, ab, save, toast, esc, fmt, projectOfPath, basename */

const PERIOD_LABEL = { day: 'daily', week: 'weekly', month: 'monthly' };

class UsagePeriods {
  static key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // First day of the period that contains `now` (weeks start on Monday).
  static start(period, now = new Date()) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    if (period === 'month') d.setDate(1);
    return d;
  }

  // An id that changes when a new period starts ("week 2026-10-12").
  static id(period, now = new Date()) { return `${period} ${UsagePeriods.key(UsagePeriods.start(period, now))}`; }

  // Tokens in { day: tokens } from the start of the period until today.
  static sum(byDay, period, now = new Date()) {
    const from = UsagePeriods.key(UsagePeriods.start(period, now)), to = UsagePeriods.key(now);
    return Object.entries(byDay || {}).reduce((n, [day, t]) => (day >= from && day <= to ? n + t : n), 0);
  }

  // The last `n` days as [{ day, tokens }], oldest first.
  static last(byDay, n, now = new Date()) {
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i));
      return { day: UsagePeriods.key(d), tokens: byDay?.[UsagePeriods.key(d)] || 0 };
    });
  }
}

class Budgets {
  constructor() {
    this.all = {};        // day → tokens, every project
    this.byProject = {};  // project path ('' = outside your projects) → day → tokens
  }

  // From a usage scan: logs are per folder (sometimes a subfolder or a worktree), grouped here by project.
  update(scan) {
    this.all = Object.fromEntries(Object.entries(scan.days || {}).map(([d, v]) => [d, v.tokens || 0]));
    this.byProject = {};
    for (const [cwd, days] of Object.entries(scan.projectDays || {})) {
      const p = projectOfPath(cwd) || '';
      const acc = this.byProject[p] || (this.byProject[p] = {});
      for (const [d, t] of Object.entries(days)) acc[d] = (acc[d] || 0) + t;
    }
  }

  // Budgets set, in tokens: all projects (Settings → Tasks) and each project (Settings → Projects).
  limits() {
    const k = (v) => Math.max(0, +v || 0) * 1000;
    const list = [
      { scope: '', name: 'All projects', period: 'day', limit: k(cfg.dailyBudgetK) },
      { scope: '', name: 'All projects', period: 'week', limit: k(cfg.weeklyBudgetK) },
      { scope: '', name: 'All projects', period: 'month', limit: k(cfg.monthlyBudgetK) },
      ...cfg.projects.flatMap((p) => [
        { scope: p.path, name: p.name, period: 'week', limit: k(p.budgetWeekK) },
        { scope: p.path, name: p.name, period: 'month', limit: k(p.budgetMonthK) },
      ]),
    ];
    return list.filter((b) => b.limit > 0);
  }

  used(scope, period, now = new Date()) {
    return UsagePeriods.sum(scope ? this.byProject[scope] : this.all, period, now);
  }

  status(now = new Date()) {
    return this.limits().map((b) => { const used = this.used(b.scope, b.period, now); return { ...b, used, ratio: used / b.limit }; });
  }

  // The budget a new task in `cwd` is over, if any ("weekly budget of shop-api"), else null.
  over(cwd, now = new Date()) {
    const project = cwd ? projectOfPath(cwd) : null;
    const hit = this.status(now).find((b) => b.ratio >= 1 && (!b.scope || b.scope === project));
    return hit ? `${PERIOD_LABEL[hit.period]} budget${hit.scope ? ` of ${hit.name}` : ''}` : null;
  }

  // Notices at 80% and 100%, once per budget and period.
  checkAlerts(now = new Date()) {
    const sent = cfg.budgetAlerts || (cfg.budgetAlerts = {});
    let changed = false;
    const live = new Set();
    for (const b of this.status(now)) {
      const key = `${b.scope}|${b.period}|${UsagePeriods.id(b.period, now)}`;
      live.add(key);
      const level = b.ratio >= 1 ? 100 : b.ratio >= 0.8 ? 80 : 0;
      if (!level || (sent[key] || 0) >= level) continue;
      sent[key] = level; changed = true;
      this.alert(b, level);
    }
    for (const key of Object.keys(sent)) if (!live.has(key)) { delete sent[key]; changed = true; }
    if (changed) save();
  }

  alert(b, level) {
    const what = `${b.name}: ${fmt.tokens(b.used)} of the ${PERIOD_LABEL[b.period]} budget (${fmt.tokens(b.limit)} tokens)`;
    const text = level >= 100 ? `Budget reached · ${what}. New tasks there use light models until the ${b.period} ends.` : `80% of a budget used · ${what}.`;
    toast(esc(text), 9000);
    try { new Notification(level >= 100 ? 'Budget reached' : 'Budget at 80%', { body: what }); } catch {}
    if (cfg.budgetAlertsToChat) ab.postWebhook(null, `AgentBoard · ${text}`);
  }

  // Rows for the Usage panel: each project's tokens today, this week, this month and the last 30 days.
  projectRows(now = new Date()) {
    const name = (p) => (p ? cfg.projects.find((x) => x.path === p)?.name || basename(p) : 'Outside your projects');
    return Object.entries(this.byProject).map(([p, days]) => ({
      path: p, name: name(p), today: days[UsagePeriods.key(now)] || 0,
      week: UsagePeriods.sum(days, 'week', now), month: UsagePeriods.sum(days, 'month', now), last30: UsagePeriods.last(days, 30, now),
    })).filter((r) => r.last30.some((d) => d.tokens) || r.month).sort((a, b) => b.month - a.month || b.week - a.week);
  }
}

const budgets = new Budgets();
