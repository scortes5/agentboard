// This machine's board (projects, cards, tasks and settings) in the app's data folder, never
// in a repository:  Mac ~/Library/Application Support/AgentBoard/board.json · Windows %APPDATA%\AgentBoard\board.json
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { IS_WIN } = require('./platform');
const { defaultAgents, previousArgs } = require('../agents/registry');
const { DEFAULTS: DESKTOP_DEFAULTS } = require('../notifications/DesktopNotifications');

class ConfigStore {
  // dataDir: where board.json lives (the app's userData folder).
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  get path() { return path.join(this.dataDir, 'board.json'); }

  defaults() {
    return {
      version: 1,
      machineName: os.hostname().replace(/\.local$/, ''),
      shell: '',               // empty = automatic (zsh/bash on Mac, PowerShell on Windows)
      fontSize: 13,
      resumeOnOpen: true,      // when the app reopens, relaunch agents with their "resume" args
      keepRunning: true,       // closing the window hides it; agents keep working (quit with ⌘Q / tray)
      idleCloseMin: 0,         // stop agent terminals idle this many minutes (0 = never); Restart resumes them
      desktopNotifications: { ...DESKTOP_DEFAULTS },
      maxParallel: 3,          // tasks running at once, across all subscriptions
      perAgentParallel: 2,     // tasks running at once per subscription
      taskWorktrees: false,    // each task in its own git worktree, so agents don't step on each other
      groupBranches: false,    // tasks of a #group share one worktree and branch, committed task by task
      groupPush: true,         // push the group's branch once all its tasks have finished
      autoCloseDone: true,     // close a task's terminals once it is done
      quickKey: 'Control+Alt+Space', // global shortcut: add a task from any app
      checkUpdates: true,      // look for a new release on start and every few hours
      tasks: [],
      agents: defaultAgents(),
      projects: [],            // [{ path, name, verify }]
      selectedProject: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      sidebarOpen: true,
      cards: [],
    };
  }

  // The saved board on top of the defaults; built-in agents get new default fields (light/normal/heavy
  // args), and args still set to an earlier default move to the current one.
  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      const base = this.defaults();
      const agents = { ...base.agents, ...(raw.agents || {}) };
      const old = previousArgs();
      for (const [k, a] of Object.entries(base.agents)) {
        for (const f of ['lightArgs', 'normalArgs', 'heavyArgs']) {
          const stale = agents[k][f] == null || !!old[k]?.[f]?.includes(agents[k][f]);
          if (stale && a[f]) agents[k] = { ...agents[k], [f]: a[f] };
        }
      }
      return { ...base, ...raw, agents };
    } catch {
      return this.defaults();
    }
  }

  // Atomic write, readable only by the current user (project paths, notes).
  save(cfg) {
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    if (!IS_WIN) { try { fs.chmodSync(this.dataDir, 0o700); } catch {} }
    const tmp = `${this.path}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.path);
  }
}

module.exports = { ConfigStore };
