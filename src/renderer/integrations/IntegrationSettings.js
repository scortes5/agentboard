// AgentBoard — Settings → Integrations: remote control from a phone and the daily summary to
// a chat webhook, whose URL is kept in the secrets vault. Plugs into Settings through
// settingsSections.
'use strict';
/* global $, ab, cfg, esc, toast, icon, saveNow, settingsSections, RemoteBridge, dailySummaryJob, DailySummary */

class IntegrationSettings {
  constructor() {
    $('#remoteNewLink').onclick = () => this.newLink();
    $('#remoteLinks').addEventListener('click', (e) => {
      const url = e.target.closest('[data-copy]')?.dataset.copy;
      if (url) { ab.copy(url); toast('Link copied. Open it on your phone, on the same Wi-Fi.'); }
    });
    $('#summaryTest').onclick = () => this.test();
  }

  load(f) {
    const r = cfg.remote || {};
    f.remoteEnabled.checked = !!r.enabled;
    f.remoteHours.value = r.hours ?? 8;
    f.remotePort.value = r.port || 7777;
    f.summaryEnabled.checked = !!cfg.summaryEnabled;
    f.summaryWebhook.value = '';
    f.summaryTime.value = cfg.summaryTime || '18:00';
    this.renderLinks();
    this.renderSummary();
  }

  save(f) {
    cfg.remote = {
      enabled: f.remoteEnabled.checked, port: Math.min(65535, Math.max(1024, +f.remotePort.value || 7777)),
      hours: Math.min(168, Math.max(0, f.remoteHours.value === '' ? 8 : +f.remoteHours.value)),
      token: cfg.remote?.token || RemoteBridge.newToken(),
    };
    cfg.summaryEnabled = f.summaryEnabled.checked;
    cfg.summaryTime = f.summaryTime.value || '18:00';
    this.webhook = f.summaryWebhook.value.trim(); // goes to the vault once Settings is saved
  }

  async saved() {
    this.apply();
    if (!this.webhook) return;
    const r = await ab.secretsSet(DailySummary.SECRET, this.webhook);
    this.webhook = '';
    if (!r.ok) toast(`Could not save the webhook URL: ${esc(r.error)}`, 7000);
  }

  async apply() {
    const r = await ab.remoteApply();
    if (!r.ok) toast(`Remote control is off: ${esc(r.error)}`, 6000);
    this.renderLinks();
  }

  async renderLinks() {
    const s = await ab.remoteStatus();
    const until = s.expiresAt ? ` · turns off at ${new Date(s.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
    $('#remoteLinks').innerHTML = s.running
      ? (s.urls.map((u) => `<div class="set-row"><code class="link">${esc(u.replace(/#t=.*/, '#t=…'))}</code>
          <button type="button" class="ghost" data-copy="${esc(u)}" title="Copy the link, token included">${icon('copy', 13)} Copy</button></div>`).join('')
        || '<div class="set-row muted">No network found: connect this computer to Wi-Fi.</div>')
        + `<div class="set-row muted small">On${esc(until)}. Certificate SHA-256: <code class="fp">${esc(s.fingerprint || '')}</code></div>`
      : '<div class="set-row muted">Off. Turn it on and save to get the link.</div>';
  }

  async renderSummary() {
    const saved = (await ab.secretsList()).some((s) => s.name === DailySummary.SECRET);
    $('#summaryState').textContent = saved ? 'URL saved in Secrets' : 'No URL saved yet';
  }

  async newLink() {
    cfg.remote = { ...(cfg.remote || {}), token: RemoteBridge.newToken() };
    await saveNow();
    await this.apply();
    toast('New link created: the old one no longer works.');
  }

  async test() {
    const r = await dailySummaryJob.send($('#settingsForm').summaryWebhook.value.trim() || null);
    toast(r.ok ? 'Summary sent: check your channel.' : `Could not send it: ${esc(r.error)}`, 5000);
  }
}

settingsSections.push(new IntegrationSettings());
