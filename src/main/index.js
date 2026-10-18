// AgentBoard — main process entry point. The composition root: it builds every service with
// what it needs and hands them to the App. Each service owns one area and registers its own
// IPC channels; nothing else creates services or wires them together.
'use strict';
const { app } = require('electron');
const { ConfigStore } = require('./core/ConfigStore');
const { ShellEnv } = require('./shell/ShellEnv');
const { PtyHost } = require('./terminals/PtyHost');
const { GitRunner } = require('./git/GitRunner');
const { GitService } = require('./git/GitService');
const { WorktreeService } = require('./git/WorktreeService');
const { AgentCatalog } = require('./agents/AgentCatalog');
const { LocalModels } = require('./agents/LocalModels');
const { ClaudeAccounts } = require('./agents/ClaudeAccounts');
const { GroundRules } = require('./agents/GroundRules');
const { SkillLibrary } = require('./library/SkillLibrary');
const { SkillPack } = require('./library/SkillPack');
const { UsageService } = require('./library/UsageService');
const { TaskPlanner } = require('./ai/TaskPlanner');
const { AgentBridge } = require('./bridge/AgentBridge');
const { Updater } = require('./updates/Updater');
const { RemoteServer } = require('./remote/RemoteServer');
const { WebhookNotifier } = require('./integrations/WebhookNotifier');
const { GitHubIssues } = require('./integrations/GitHubIssues');
const { App } = require('./app/App');
const { AppMenu } = require('./app/AppMenu');
const { TrayIcon } = require('./app/TrayIcon');
const { QuickKey } = require('./app/QuickKey');
const { SystemIpc } = require('./app/SystemIpc');
const { WindowRequests } = require('./app/WindowRequests');

// Launched from inside a Claude Code session (e.g. `npm start` in its terminal), these
// variables would make the Claude instances in the cards refuse to start.
for (const k of Object.keys(process.env)) {
  if (/^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.+|ANTHROPIC_BASE_URL)$/.test(k)) delete process.env[k];
}

const dataDir = app.getPath('userData');
const config = new ConfigStore(dataDir);
const shellEnv = new ShellEnv(config);
shellEnv.loadPath();

let application = null; // created last; the services below reach the window through it
const send = (...args) => application?.send(...args);
const requests = new WindowRequests({ send, isOpen: () => !!application?.win && !application.win.isDestroyed() });

let bridge = null;
const ptyHost = new PtyHost({ shellEnv, send, getBridge: () => bridge });
bridge = new AgentBridge({
  dataDir, config, ptys: ptyHost.ptys,
  notify: (ev) => send('bridge:event', ev),
  askWindow: (kind, payload, ms) => requests.ask('bridge:ask', { kind, payload }, ms),
  requestNewCard: (opts) => requests.ask('bridge:new-card', opts),
});

const runner = new GitRunner();
const gitService = new GitService({ runner });
const claudeAccounts = new ClaudeAccounts({ config });
// Restarting to install stops the agents: ask first, like quitting.
const confirmRestart = () => { if (!application.confirmQuit()) return false; application.quitting = true; return true; };
const updater = new Updater({ send, config, onBeforeInstall: confirmRestart });
const menu = new AppMenu({ config, send, checkUpdates: () => updater.check(true), reload: () => application.win?.reload() });
const quickKey = new QuickKey({ config, onPress: () => { application.showWindow(); send('menu', 'quick-task'); } });

application = new App({
  config, ptyHost, bridge, menu, quickKey, updater,
  tray: new TrayIcon({ counts: () => ({ open: ptyHost.ptys.size, busy: bridge.busyIds().length }), onShow: () => application.showWindow(), onQuit: () => application.quit() }),
  services: [
    new SystemIpc({ config, getWindow: () => application.win }), requests, ptyHost, menu, quickKey, updater,
    gitService, new WorktreeService({ runner, gitService, shellEnv }),
    new AgentCatalog({ config, shellEnv }), new LocalModels({ shellEnv }), claudeAccounts,
    new GroundRules({ config, claudeAccounts }),
    new SkillLibrary({ config }), new SkillPack({ claudeAccounts }), new UsageService({ dataDir, claudeAccounts }),
    new TaskPlanner({ shellEnv }),
    new RemoteServer({ config, send }), new WebhookNotifier(), new GitHubIssues({ shellEnv }),
  ],
});
application.start();
