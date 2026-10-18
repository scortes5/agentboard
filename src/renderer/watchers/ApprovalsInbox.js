// AgentBoard — approvals inbox: every agent asking for permission ("Do you want to proceed?",
// "Allow execution?", "Would you like to run…?"), in one list you can answer without visiting
// each card. Claude Code, Codex and Gemini all put "Yes" first, so approving moves the
// selection to the top and confirms; rejecting presses Esc.
'use strict';
/* global $, esc, ab, cardData, terminalTail, toast, icon, focusCardView, focusCard, openPopover, closePopover,
   diagramOpen, toggleDiagram, terminalWatchers */

const APPROVAL_RE = /(Do you want to (proceed|make this edit|create|delete|run|allow|overwrite)|Would you like to (run|make|apply)|Allow (this )?(command|execution|edit|tool|change)|requires? (your )?(approval|permission)|Approve this)/i;
const OPTION_RE = /^\s*(?:[❯›>●]\s*)?\d+\.\s/;

class ApprovalsInbox {
  constructor() {
    this.name = 'approvals';
    this.every = 1000;
    this.waiting = new Map(); // card id → { question, context, at }
    $('#approvalsBtn').onclick = (e) => this.open(e.currentTarget);
  }

  enabled() { return true; }
  get(id) { return this.waiting.get(id); }

  // What the agent asks and the lines just above it (the command or file).
  static read(c) {
    const lines = terminalTail(c, 18, true).split('\n').map((l) => l.replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ').trim());
    const qi = lines.map((l) => APPROVAL_RE.test(l)).lastIndexOf(true);
    if (qi < 0 || !lines.slice(qi + 1).some((l) => OPTION_RE.test(l) || /\(y\/n\)|\[y\/N\]/i.test(l))) return null;
    const context = lines.slice(Math.max(0, qi - 6), qi).filter((l) => l && !OPTION_RE.test(l)).slice(-4);
    return { question: lines[qi], context: context.join('\n') };
  }

  // Only idle cards can be waiting for an answer.
  scan(c, rt) {
    const had = this.waiting.get(c.id);
    const found = rt.alive && rt.status === 'idle' ? ApprovalsInbox.read(c) : null;
    if (!found) { if (had) { this.waiting.delete(c.id); this.renderBadge(); } return; }
    if (had && had.question === found.question && had.context === found.context) return;
    this.waiting.set(c.id, { ...found, at: Date.now() });
    this.renderBadge();
    if (had) return;
    toast(`<b>${esc(c.title)}</b> asks: ${esc(found.question.slice(0, 90))}`, 5000);
    if (!document.hasFocus()) {
      try { new Notification(`${c.title} needs your approval`, { body: [found.context, found.question].filter(Boolean).join('\n').slice(0, 180) }); } catch {}
    }
  }

  async answer(id, yes) {
    if (!this.waiting.delete(id)) return;
    if (yes) {
      for (let i = 0; i < 4; i++) { ab.ptyWrite(id, '\x1b[A'); await new Promise((r) => setTimeout(r, 60)); }
      ab.ptyWrite(id, '\r');
    } else {
      ab.ptyWrite(id, '\x1b');
    }
    this.renderBadge();
    if (typeof updateTaskLive === 'function') updateTaskLive();
  }

  pending() { return [...this.waiting].filter(([id]) => cardData(id)); }

  renderBadge() {
    const n = this.pending().length;
    $('#approvalsBadge').textContent = String(n);
    $('#approvalsBadge').classList.toggle('hidden', !n);
    $('#approvalsBtn').classList.toggle('attn', n > 0);
  }

  open(anchor) {
    closePopover();
    const items = this.pending();
    const pop = document.createElement('div');
    pop.className = 'popover approvals';
    pop.innerHTML = items.length ? `
      <div class="ap-head"><b>${items.length} waiting</b><span class="spacer"></span>
        <button data-all title="Approve every request in the list">Approve All</button></div>
      ${items.map(([id, a]) => `<div class="ap-item" data-id="${esc(id)}">
        <div class="ap-title">${esc(cardData(id).title)}</div>
        ${a.context ? `<pre class="ap-ctx">${esc(a.context)}</pre>` : ''}
        <div class="ap-q">${esc(a.question)}</div>
        <div class="row"><button data-a="go" class="ghost" title="Go to the card">${icon('focus', 13)}</button><span class="spacer"></span>
          <button data-a="no" title="Reject (Esc): the agent will ask what to do instead">Reject</button>
          <button data-a="yes" class="primary" title="Allow this once">Approve</button></div>
      </div>`).join('')}`
      : '<div class="hint">No agent is waiting for permission.</div>';
    openPopover(pop, anchor, 360);
    pop.addEventListener('click', (e) => {
      if (e.target.closest('[data-all]')) { for (const [id] of items) this.answer(id, true); closePopover(); return; }
      const act = e.target.closest('[data-a]')?.dataset.a;
      const id = e.target.closest('.ap-item')?.dataset.id;
      if (!act || !id) return;
      if (act === 'go') {
        const c = cardData(id);
        if (diagramOpen()) toggleDiagram(false);
        closePopover(); focusCardView(c); focusCard(c.id);
        return;
      }
      this.answer(id, act === 'yes');
      e.target.closest('.ap-item').remove();
      if (!pop.querySelector('.ap-item')) closePopover();
    });
  }
}

const approvalsInbox = terminalWatchers.add(new ApprovalsInbox());
