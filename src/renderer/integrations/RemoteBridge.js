// AgentBoard — remote control: while it is on (Settings → Integrations), the window sends the
// main process a snapshot of the tasks and the permission requests every few seconds for the
// phone page, and runs what the phone asks (add a task, approve or reject a request).
'use strict';
/* global cfg, ab, save, tasks, cardData, runtime, liveOf, approvalsInbox, addLines, fmt, toast, esc */

const REMOTE_TASKS = 40;

class RemoteBridge {
  constructor({ every = 2000 } = {}) {
    ab.onRemoteAction((a) => this.act(a));
    ab.onRemoteDevice((d) => RemoteBridge.deviceConnected(d));
    ab.onRemoteExpired(() => { cfg.remote = { ...cfg.remote, enabled: false }; save(); toast('Remote control turned itself off. Turn it on again in Settings → Integrations.', 6000); });
    setInterval(() => this.push(), every);
  }

  enabled() { return !!cfg.remote?.enabled; }

  static task(t, now) {
    const c = t.cardId && cardData(t.cardId);
    const live = t.status === 'running' && c ? liveOf(c) : null;
    return {
      id: t.id, text: t.text, status: t.status, agent: cfg.agents[t.assigned]?.label || '',
      elapsed: t.status === 'running' && t.startedAt ? fmt.elapsed(now - t.startedAt) : '',
      tokens: t.tokens ? `${fmt.tokens(t.tokens)} tok` : '', line: live ? live.alert || live.line : '', summary: t.summary || '',
    };
  }

  snapshot() {
    const now = Date.now();
    const list = tasks();
    const shown = [...list.filter((t) => t.status !== 'done'), ...list.filter((t) => t.status === 'done').sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0))];
    return {
      tasks: shown.slice(0, REMOTE_TASKS).map((t) => RemoteBridge.task(t, now)),
      approvals: approvalsInbox.pending().map(([card, a]) => ({ card, title: cardData(card).title, question: a.question, context: a.context, danger: !!a.danger })),
      counts: {
        total: list.length, done: list.filter((t) => t.status === 'done').length, running: list.filter((t) => t.status === 'running').length,
        errors: list.filter((t) => t.status === 'blocked' || (t.status === 'running' && runtime.get(t.cardId)?.alert)).length,
      },
    };
  }

  push() { if (this.enabled()) ab.remoteSnapshot(this.snapshot()); }

  act(a) {
    if (!this.enabled()) return;
    if (a.kind === 'task') { addLines(a.text); toast('Task added from your phone.'); }
    if (a.kind === 'approve') {
      // the server refuses these already; checked again here, where the request lives
      if (a.yes && approvalsInbox.get(a.card)?.danger) { ab.audit('remote-refused', { card: cardData(a.card)?.title || a.card }); return; }
      approvalsInbox.answer(a.card, a.yes, 'phone');
      toast(`${a.yes ? 'Approved' : 'Rejected'} from your phone: <b>${esc(cardData(a.card)?.title || '')}</b>`);
    }
    this.push();
  }

  // A device opened the link: you should recognize it.
  static deviceConnected(d) {
    const what = `${d.address} · ${d.browser.replace(/^Mozilla\/5\.0 \(([^)]*)\).*/, '$1')}`;
    toast(`A device connected to the remote: <b>${esc(what)}</b>. Not yours? Press <b>New Link</b> in Settings → Integrations.`, 10000);
    try { new Notification('A device connected to AgentBoard', { body: `${what}\nNot yours? Create a new link in Settings → Integrations.` }); } catch {}
  }

  // A random token for the link (old links stop working when it changes).
  static newToken() { return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
}

const remoteBridge = new RemoteBridge();
