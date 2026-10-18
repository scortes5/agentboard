// Smoke test for every platform: opens the real app, checks that each IPC channel has a
// handler, opens a real terminal and reads what it prints, and opens every panel and dialog.
// CI runs it on macOS and Windows (the full end-to-end test runs on Linux).
// Run: npm run test:smoke   (on Linux without a display: xvfb-run -a npm run test:smoke)
'use strict';
const { _electron } = require('playwright-core');
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const step = (name) => console.log(`✓ ${name}`);

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-smoke-'));
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
  try {
    await win.waitForFunction(() => typeof cfg === 'object' && cfg && typeof addTask === 'function', null, { timeout: 60000 });
    step(`the app opens on ${process.platform}`);

    const handled = await app.evaluate(({ ipcMain }) => [...ipcMain._invokeHandlers.keys()]);
    const wanted = [...fs.readFileSync(path.join(ROOT, 'src/preload/index.js'), 'utf8').matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(wanted.filter((c) => !handled.includes(c)), []);
    step('every IPC channel has a handler');

    // A real terminal in the user's shell (zsh/bash, or PowerShell on Windows).
    // The command is typed as agentboard""-smoke-ok, so only the shell's output matches.
    const out = await win.evaluate(() => new Promise((resolve, reject) => {
      let text = '';
      ab.onPtyData((id, d) => { if (id !== 'smoke') return; text += d; if (text.includes('agentboard-smoke-ok')) resolve(text); });
      ab.ptyCreate({ id: 'smoke', cols: 100, rows: 30, command: 'echo agentboard""-smoke-ok' })
        .then((r) => { if (!r?.ok) reject(new Error(r?.error || 'pty:create failed')); });
      setTimeout(() => reject(new Error(`no output: ${text.slice(-300)}`)), 30000);
    }));
    assert.match(out, /agentboard-smoke-ok/);
    step('a real terminal runs a command');

    await win.evaluate(async () => {
      if ($('#onboarding').open) $('#onboarding').close();
      await openSettings('general');
      for (const sec of ['appearance', 'agents', 'rules', 'keys', 'projects', 'tasks', 'secrets', 'integrations', 'advanced']) showSettingsSection(sec);
      $('#settings').close();
      await openAccounts(); $('#accounts').close();
      await openSkills(); $('#skills').close();
      await openUsage(); $('#usage').close();
      toggleFlows(true); toggleFlows(false);
      toggleDiagram(true); toggleDiagram(false);
      toggleTasks(true); toggleSidebar(true);
      viewLayout.moveTo('approvals', 'left'); viewLayout.reset();
      openPalette(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      onboarding.open(); onboarding.finish();
    });
    await new Promise((r) => setTimeout(r, 1500));
    step('every panel and dialog opens');

    assert.deepEqual(errors, [], 'no errors in the window');
    console.log('Smoke test passed.');
  } finally {
    app.process().kill('SIGKILL');
  }
  process.exit(0); // the Playwright connection would keep Node waiting
})().catch((err) => { console.error(err); process.exit(1); });
