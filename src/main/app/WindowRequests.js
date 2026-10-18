// Requests only the window can answer (open a card for a subagent, add a task): each goes out
// with an id and resolves when the answer with that id comes back, or with null after a timeout.
'use strict';

class WindowRequests {
  constructor({ send, isOpen }) {
    Object.assign(this, { send, isOpen });
    this.pending = new Map();
  }

  ask(channel, payload, ms = 5000) {
    return new Promise((resolve) => {
      if (!this.isOpen()) return resolve(null);
      const reqId = Math.random().toString(36).slice(2);
      this.pending.set(reqId, resolve);
      this.send(channel, { reqId, ...payload });
      setTimeout(() => { if (this.pending.delete(reqId)) resolve(null); }, ms);
    });
  }

  answer(reqId, value) {
    this.pending.get(reqId)?.(value);
    this.pending.delete(reqId);
  }

  register(ipcMain) {
    ipcMain.on('bridge:answer', (_e, reqId, value) => this.answer(reqId, value));
    ipcMain.on('bridge:card-created', (_e, reqId, id) => this.answer(reqId, id));
  }
}

module.exports = { WindowRequests };
