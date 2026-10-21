// AgentBoard — terminal output and each card's status (working, waiting, stopped).
'use strict';

// ---------- PTY data ----------
ab.onPtyData((id, data) => {
  const rt = runtime.get(id);
  if (!rt || !rt.term) return;
  rt.term.write(data);
  const now = Date.now();
  if (now - rt.lastData > BUSY_MS) rt.busySince = now;
  rt.lastData = rt.lastActivity = now;
});

ab.onPtyExit((id, code) => {
  const rt = runtime.get(id);
  const c = cardData(id);
  if (!rt || !c) return;
  rt.alive = false;
  if (!rt.idleClosed) showOverlay(c, `The process exited (code ${code}).`);
});

// ---------- Idle close ----------
// Optional (Settings → General). Only agent cards with no task in progress are stopped: a plain
// shell may be running a quiet server, and a task's agent may be waiting for your answer.
// Locked cards are never stopped.
const hasActiveTask = (c) => (cfg.tasks || []).some((t) => t.cardId === c.id && (t.status === 'running' || t.status === 'review'));
function idleExpired(c, rt, now) {
  const min = +cfg.idleCloseMin || 0;
  return min > 0 && rt.alive && !!agentOf(c).command && now - (rt.lastActivity || now) >= min * 60_000 && !hasActiveTask(c) && !c.locked;
}

// Stops the process but keeps the card, so Restart resumes the same session.
function idleClose(c, rt) {
  rt.idleClosed = true;
  rt.alive = false;
  ab.ptyKill(c.id);
  showOverlay(c, `Stopped after ${cfg.idleCloseMin} minutes without activity. Restart resumes the session.`);
}

// Status: working / waiting / stopped + notify when an agent finishes
setInterval(() => {
  if (!cfg) return;
  const now = Date.now();
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.term) continue;
    if (idleExpired(c, rt, now)) idleClose(c, rt);
    const s = rt.statusEl;
    const busy = rt.alive && now - rt.lastData < BUSY_MS;
    const wasBusy = s.classList.contains('busy');
    rt.status = !rt.alive ? 'dead' : busy ? 'busy' : 'idle';
    s.className = 'status ' + rt.status;
    rt.el.classList.toggle('busy', busy);
    s.title = STATUS_LABEL[rt.status];
    const sideDot = sideItems.get(c.id)?.querySelector('.status');
    if (sideDot) { sideDot.className = 'status ' + rt.status; sideDot.title = s.title; }
    terminalWatchers.scan(c, rt, now);
    // Notify after >8 s of work; cards running a task notify through the task's own events.
    if (wasBusy && !busy && rt.alive && rt.lastData - rt.busySince > 8000 && !c.taskId) {
      notifyDesktop('idle', { cardId: c.id, text: c.title, summary: basename(c.cwd) });
    }
  }
  updateGroupMeta();
  updateSpaceBadges();
  updateSideCounts();
  drawMinimap();
}, 500);
