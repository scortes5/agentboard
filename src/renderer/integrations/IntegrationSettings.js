// AgentBoard — Settings → Integrations: remote control from a phone and the daily summary to
// a chat webhook. Plugs into Settings through settingsSections.
'use strict';
/* global $, ab, cfg, esc, toast, icon, saveNow, settingsSections, RemoteBridge, dailySummaryJob */

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
    f.remotePort.value = r.port || 7777;
    f.summaryWebhook.value = cfg.summaryWebhook || '';
    f.summaryTime.value = cfg.summaryTime || '18:00';
    this.renderLinks();
  }

  save(f) {
    cfg.remote = {
      enabled: f.remoteEnabled.checked, port: Math.min(65535, Math.max(1024, +f.remotePort.value || 7777)),
      token: cfg.remote?.token || RemoteBridge.newToken(),
    };
    cfg.summaryWebhook = f.summaryWebhook.value.trim();
    cfg.summaryTime = f.summaryTime.value || '18:00';
  }

  saved() { this.apply(); }

  async apply() {
    const r = await ab.remoteApply();
    if (!r.ok) toast(`Remote control is off: ${esc(r.error)}`, 6000);
    this.renderLinks();
  }

  async renderLinks() {
    const s = await ab.remoteStatus();
    $('#remoteLinks').innerHTML = s.running
      ? s.urls.map((u) => `<div class="set-row"><code class="link">${esc(u.replace(/#t=.*/, '#t=…'))}</code>
          <button type="button" class="ghost" data-copy="${esc(u)}" title="Copy the link, token included">${icon('copy', 13)} Copy</button></div>`).join('')
        || '<div class="set-row muted">No network found: connect this computer to Wi-Fi.</div>'
      : '<div class="set-row muted">Off. Turn it on and save to get the link.</div>';
  }

  async newLink() {
    cfg.remote = { ...(cfg.remote || {}), token: RemoteBridge.newToken() };
    await saveNow();
    await this.apply();
    toast('New link created: the old one no longer works.');
  }

  async test() {
    const url = $('#settingsForm').summaryWebhook.value.trim();
    const r = await dailySummaryJob.send(url);
    toast(r.ok ? 'Summary sent: check your channel.' : `Could not send it: ${esc(r.error)}`, 5000);
  }
}

settingsSections.push(new IntegrationSettings());
