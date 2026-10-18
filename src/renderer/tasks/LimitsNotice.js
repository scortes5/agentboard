// AgentBoard — when every subscription has hit its usage limit: say when the first one comes
// back, and suggest something nice to do meanwhile. Ideas come from a shuffled deck, so none
// repeats until all of them have been shown.
'use strict';
/* global cfg, $, save, autoAgents, exhaustedUntil, tasks, fmt */

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

class LimitsNotice {
  constructor(ideas = BREAK_IDEAS) {
    this.ideas = ideas;
    this.shownFor = 0; // the reset time the notice was last opened for
    $('#limitsAnother').onclick = () => { $('#limitsIdea').textContent = this.nextIdea(); };
  }

  // Next idea from the deck (kept in the board); a new deck never starts with the idea just shown.
  nextIdea() {
    let deck = Array.isArray(cfg.breakDeck) ? cfg.breakDeck.filter((i) => i < this.ideas.length) : [];
    if (!deck.length) {
      deck = this.ideas.map((_, i) => i);
      for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
      if (deck[deck.length - 1] === cfg.lastBreakIdea) deck.unshift(deck.pop());
    }
    const idea = deck.pop();
    cfg.breakDeck = deck; cfg.lastBreakIdea = idea;
    save();
    return this.ideas[idea];
  }

  // When the first exhausted subscription comes back, if all of them are out (else 0).
  allOutUntil() {
    const until = autoAgents().map(exhaustedUntil);
    return until.length && until.every(Boolean) ? Math.min(...until) : 0;
  }

  render(until) {
    $('#limitsWhen').textContent = `Come back in ${fmt.wait(until - Date.now())} (around ${fmt.clock(until)}).`;
  }

  // Called every second by the task loop: opens once each time everything runs out.
  check() {
    const until = this.allOutUntil();
    const dlg = $('#limits');
    if (!until) { this.shownFor = 0; if (dlg.open) dlg.close(); return; }
    if (dlg.open) return this.render(until);
    if (this.shownFor === until || !tasks().some((t) => t.status === 'pending')) return;
    this.shownFor = until;
    this.render(until);
    $('#limitsIdea').textContent = this.nextIdea();
    dlg.showModal();
    if (!document.hasFocus()) {
      try { new Notification('You have reached your limits', { body: `${$('#limitsWhen').textContent} ${$('#limitsIdea').textContent}` }); } catch {}
    }
  }
}

const limitsNotice = new LimitsNotice();
