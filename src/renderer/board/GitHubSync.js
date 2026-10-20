// AgentBoard — keeps every project's branches in step with GitHub. Every few minutes it fetches
// each project and fast-forwards the local branches that are only behind and not checked out
// (so no working folder changes by itself); "Pull All" in the Branches view does the same now and
// also updates checked-out branches without uncommitted changes. Turned off with Auto there.
'use strict';
/* global ab, cfg, esc, save, toast, refreshGit */

class GitHubSync {
  constructor() {
    this.minutes = 15;
    this.last = new Map();   // project folder -> last sync (this session)
    this.errors = new Map(); // project folder -> why its last automatic sync failed
    this.busy = false;
    // the first round waits a bit so starting the app stays fast
    setTimeout(() => { this.tick(); setInterval(() => this.tick(), 60_000); }, 90_000);
  }

  enabled() { return cfg?.branchAutoSync !== false; }

  setEnabled(on) {
    cfg.branchAutoSync = !!on; save();
    toast(on ? `Branches will follow GitHub: every ${this.minutes} minutes, branches that are not checked out are fast-forwarded.` : 'Automatic sync with GitHub is off; use Pull All when you want it.', 5000);
    if (on) this.tick();
  }

  // One project at a time, quietly: a project without GitHub, or offline, just waits for the next round.
  async tick() {
    if (!this.enabled() || this.busy || !cfg) return;
    this.busy = true;
    let moved = false;
    try {
      for (const p of [...new Set(cfg.projects.map((x) => x.path))]) {
        if (Date.now() - (this.last.get(p) || 0) < this.minutes * 60_000) continue;
        this.last.set(p, Date.now());
        const r = await ab.gitPull(p, { auto: true });
        if (!r.ok) { this.errors.set(p, r.error); continue; }
        this.errors.delete(p);
        if (r.value.updated.length) moved = true;
      }
    } finally { this.busy = false; }
    if (moved) refreshGit();
  }

  static summary({ updated, skipped }) {
    const up = updated.length ? `Updated ${updated.map((u) => `<b>${esc(u.name)}</b> (+${u.commits})`).join(', ')}.` : 'Every branch was already up to date.';
    const left = skipped.length ? ` Left alone: ${skipped.map((s) => `${esc(s.name)} (${esc(s.why)})`).join('; ')}.` : '';
    return up + left;
  }

  async pullNow(folder) {
    this.last.set(folder, Date.now());
    const r = await ab.gitPull(folder);
    if (!r.ok) toast(`Could not pull from GitHub: ${esc(r.error)}`, 7000);
    else toast(`Pulled from GitHub. ${GitHubSync.summary(r.value)}`, r.value.skipped.length ? 9000 : 4500);
    refreshGit();
    return r;
  }
}

const githubSync = new GitHubSync();
