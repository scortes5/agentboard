// AgentBoard — flags a card whose terminal prints a line that almost always means trouble
// (a failing build, a stack trace, an API or rate-limit error), so it is noticed right away.
'use strict';
/* global cfg, runtime, terminalTail, sideItems, focusedId, toast, esc, terminalWatchers */

const ERROR_RE = /^\s*(?:[✗✘×⨯]\s|(?:error|fatal|panic)(?:\[\w+\])?:|npm ERR!|Traceback \(most recent call last\)|Uncaught |Unhandled |FAIL(?:ED)?\b|API Error|Error: |\w*(?:Error|Exception): )|command not found|Permission denied|EACCES|ENOENT|ECONNREFUSED|rate limit|overloaded_error|Request timed out/i;

class ErrorWatch {
  constructor() {
    this.name = 'errors';
    this.every = 2000;
  }

  enabled() { return cfg.watchErrors !== false; }

  // Only new output is read; the same line is not flagged twice.
  scan(c, rt) {
    if (rt.lastData <= (rt.errorsReadAt || 0)) return;
    rt.errorsReadAt = Date.now();
    const hit = terminalTail(c, 12, true).split('\n').reverse().find((l) => ERROR_RE.test(l) && l.trim().length > 3);
    if (!hit || hit === rt.lastAlertLine) return;
    rt.lastAlertLine = hit;
    this.mark(c, hit.trim().slice(0, 200));
  }

  lineOf(id) { return runtime.get(id)?.alert?.line || ''; }

  mark(c, line) {
    const rt = c && runtime.get(c.id);
    if (!rt?.alertEl) return;
    const first = !rt.alert && line;
    rt.alert = line ? { line, at: Date.now() } : null;
    rt.alertEl.classList.toggle('hidden', !line);
    rt.alertEl.title = line ? `Possible error (click the card to dismiss):\n${line}` : '';
    rt.el.classList.toggle('alerted', !!line);
    sideItems.get(c.id)?.classList.toggle('alerted', !!line);
    if (first && focusedId !== c.id) {
      toast(`<b>${esc(c.title)}</b>: ${esc(line.slice(0, 120))}`, 6000);
      if (!document.hasFocus()) { try { new Notification(`Possible error in ${c.title}`, { body: line.slice(0, 160) }); } catch {} }
    }
    if (typeof updateTaskLive === 'function') updateTaskLive();
  }

  clear(c) { if (runtime.get(c?.id)?.alert) this.mark(c, null); }
}

const errorWatch = terminalWatchers.add(new ErrorWatch());
