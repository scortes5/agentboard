// Takes the README and wiki screenshots (docs/images/*.png) from the real app, with the scripted
// agents of scripts/demo/demo-agent.sh at work, so they match the current interface.
// Run on Linux: xvfb-run -a -s "-screen 0 1700x1200x24" node scripts/demo/screenshots.js
'use strict';
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');
const SIZE = { width: 1600, height: 1049 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TODOS = 'Add coupon codes to the cart, with tests\nFind why the orders page is slow and fix it\nDocument the setup in the README !';

(async () => {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const data = tmp('ab-shots-data-'), home = tmp('ab-shots-home-');
  const repo = path.join(tmp('ab-shots-'), 'shop-api');
  fs.mkdirSync(repo);
  execSync('git init -q -b main && git config user.email demo@example.com && git config user.name demo && echo "# shop-api" > README.md && git add . && git commit -qm init', { cwd: repo });

  const app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', `--user-data-dir=${data}`, ROOT], env: { ...process.env, AGENTBOARD_DATA: data, HOME: home } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => typeof cfg === 'object' && cfg && typeof addTask === 'function');
  await app.evaluate(({ BrowserWindow }, size) => { const w = BrowserWindow.getAllWindows()[0]; w.setContentSize(size.width, size.height); w.center(); }, SIZE);
  const agent = `bash ${path.join(__dirname, 'demo-agent.sh')}`;
  await win.evaluate(({ repo, agent, TODOS }) => {
    if ($('#onboarding').open) $('#onboarding').close();
    for (const k of ['claude', 'codex', 'gemini']) Object.assign(cfg.agents[k], { command: agent, taskPrompt: 'arg', resumeArgs: '' });
    Object.assign(agentAvailable, { claude: true, codex: true, gemini: true });
    Object.assign(cfg, { onboarded: true, autoAgents: ['claude', 'codex', 'gemini'], taskAuto: true, taskRoute: false, crossReview: false, taskSubagents: false, taskCheckpoints: false, perAgentParallel: 1 });
    cfg.projects = [{ name: 'shop-api', path: repo, budgetWeekK: 4000 }]; cfg.selectedProject = repo; cfg.activeSpace = repo;
    cfg.ui = { ...ui(), theme: 'light' };
    applyAppearance(); renderSpaces(); renderAgentButtons(); toggleSidebar(true); toggleTasks(true);
    $('#taskInput').value = TODOS;
    addFromComposer();
    setTimeout(() => { arrange(); fitAll(); }, 900);
  }, { repo, agent, TODOS });
  const shot = async (name, prep) => {
    if (prep) await win.evaluate(prep);
    await wait(700);
    await win.evaluate(() => { $('#toasts').innerHTML = ''; }); // notices from earlier steps
    await win.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`✓ ${name}.png`);
  };

  // While the agents work: one asks for permission, so Tasks and Approvals have something to show.
  await win.waitForFunction(() => approvalsInbox.pending().length > 0, null, { timeout: 30000 });
  await shot('tasks');
  await shot('diagram', () => toggleDiagram(true));
  await win.evaluate(() => toggleDiagram(false));
  await win.evaluate(() => approvalsInbox.answer(approvalsInbox.pending()[0][0], true));
  await win.waitForFunction(() => cfg.tasks.every((t) => t.status === 'done'), null, { timeout: 60000 });
  await shot('board', () => { $('#taskFilter [data-f="done"]').click(); fitAll(); });
  await shot('board-dark', () => { cfg.ui = { ...cfg.ui, theme: 'dark' }; applyAppearance(); });
  await win.evaluate(() => { cfg.ui = { ...cfg.ui, theme: 'light' }; applyAppearance(); });
  await shot('palette', () => { openPalette(); $('#palInput').value = 're'; $('#palInput').dispatchEvent(new Event('input')); });
  await win.evaluate(() => closePalette());
  await shot('automations', async () => {
    toggleFlows(true);
    const f = await flowTemplates.create('review');
    nodeSel = f.nodes[2].id; renderFlow();
  });
  await win.evaluate(() => toggleFlows(false));
  await shot('settings', () => openSettings('security'));
  await shot('shortcuts', () => showSettingsSection('keys'));

  app.process().kill('SIGKILL');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
