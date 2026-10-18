// Sends a message to a chat webhook (Slack, Discord, Microsoft Teams, Google Chat or any
// endpoint that accepts JSON). Only https URLs are accepted. The daily summary's URL lives in
// the secrets vault (whoever has it can post to your channel), never in the board file.
'use strict';
const { net } = require('electron');
const { wrap } = require('../core/platform');

const SECRET = 'DAILY_SUMMARY_WEBHOOK';

class WebhookNotifier {
  constructor({ vault }) {
    this.vault = vault;
  }

  // Slack and Teams read `text`, Discord reads `content`: both are sent.
  static payload(text) {
    const body = String(text).slice(0, 3800);
    return { text: body, content: body.slice(0, 1990) };
  }

  // url: one typed in Settings to test it; otherwise the one saved in the vault.
  async post(url, text) {
    url = url || this.vault.envFor('', [SECRET])[SECRET];
    if (!url) throw new Error('Save the webhook URL first (Settings → Integrations).');
    if (!/^https:\/\/[^\s]+$/i.test(String(url || ''))) throw new Error('Use an https:// webhook URL.');
    const res = await net.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(WebhookNotifier.payload(text)) });
    if (!res.ok) throw new Error(`The webhook answered ${res.status}.`);
    return true;
  }

  register(ipcMain) {
    ipcMain.handle('webhook:post', wrap((_e, url, text) => this.post(url, text)));
  }
}

module.exports = { WebhookNotifier, SECRET };
