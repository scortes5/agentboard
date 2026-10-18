// Records docs/images/demo.gif for the README: the real app with three scripted agents
// (scripts/demo/demo-agent.sh) taking three tasks in parallel, one asking for approval.
// Run on Linux: xvfb-run -a node scripts/demo/record-demo.js   (needs python3 with Pillow)
'use strict';
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images', 'demo.gif');
const FRAME_MS = 200;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const TODOS = 'Add coupon codes to the cart, with tests\nFind why the orders page is slow and fix it\nDocument the setup in the README !';

(async () => {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const data = tmp('ab-demo-data-'), home = tmp('ab-demo-home-'), frames = tmp('ab-demo-frames-');
  const repo = path.join(tmp('ab-demo-'), 'shop-api');
  fs.mkdirSync(repo);
  execSync('git init -q -b main && git config user.email demo@example.com && git config user.name demo && echo "# shop-api" > README.md && git add . && git commit -qm init', { cwd: repo });

  const app = await _electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', `--user-data-dir=${data}`, ROOT], env: { ...process.env, AGENTBOARD_DATA: data, HOME: home } });
  const win = await app.firstWindow();
  await win.waitForFunction(() => typeof cfg === 'object' && cfg && typeof addTask === 'function');
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1600, 1000); w.center(); });
  const agent = `bash ${path.join(__dirname, 'demo-agent.sh')}`;
  await win.evaluate(({ repo, agent }) => {
    if ($('#onboarding').open) $('#onboarding').close();
    for (const k of ['claude', 'codex', 'gemini']) Object.assign(cfg.agents[k], { command: agent, taskPrompt: 'arg', resumeArgs: '' });
    Object.assign(agentAvailable, { claude: true, codex: true, gemini: true });
    Object.assign(cfg, { onboarded: true, autoAgents: ['claude', 'codex', 'gemini'], taskAuto: true, taskRoute: false, crossReview: false, taskSubagents: false, taskCheckpoints: false, perAgentParallel: 1, });
    cfg.projects = [{ name: 'shop-api', path: repo }]; cfg.selectedProject = repo; cfg.activeSpace = repo;
    if (cfg.sidebarOpen) toggleSidebar();
    applyAppearance(); renderSpaces(); renderAgentButtons(); toggleTasks(true);
  }, { repo, agent });
  await wait(800);

  let n = 0, recording = true;
  const shoot = (async () => {
    while (recording) {
      const t0 = Date.now();
      await win.screenshot({ path: path.join(frames, `${String(n++).padStart(4, '0')}.png`) });
      await wait(Math.max(0, FRAME_MS - (Date.now() - t0)));
    }
  })();

  // Type the to-dos, add them, and let the queue spread them across the three subscriptions.
  for (let i = 0; i <= TODOS.length; i += 3) { await win.evaluate((t) => { $('#taskInput').value = t; }, TODOS.slice(0, i)); await wait(45); }
  await wait(600);
  await win.evaluate(() => { addFromComposer(); setTimeout(() => { arrange(); fitAll(); }, 900); });
  // Approve the permission request from the inbox once it shows up.
  for (let i = 0; i < 60; i++) {
    const id = await win.evaluate(() => approvalsInbox.pending()[0]?.[0]);
    if (id) { await wait(1500); await win.evaluate(() => $('#approvalsBtn').click()); await wait(1400); await win.evaluate(() => $('.popover.approvals [data-a="yes"]').click()); break; }
    await wait(250);
  }
  await win.waitForFunction(() => cfg.tasks.length === 3 && cfg.tasks.every((t) => t.status === 'done'), null, { timeout: 60000 });
  await wait(1200);
  await win.evaluate(() => $('#taskFilter [data-f="done"]').click());
  await wait(2500);
  recording = false;
  await shoot;
  app.process().kill('SIGKILL');

  execFileSync('python3', ['-I', '-c', `
import glob, sys
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '/*.png'))
frames = [Image.open(f).convert('RGB') for f in files]
w = 960
frames = [f.resize((w, round(f.height * w / f.width)), Image.LANCZOS) for f in frames]
pal = frames[len(frames) // 2].quantize(colors=200, method=Image.Quantize.MEDIANCUT)
out = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
durations = [${FRAME_MS}] * (len(out) - 1) + [2500]
out[0].save(sys.argv[2], save_all=True, append_images=out[1:], duration=durations, loop=0, optimize=True)
`, frames, OUT], { stdio: 'inherit' });
  console.log(`${n} frames → ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
})().catch((err) => { console.error(err); process.exit(1); });
