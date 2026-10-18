// AgentBoard — watchers read what each terminal shows and react (an error, a permission
// prompt…). The status loop asks every registered watcher, each at its own pace; a new kind
// of detection is a new watcher class registered with terminalWatchers.add(), nothing else.
'use strict';

class TerminalWatchers {
  constructor() {
    this.watchers = [];
  }

  // A watcher has: name, every (ms between scans), enabled() and scan(card, runtime, now).
  add(watcher) {
    this.watchers.push(watcher);
    return watcher;
  }

  scan(c, rt, now) {
    const last = rt.watchedAt || (rt.watchedAt = {});
    for (const w of this.watchers) {
      if (!w.enabled() || now - (last[w.name] || 0) < w.every) continue;
      last[w.name] = now;
      w.scan(c, rt, now);
    }
  }
}

const terminalWatchers = new TerminalWatchers();
