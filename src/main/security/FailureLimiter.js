// Slows down guessing: after too many failed attempts from one address in a window of time,
// that address is refused until the window passes.
'use strict';

class FailureLimiter {
  constructor({ max = 10, windowMs = 5 * 60_000, now = Date.now } = {}) {
    Object.assign(this, { max, windowMs, now });
    this.failures = new Map(); // address → times of recent failures
  }

  recent(addr) {
    const since = this.now() - this.windowMs;
    const list = (this.failures.get(addr) || []).filter((t) => t > since);
    this.failures.set(addr, list);
    return list;
  }

  blocked(addr) { return this.recent(addr).length >= this.max; }
  fail(addr) { this.recent(addr).push(this.now()); return this.blocked(addr); }
}

module.exports = { FailureLimiter };
