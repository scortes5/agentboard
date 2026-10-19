// AgentBoard — "Send to…": hand part of a conversation to another agent.
'use strict';

// ---------- Send to… (hand context to another agent) ----------
// Cards that can receive text: running agents, never plain terminals.
const canReceive = (c) => c.type === 'term' && !c.startCmd && !!agentOf(c).command && c.bridge !== false && runtime.get(c.id)?.alive;

// The selection wins when the user marked something (for "Send to…"); pass screen=true to
// always read what the terminal shows.
function terminalTail(c, n = 40, screen = false) {
  const term = runtime.get(c.id)?.term;
  if (!term) return '';
  if (!screen && term.hasSelection()) return term.getSelection().trim();
  const b = term.buffer.active;
  const end = b.baseY + b.cursorY;
  const lines = [];
  for (let i = Math.max(0, end - n * 3); i <= end; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim().split('\n').slice(-n).join('\n');
}

function handoffMenu(c, anchor) {
  closePopover();
  const targets = cfg.cards.filter((x) => x.id !== c.id && canReceive(x));
  const fresh = Object.entries(cfg.agents).filter(([, a]) => a.command && !a.hidden);
  const pop = document.createElement('div');
  pop.className = 'popover handoff';
  pop.innerHTML = `
    <label>To
      <select name="to">
        ${targets.map((x) => `<option value="card:${esc(x.id)}">${esc(x.title)} · ${esc(agentOf(x).label)}</option>`).join('')}
        ${fresh.map(([k, a]) => `<option value="new:${esc(k)}">New ${esc(a.label)} in ${esc(basename(c.cwd) || '~')}</option>`).join('')}
      </select></label>
    <label>Instruction <input name="ask" value="Continue with this:" /></label>
    <label>Context (selection or last lines) <textarea name="ctx"></textarea></label>
    <div class="row"><button data-x="cancel">Cancel</button><button data-x="send" class="primary" title="Paste the instruction and context into the chosen agent">Send</button></div>`;
  $('[name=ctx]', pop).value = terminalTail(c);
  openPopover(pop, anchor, 380);
  $('[name=ask]', pop).focus();

  pop.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'cancel') return closePopover();
    if (x !== 'send') return;
    const to = $('[name=to]', pop).value;
    const ctx = $('[name=ctx]', pop).value.trim();
    const text = `${$('[name=ask]', pop).value.trim()}\n\n[Context from ${c.title} (${agentOf(c).label})]\n${ctx}`.trim();
    closePopover();
    if (to.startsWith('card:')) {
      const target = cardData(to.slice(5));
      await ab.ptyPaste(target.id, text);
      ping(target.id);
      toast(`${esc(c.title)} <b>→</b> ${esc(target.title)}`);
      addLink(c.id, target.id, 'sent context');
    } else {
      const target = newCard('term', to.slice(4), { cwd: c.cwd, x: c.x + c.w + 28, y: c.y });
      addLink(c.id, target.id, 'sent context');
      toast(`Opening ${esc(target.title)} and sending it the context…`);
      await waitAlive(target.id);
      await new Promise((r) => setTimeout(r, 3500)); // let the CLI finish starting
      await ab.ptyPaste(target.id, text);
      ping(target.id);
    }
  });
}

async function waitAlive(id, ms = 8000) {
  const t0 = Date.now();
  while (!runtime.get(id)?.alive && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 150));
}
