// AgentBoard — daily summary: once a day, at the time set in Settings → Integrations, today's
// done and pending tasks go to a chat webhook (Slack, Discord, Teams, Google Chat…). The URL is
// in the secrets vault; boards from 1.1–1.3 kept it in the settings and it is moved there.
'use strict';
/* global cfg, ab, tasks, save, summaryMarkdown, toast, esc */

class DailySummary {
  static SECRET = 'DAILY_SUMMARY_WEBHOOK';

  constructor({ every = 60_000 } = {}) {
    setInterval(() => this.tick(), every);
  }

  static today() { return new Date().toDateString(); }

  // Minutes after midnight of "HH:MM" (18:00 when empty or invalid).
  static minutes(time) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
    return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : 18 * 60;
  }

  // A URL saved in the settings by an older version goes to the vault (if it can be encrypted).
  async migrate() {
    if (!cfg.summaryWebhook) return;
    const r = await ab.secretsSet(DailySummary.SECRET, cfg.summaryWebhook);
    if (!r.ok) return;
    delete cfg.summaryWebhook;
    cfg.summaryEnabled = true;
    save();
  }

  due(now = new Date()) {
    return !!(cfg.summaryEnabled || cfg.summaryWebhook) && cfg.summarySentOn !== DailySummary.today() && tasks().length > 0
      && now.getHours() * 60 + now.getMinutes() >= DailySummary.minutes(cfg.summaryTime);
  }

  async tick() {
    if (!cfg) return;
    await this.migrate();
    if (!this.due()) return;
    cfg.summarySentOn = DailySummary.today(); // once a day even if the webhook fails
    save();
    const r = await this.send();
    if (!r.ok) toast(`Could not send the daily summary: ${esc(r.error)}`, 6000);
  }

  // url: one typed in Settings to test; otherwise the main process uses the saved one.
  send(url = cfg.summaryWebhook || null) {
    return ab.postWebhook(url, summaryMarkdown().md);
  }
}

const dailySummaryJob = new DailySummary();
