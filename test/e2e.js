// End-to-end test: opens the real app (Electron, with real terminals) on a throwaway board
// and drives a task with test/fake-agent.sh standing in for a coding agent.
// Run: npm run test:e2e   (on Linux without a display: xvfb-run -a npm run test:e2e)
'use strict';
const { _electron } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await wait(400);
  }
}
const step = (name) => console.log(`✓ ${name}`);

// Runs scripts/agentboard-mcp.js like a CLI would and returns its answers by request id.
function mcpSession(dataDir, requests) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(process.execPath, [path.join(ROOT, 'scripts', 'agentboard-mcp.js')], { env: { ...process.env, AGENTBOARD_DATA: dataDir } });
    const answers = {};
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
        const msg = JSON.parse(buf.slice(0, i));
        answers[msg.id] = msg;
        if (Object.keys(answers).length === requests.length) { child.kill(); resolve(answers); }
      }
    });
    child.on('error', reject);
    setTimeout(() => { child.kill(); reject(new Error(`MCP server answered ${Object.keys(answers).length} of ${requests.length}`)); }, 15000);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + '\n');
  });
}

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-data-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-repo-'));
  execSync('git init -q && git config user.email test@example.com && git config user.name test && echo a > a.txt && git add . && git commit -qm init', { cwd: repo });

  const app = await _electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', `--user-data-dir=${data}`, ROOT],
    env: { ...process.env, AGENTBOARD_DATA: data },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  win.on('dialog', (d) => d.accept());
  await win.waitForFunction(() => typeof cfg === 'object' && cfg && typeof addTask === 'function');

  try {
    // Every channel the interface calls has a handler in the main process.
    const handled = await app.evaluate(({ ipcMain }) => [...ipcMain._invokeHandlers.keys()]);
    const wanted = [...fs.readFileSync(path.join(ROOT, 'src/preload/index.js'), 'utf8').matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(wanted.filter((c) => !handled.includes(c)), []);
    step('every IPC channel has a handler');

    // The MCP server each CLI runs gets its tools from the app (one file per tool) and calls them.
    const mcp = await mcpSession(data, [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_agents', arguments: {} } },
    ]);
    assert.deepEqual(mcp[2].result.tools.map((t) => t.name).sort(), ['add_task', 'complete_task', 'list_agents', 'list_tasks', 'read_agent_output', 'send_to_agent', 'start_agent']);
    assert.equal(mcp[3].result.isError, false);
    step('the MCP server lists and calls the bridge tools');

    const script = path.join(__dirname, 'fake-agent.sh');
    await win.evaluate(({ repo, script }) => {
      cfg.projects = [{ path: repo, name: 'demo', verify: 'grep -q hi2 out.txt' }];
      cfg.selectedProject = repo;
      for (const k of ['fake', 'fake2']) cfg.agents[k] = { label: k, command: `bash ${script}`, taskPrompt: 'arg', color: '#888888' };
      Object.assign(cfg, { autoAgents: ['fake', 'fake2'], taskAuto: true, tasksOpen: true, crossReview: true, taskSubagents: false });
      Object.assign(agentAvailable, { fake: true, fake2: true });
      addTask({ text: 'make out.txt', agent: 'fake', cwd: repo });
      tickTasks();
    }, { repo, script });

    const ask = await until(() => win.evaluate(() => [...approvals.entries()].map(([id, a]) => ({ id, ...a }))[0]));
    assert.ok(ask, 'the permission prompt reaches the approvals inbox');
    assert.match(ask.question, /Do you want to proceed/);
    assert.match(ask.context, /touch out\.txt/);
    step('permission prompt in the approvals inbox');
    await win.evaluate((id) => answerApproval(id, true), ask.id);

    const main = () => win.evaluate(() => cfg.tasks.find((x) => !x.reviewOf));
    const done = await until(async () => { const t = await main(); return t.status === 'done' && t; }, 40000);
    assert.ok(done, 'the task finishes');
    assert.equal(done.checkFailures, 1, 'the first DONE fails the checks and goes back to the agent');
    assert.match(done.summary, /fixed the check · checks passed/);
    assert.ok(done.checkpoint, 'a checkpoint was taken');
    step('failed checks go back to the agent, then pass');

    const review = await until(async () => (await main()).review, 30000);
    assert.equal(review?.status, 'done', 'the other subscription approves');
    step('cross-review by another subscription');

    await win.evaluate(() => openReview(cfg.tasks.find((x) => !x.reviewOf)));
    const files = await until(() => win.evaluate(() => [...document.querySelectorAll('#reviewFiles .rf-name')].map((e) => e.textContent).join()), 10000);
    assert.equal(files, 'out.txt');
    step('review dialog shows the diff');

    await win.evaluate(() => { $('#review').close(); return restoreCheckpoint(cfg.tasks.find((x) => !x.reviewOf)); });
    await until(() => !fs.existsSync(path.join(repo, 'out.txt')), 5000);
    assert.equal(fs.existsSync(path.join(repo, 'out.txt')), false, 'undo removes the file the task created');
    step('undo back to the checkpoint');

    const dep = await win.evaluate(() => {
      cfg.taskAuto = false;
      addLines('first thing\n> second thing');
      const a = cfg.tasks.find((x) => x.text === 'first thing'), b = cfg.tasks.find((x) => x.text === 'second thing');
      return { linked: b.after?.[0] === a.id, ready: depsReady(b) };
    });
    assert.deepEqual(dep, { linked: true, ready: false });
    step('"> " makes a task wait for the one above');

    await win.evaluate(() => { $('#taskInput').value = ''; insertTemplate(templates()[0].text); });
    assert.equal(await win.evaluate(() => { const i = $('#taskInput'); return i.value.slice(i.selectionStart, i.selectionEnd); }), '<METHOD>');
    step('templates select their first placeholder');

    // Settings: opens, shows the new controls, and saves them.
    await win.evaluate(() => openSettings('tasks'));
    await win.evaluate(() => { const f = $('#settingsForm'); f.taskBudgetK.value = 250; f.termFont.value = 'Menlo'; f.termFont.dispatchEvent(new Event('change')); });
    await win.evaluate(() => $('#saveSettings').click());
    await until(() => win.evaluate(() => cfg.taskBudgetK === 250 && cfg.ui?.termFont === 'Menlo'), 5000);
    assert.deepEqual(await win.evaluate(() => [cfg.taskBudgetK, cfg.ui?.termFont]), [250, 'Menlo']);
    step('Settings opens and saves the new controls');

    // A task pinned to a subscription that hits its limit moves to another one.
    await win.evaluate((repo) => { cfg.taskAuto = true; cfg.tasks = []; addTask({ text: 'hit the limit please', agent: 'fake', cwd: repo }); tickTasks(); }, repo);
    const moved = await until(() => win.evaluate(() => { const t = cfg.tasks[0]; return t.assigned === 'fake2' && cfg.exhausted?.fake && t; }), 30000);
    assert.ok(moved, 'the pinned task is reassigned to the other subscription');
    step('a subscription at its limit hands its task to another one');

    // Every subscription out: the limits screen, with ideas that do not repeat.
    await win.evaluate(() => {
      cfg.taskAuto = false;
      cfg.exhausted = { fake: Date.now() + 90 * 60000, fake2: Date.now() + 30 * 60000 };
      addTask({ text: 'waiting for a subscription', agent: 'auto' });
      checkAllLimited();
    });
    const limits = await win.evaluate(() => ({ open: $('#limits').open, when: $('#limitsWhen').textContent, idea: $('#limitsIdea').textContent }));
    assert.ok(limits.open && /Come back in (29|30) min/.test(limits.when) && limits.idea, JSON.stringify(limits));
    const ideas = await win.evaluate(() => { cfg.breakDeck = []; return Array.from({ length: 20 }, () => nextBreakIdea()); });
    assert.equal(new Set(ideas).size, 20, 'twenty different ideas before any repeats');
    step('all subscriptions out: "come back in" with the soonest reset and a fresh idea');

    assert.deepEqual(errors, [], 'no errors in the window');
    console.log('All end-to-end checks passed.');
  } finally {
    app.process().kill('SIGKILL');
  }
})().catch((err) => { console.error(err); process.exit(1); });
