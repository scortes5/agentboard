// Plain text out of what a terminal printed: escape sequences removed and the TUI's
// redraws collapsed, so agents can read each other's output.
'use strict';

function stripAnsi(s) {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>78cDEHMNOZ]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// The last `lines` readable lines: for each line only what was left after carriage returns,
// without blank lines or immediate repeats.
function readableTail(raw, lines) {
  const out = [];
  for (const line of stripAnsi(raw).split('\n')) {
    const t = (line.split('\r').filter(Boolean).pop() || '').replace(/\s+$/, '');
    if (t.trim() && out[out.length - 1] !== t) out.push(t);
  }
  return out.slice(-lines).join('\n');
}

module.exports = { stripAnsi, readableTail };
