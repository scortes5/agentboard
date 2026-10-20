// AgentBoard — the window's startup: load the board, mount the cards and start every panel.
'use strict';

// ---------- Startup ----------
// Boards saved by Spanish-language versions (before 0.4) used Spanish values.
const LEGACY_TASK_STATUS = { pendiente: 'pending', en_curso: 'running', revisar: 'review', hecho: 'done', bloqueado: 'blocked' };
const LEGACY_MODE = { ligero: 'light', potente: 'heavy' };
function migrateLegacy(c) {
  for (const t of c.tasks || []) if (LEGACY_TASK_STATUS[t.status]) t.status = LEGACY_TASK_STATUS[t.status];
  for (const f of c.flows || []) {
    for (const n of f.nodes || []) if (n.config && LEGACY_MODE[n.config.mode]) n.config.mode = LEGACY_MODE[n.config.mode];
    for (const e of f.edges || []) if (e.branch === 'si') e.branch = 'yes';
    if (f.lastRun) f.lastRun.results = {};
  }
}

// Windows and Linux: the page's tooltips and key hints with Ctrl instead of the Mac symbols.
function localizeShortcuts(root) {
  for (const el of root.querySelectorAll('[title]')) el.title = keyLabel(el.title);
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/[⌘⇧⌥]/.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) n.nodeValue = keyLabel(n.nodeValue);
}

(async function init() {
  const res = await ab.loadConfig();
  // tasks.js and diagram.js load after this file
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  cfg = res.config;
  migrateLegacy(cfg);
  platform = res.platform;
  document.body.classList.toggle('mac', isMac());
  $('#cfgPath').textContent = res.configPath;
  $('#machine').textContent = cfg.machineName;

  renderProjects();
  renderAgentButtons();
  ab.checkAgents().then((r) => { agentAvailable = r; renderAgentButtons(); });

  if (!isMac()) localizeShortcuts(document.body);

  applyAppearance();
  renderSpaces();
  document.title = cfg.activeSpace && cfg.activeSpace !== '*' ? `${spaceName(cfg.activeSpace)} — AgentBoard` : 'AgentBoard';
  viewLayout.mount();
  // groups first, so they sit behind the cards
  for (const c of [...cfg.cards].sort((a, b) => (b.type === 'group') - (a.type === 'group'))) {
    mountCard(c, { resume: true });
    if (!inSpace(c)) runtime.get(c.id).el.style.display = 'none';
  }
  applyViewport();
  updateEmpty();
  renderSidebar();
  initTasks();
  initDiagram();
  initFlows();
  refreshGit();
  onboarding.maybeShow();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
})();
