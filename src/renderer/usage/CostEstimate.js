// AgentBoard — what the tokens would cost at API prices, as a reference: with a subscription
// you don't pay per token, but it shows which projects and tasks are expensive. Prices are $
// per million tokens, editable in Settings → Tasks (Claude Sonnet's by default).
'use strict';
/* global cfg */

const DEFAULT_API_PRICES = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };

class CostEstimate {
  static prices() { return { ...DEFAULT_API_PRICES, ...(cfg.apiPrices || {}) }; }

  // $ for { input, output, cacheRead, cacheWrite } token counts.
  static of(t) {
    const p = CostEstimate.prices();
    return ((t.input || 0) * p.input + (t.output || 0) * p.output + (t.cacheRead || 0) * p.cacheRead + (t.cacheWrite || 0) * p.cacheWrite) / 1e6;
  }

  // $ per token on average, from the mix of all agents (to price totals that have no breakdown).
  static perToken(byAgent) {
    const all = Object.values(byAgent || {}).reduce((s, a) => {
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) s[k] += a[k] || 0;
      return s;
    }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    const tokens = all.input + all.output + all.cacheRead + all.cacheWrite;
    return tokens ? CostEstimate.of(all) / tokens : CostEstimate.prices().input / 1e6;
  }

  static fmt(dollars) {
    if (dollars >= 1000) return `$${Math.round(dollars).toLocaleString('en-US')}`;
    return `$${dollars.toFixed(dollars >= 10 ? 0 : 2)}`;
  }
}
