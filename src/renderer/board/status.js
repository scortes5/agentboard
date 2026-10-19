// AgentBoard — terminal output and each card's status (working, waiting, stopped).
'use strict';

// ---------- PTY data ----------
ab.onPtyData((id, data) => {
  const rt = runtime.get(id);
  if (!rt || !rt.term) return;
  rt.term.write(data);
  const now = Date.now();
  if (now - rt.lastData > BUSY_MS) rt.busySince = now;
  rt.lastData = now;
});

ab.onPtyExit((id, code) => {
  const rt = runtime.get(id);
  const c = cardData(id);
  if (!rt || !c) return;
  rt.alive = false;
  showOverlay(c, `The process exited (code ${code}).`);
});

// Status: working / waiting / stopped + notify when an agent finishes
setInterval(() => {
  if (!cfg) return;
  const now = Date.now();
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.term) continue;
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
    // Notify if it worked for >8 s and you are not looking at it
    if (wasBusy && !busy && rt.lastData - rt.busySince > 8000 && (!document.hasFocus() || focusedId !== c.id)) {
      try { new Notification(`${c.title} finished`, { body: basename(c.cwd), silent: false }); } catch {}
    }
  }
  updateGroupMeta();
  updateSpaceBadges();
  updateSideCounts();
  drawMinimap();
}, 500);
