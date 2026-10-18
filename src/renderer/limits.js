// AgentBoard — when every subscription has hit its usage limit: say when the first one
// comes back, and suggest something nice to do meanwhile. The suggestions are drawn from a
// shuffled deck, so none repeats until all of them have been shown.
'use strict';
/* global cfg, $, save, autoAgents, exhaustedUntil, tasks */

const BREAK_IDEAS = [
  'Take a walk around the block.',
  'Grab a cup of coffee, or a tea.',
  'Catch up on the news.',
  'Stretch your back, neck and shoulders.',
  'Drink a glass of water.',
  'Call someone you have not talked to in a while.',
  'Step outside and get some sunlight.',
  'Read a few pages of a book.',
  'Tidy up your desk.',
  'Plan tomorrow\'s tasks while you wait.',
  'Listen to a song you love, start to finish.',
  'Do ten minutes of exercise.',
  'Write down one thing you learned today.',
  'Look out the window and rest your eyes.',
  'Cook yourself something good.',
  'Take a short nap. Twenty minutes is plenty.',
  'Water your plants.',
  'Review some code by hand, the old-fashioned way.',
  'Breathe slowly for five minutes.',
  'Sketch the next feature on paper.',
];

// Next idea from the deck; a new deck never starts with the idea just shown.
function nextBreakIdea() {
  let deck = Array.isArray(cfg.breakDeck) ? cfg.breakDeck.filter((i) => i < BREAK_IDEAS.length) : [];
  if (!deck.length) {
    deck = BREAK_IDEAS.map((_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    if (deck[deck.length - 1] === cfg.lastBreakIdea) deck.unshift(deck.pop());
  }
  const idea = deck.pop();
  cfg.breakDeck = deck; cfg.lastBreakIdea = idea;
  save();
  return BREAK_IDEAS[idea];
}

// When the first exhausted subscription comes back, if all of them are out (else 0).
function allLimitedUntil() {
  const subs = autoAgents();
  if (!subs.length) return 0;
  const until = subs.map(exhaustedUntil);
  return until.every(Boolean) ? Math.min(...until) : 0;
}

const fmtWait = (ms) => {
  const m = Math.max(1, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};

function renderLimits(until) {
  const at = new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#limitsWhen').textContent = `Come back in ${fmtWait(until - Date.now())} (around ${at}).`;
}

let limitsShownFor = 0;
// Called every second by the task loop: opens once per "everything is out" episode.
function checkAllLimited() {
  const until = allLimitedUntil();
  const dlg = $('#limits');
  if (!until) { limitsShownFor = 0; if (dlg.open) dlg.close(); return; }
  if (dlg.open) return renderLimits(until);
  if (limitsShownFor === until || !tasks().some((t) => t.status === 'pending')) return;
  limitsShownFor = until;
  renderLimits(until);
  $('#limitsIdea').textContent = nextBreakIdea();
  dlg.showModal();
  if (!document.hasFocus()) {
    try { new Notification('You have reached your limits', { body: `${$('#limitsWhen').textContent} ${$('#limitsIdea').textContent}` }); } catch {}
  }
}

$('#limitsAnother').onclick = () => { $('#limitsIdea').textContent = nextBreakIdea(); };
