// AgentBoard — what the agent bridge asks the window: subagent cards and events.
'use strict';

// ---------- Agent bridge events ----------
ab.onBridgeEvent((ev) => {
  const from = cardData(ev.from)?.title || 'An agent';
  const to = cardData(ev.to)?.title || 'another agent';
  if (ev.kind === 'send') { ping(ev.to); toast(`${esc(from)} <b>→</b> ${esc(to)}`); }
  else if (ev.kind === 'start') { toast(`${esc(from)} opened <b>${esc(to)}</b>`); }
});

// Where a subagent appears: inside its parent's group, or right next to the parent card,
// so you can watch it work beside the agent that opened it.
function spotNear(parent) {
  const g = parent.groupId && cardData(parent.groupId);
  if (g) return slotIn(g);
  const free = (x, y) => !cfg.cards.some((o) => o.type !== 'group' && x < o.x + o.w + 20 && x + DEFAULT_W + 20 > o.x && y < o.y + o.h + 20 && y + DEFAULT_H + 20 > o.y);
  // right of the parent, then below it, moving outwards until a free spot appears
  for (let ring = 0; ring < 6; ring++) {
    for (const [x, y] of [[parent.x + (parent.w + 28) * (ring + 1), parent.y], [parent.x, parent.y + (parent.h + 28) * (ring + 1)],
      [parent.x + (parent.w + 28) * (ring + 1), parent.y + (parent.h + 28) * (ring + 1)]]) {
      if (free(x, y)) return { x, y };
    }
  }
  return looseSpot();
}

ab.onBridgeNewCard(async ({ reqId, agent, cwd, title, light, from }) => {
  // light: subagent on the cheap model; parent: who asked for it (drawn as a link in the diagram)
  const parent = from && cardData(from);
  const max = cfg.maxSubagents || 4;
  if (parent && cfg.cards.filter((x) => x.parent === parent.id && runtime.get(x.id)?.alive).length >= max) {
    toast(`${esc(parent.title)} tried to open more than ${max} subagents at once.`, 5000);
    return ab.bridgeCardCreated(reqId, null);
  }
  const c = cfg.agents[agent] ? newCard('term', agent, {
    cwd, title: title || (parent ? `↳ ${cfg.agents[agent].label}` : undefined), args: light ? (cfg.agents[agent].lightArgs || '') : '', parent: from,
    noFocus: !!parent, ...(parent ? spotNear(parent) : {}),
  }) : null;
  if (c && parent?.taskId) c.parentTask = parent.taskId;
  if (c) await saveNow(); // the bridge reads the saved board
  ab.bridgeCardCreated(reqId, c ? c.id : null);
  if (c && typeof renderTasks === 'function') renderTasks();
});
