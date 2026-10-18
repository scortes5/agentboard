// AgentBoard — remote control: while it is on (Settings → Integrations), the window sends the
// main process a snapshot of the tasks and the permission requests every few seconds for the
// phone page, and runs what the phone asks (add a task, approve or reject a request).
'use strict';
/* global cfg, ab, tasks, cardData, runtime, liveOf, approvalsInbox, addLines, fmt, toast, esc */

const REMOTE_TASKS = 40;

class RemoteBridge {
  constructor({ every = 2000 } = {}) {
    ab.onRemoteAction((a) => this.act(a));
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
      approvals: approvalsInbox.pending().map(([card, a]) => ({ card, title: cardData(card).title, question: a.question, context: a.context })),
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
    if (a.kind === 'approve') { approvalsInbox.answer(a.card, a.yes); toast(`${a.yes ? 'Approved' : 'Rejected'} from your phone: <b>${esc(cardData(a.card)?.title || '')}</b>`); }
    this.push();
  }

  // A random token for the link (old links stop working when it changes).
  static newToken() { return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
}

const remoteBridge = new RemoteBridge();
