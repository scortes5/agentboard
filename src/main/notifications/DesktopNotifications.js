// Native desktop notifications for task automations (started, done, blocked, needs review)
// and agents that finish working, filtered by the user's preferences in Settings → General.
'use strict';

const DEFAULTS = Object.freeze({
  enabled: true, sound: true, backgroundOnly: true,
  started: false, completed: true, blocked: true, review: true, idle: true,
});
const TITLES = Object.freeze({
  started: 'Task started', completed: 'Task done', blocked: 'Task blocked',
  review: 'Task needs review', idle: 'Agent finished', test: 'AgentBoard test notification',
});
const MAX_ACTIVE = 50; // some systems never send "close": cap what we keep alive

// Saved preferences on top of the defaults; anything that is not a boolean is ignored.
function preferences(value) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, fallback]) =>
    [key, typeof value?.[key] === 'boolean' ? value[key] : fallback]));
}

class DesktopNotifications {
  // Notification: Electron's class · getPreferences(): saved preferences · isFocused(): window has focus
  // onClick(cardId): bring the window forward and show the card.
  constructor({ Notification, getPreferences, isFocused, onClick, timeoutMs = 5000 }) {
    Object.assign(this, { Notification, getPreferences, isFocused, onClick, timeoutMs });
    // Electron drops a notification's click handler once the object is garbage collected.
    this.active = new Set();
  }

  register(ipcMain) {
    ipcMain.handle('desktop:notify', (_e, event) => this.notify(event));
    ipcMain.handle('desktop:test', (_e, prefs) => this.notify(
      { kind: 'test', body: 'Automation notifications are ready.' }, { test: true, preferences: prefs }));
  }

  // { ok: true } shown · { ok: true, skipped: true } filtered out · { ok: false, error } failed.
  // The test button uses the unsaved preferences and skips the per-event filters.
  async notify(event, options = {}) {
    if (!event || !Object.hasOwn(TITLES, event.kind) || (event.kind === 'test' && !options.test)) {
      return { ok: false, error: 'Invalid notification event.' };
    }
    const prefs = preferences(options.test ? options.preferences : this.getPreferences());
    if (!options.test && (!prefs.enabled || !prefs[event.kind] || (prefs.backgroundOnly && this.isFocused()))) {
      return { ok: true, skipped: true };
    }
    if (!this.Notification.isSupported()) return { ok: false, error: 'This system does not support desktop notifications.' };
    return new Promise((resolve) => this.show(event, prefs, resolve));
  }

  show(event, prefs, resolve) {
    let notification = null;
    let timer = null;
    const finish = (result) => { clearTimeout(timer); resolve(result); };
    const forget = () => this.active.delete(notification);
    try {
      notification = new this.Notification({
        title: TITLES[event.kind], body: String(event.body || '').slice(0, 500), silent: !prefs.sound,
      });
      if (this.active.size >= MAX_ACTIVE) this.active.delete(this.active.values().next().value);
      this.active.add(notification);
      notification.once('show', () => finish({ ok: true }));
      notification.once('failed', (_e, error) => { forget(); finish({ ok: false, error: String(error || 'The system could not show the notification.') }); });
      notification.once('close', forget);
      notification.once('click', () => { forget(); this.onClick(typeof event.cardId === 'string' ? event.cardId : null); });
      // Without permission some systems never answer: report it instead of waiting forever.
      timer = setTimeout(() => { forget(); finish({ ok: false, error: 'The system did not confirm the notification. Check AgentBoard\'s notification permission.' }); }, this.timeoutMs);
      notification.show();
    } catch (err) {
      forget();
      finish({ ok: false, error: err.message });
    }
  }
}

module.exports = { DesktopNotifications, DEFAULTS, preferences };
