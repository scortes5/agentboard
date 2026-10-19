// AgentBoard — Settings → Secrets: passwords and keys for automations, encrypted with the
// system keychain. Saved as soon as you add one (not with the Settings button), and only the
// names come back to the window.
'use strict';
/* global $, ab, esc, toast, icon, settingsSections */

class SecretsSettings {
  constructor() {
    $('#secretAdd').onclick = () => this.add();
    $('#secretRows').addEventListener('click', (e) => {
      const name = e.target.closest('[data-remove]')?.dataset.remove;
      if (name && confirm(`Delete the secret ${name}? Automations that use it will stop getting it.`)) this.remove(name);
    });
  }

  // Comma- or space-separated names from an automation step.
  static parse(text) { return String(text || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean); }

  async render(list) {
    list = list || await ab.secretsList();
    $('#secretRows').innerHTML = list.length
      ? list.map((s) => `<div class="set-row"><code>${esc(s.name)}</code><span class="muted small">saved ${new Date(s.updatedAt).toLocaleDateString()}</span>
          <button type="button" class="ghost" data-remove="${esc(s.name)}" title="Delete this secret">${icon('trash', 13)}</button></div>`).join('')
      : '<div class="set-row muted">No secrets yet.</div>';
  }

  async add() {
    const name = $('#secretName').value.trim().toUpperCase();
    const r = await ab.secretsSet(name, $('#secretValue').value);
    if (!r.ok) { $('#secretError').textContent = r.error; return; }
    $('#secretName').value = ''; $('#secretValue').value = ''; $('#secretError').textContent = '';
    this.render(r.value);
    toast(`Secret <b>${esc(name)}</b> saved, encrypted.`);
  }

  async remove(name) {
    const r = await ab.secretsRemove(name);
    if (r.ok) this.render(r.value);
  }

  load() { $('#secretError').textContent = ''; this.render(); }
  save() {}
}

const secretsSettings = new SecretsSettings();
settingsSections.push(secretsSettings);
