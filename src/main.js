// AgentBoard — main process (Electron)
// Owns the window, the menus, the tray and the app's lifecycle, and wires the modules
// that answer the interface: terminals (pty-host), git, agents, library, ai.

const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, nativeTheme, globalShortcut, clipboard } = require('electron');
const path = require('path');
const { IS_MAC } = require('./platform');
const { loadConfig, saveConfig, configPath } = require('./config');
const { loadShellPath } = require('./shell-env');
const { createPtyHost } = require('./pty-host');
const { createBridge } = require('./bridge');
const { createUpdater } = require('./updates');

// If AgentBoard was launched from inside a Claude Code session (e.g. `npm start` in its
// terminal), these variables would make the Claude instances in cards refuse to start.
// Card shells are login shells, so anything set in the user's profile is loaded again.
for (const k of Object.keys(process.env)) {
  if (/^(CLAUDECODE|CLAUDE_CODE_.+|CLAUDE_AGENT_SDK_.+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_.+|ANTHROPIC_BASE_URL)$/.test(k)) delete process.env[k];
}

let win = null;
let bridge = null;
function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

const ptyHost = createPtyHost({ send, getBridge: () => bridge });
const { ptys, killAll } = ptyHost;
ptyHost.register(ipcMain);
for (const mod of ['./git', './agents', './library', './ai']) require(mod).register(ipcMain);

// ---------- Config / dialogs ----------
ipcMain.handle('config:load', () => ({ config: loadConfig(), platform: process.platform, configPath: configPath() }));
ipcMain.handle('config:save', (_e, cfg) => { saveConfig(cfg); return true; });
ipcMain.handle('config:reveal', () => shell.showItemInFolder(configPath()));

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.on('clip:write', (_e, text) => clipboard.writeText(String(text ?? '')));
ipcMain.handle('clip:read', () => clipboard.readText());

// Dock badge: tasks waiting for your review.
ipcMain.on('app:badge', (_e, n) => { if (IS_MAC) app.dock?.setBadge(n > 0 ? String(n) : ''); });

// ---------- Global shortcut: add a task from any app ----------
let quickKey = null;
function registerQuickKey() {
  const want = loadConfig().quickKey || '';
  if (want === quickKey) return { ok: true };
  if (quickKey) { try { globalShortcut.unregister(quickKey); } catch {} }
  quickKey = null;
  if (!want) return { ok: true };
  let ok = false;
  try { ok = globalShortcut.register(want, () => { showWindow(); send('menu', 'quick-task'); }); } catch {}
  if (ok) quickKey = want;
  return ok ? { ok: true } : { ok: false, error: `Could not register ${want} (is another app using it?).` };
}
ipcMain.handle('app:quickKey', () => registerQuickKey());

// ---------- Bridge between agents (MCP) ----------
// Some bridge requests only the window can answer (open a card, add a task): they go out
// with an id and come back through 'bridge:answer' (or null after a timeout).
const pending = new Map();
function askWindow(channel, payload, ms = 5000) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) return resolve(null);
    const reqId = Math.random().toString(36).slice(2);
    pending.set(reqId, resolve);
    send(channel, { reqId, ...payload });
    setTimeout(() => { if (pending.delete(reqId)) resolve(null); }, ms);
  });
}
const answer = (_e, reqId, value) => { pending.get(reqId)?.(value); pending.delete(reqId); };
ipcMain.on('bridge:answer', answer);
ipcMain.on('bridge:card-created', answer);

function startBridge() {
  bridge = createBridge({
    dataDir: app.getPath('userData'),
    ptys,
    loadConfig,
    notify: (ev) => send('bridge:event', ev),
    askRenderer: (kind, payload, ms) => askWindow('bridge:ask', { kind, payload }, ms),
    requestNewCard: ({ agent, cwd, title, light, from }) => askWindow('bridge:new-card', { agent, cwd, title, light, from }),
  });
  bridge.start();
}

// ---------- Window + menu ----------
// Shortcuts: every action has a default; Settings → Shortcuts overrides them
// (cfg.shortcuts = { action: "CmdOrCtrl+Shift+X" }, empty = no shortcut).
const SHORTCUTS = [
  { id: 'new:claude', label: 'New Claude', key: 'CmdOrCtrl+Shift+1', section: 'Agents' },
  { id: 'new:codex', label: 'New Codex', key: 'CmdOrCtrl+Shift+2', section: 'Agents' },
  { id: 'new:gemini', label: 'New Gemini', key: 'CmdOrCtrl+Shift+3', section: 'Agents' },
  { id: 'new:shell', label: 'New Terminal', key: 'CmdOrCtrl+Shift+4', section: 'Agents' },
  { id: 'new:note', label: 'New Note', key: 'CmdOrCtrl+Shift+N', section: 'Board' },
  { id: 'new:group', label: 'New Group', key: 'CmdOrCtrl+Shift+G', section: 'Board' },
  { id: 'tasks', label: 'Tasks', key: 'CmdOrCtrl+Shift+T', section: 'Panels' },
  { id: 'diagram', label: 'Diagram', key: 'CmdOrCtrl+Shift+D', section: 'Panels' },
  { id: 'flows', label: 'Automations', key: 'CmdOrCtrl+Shift+F', section: 'Panels' },
  { id: 'usage', label: 'Usage and Savings', key: 'CmdOrCtrl+Shift+U', section: 'Panels' },
  { id: 'palette', label: 'Search or Run…', key: 'CmdOrCtrl+Shift+P', section: 'Panels' },
  { id: 'sidebar', label: 'Agent List', key: 'CmdOrCtrl+Shift+A', section: 'Panels' },
  { id: 'space:next', label: 'Next Project', key: 'CmdOrCtrl+Alt+Right', section: 'Projects' },
  { id: 'space:prev', label: 'Previous Project', key: 'CmdOrCtrl+Alt+Left', section: 'Projects' },
  { id: 'space:all', label: 'All Projects', key: 'CmdOrCtrl+Alt+0', section: 'Projects' },
  { id: 'arrange', label: 'Arrange Cards', key: 'CmdOrCtrl+Shift+O', section: 'Board' },
  { id: 'fit', label: 'Fit All', key: 'CmdOrCtrl+0', section: 'Board' },
  { id: 'zoom:in', label: 'Zoom In', key: 'CmdOrCtrl+=', section: 'Board' },
  { id: 'zoom:out', label: 'Zoom Out', key: 'CmdOrCtrl+-', section: 'Board' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts…', key: 'CmdOrCtrl+/', section: 'Panels' },
  { id: 'settings', label: 'Settings…', key: 'CmdOrCtrl+,', section: 'Panels' },
];
ipcMain.handle('shortcuts:list', () => SHORTCUTS);
ipcMain.on('menu:rebuild', () => { buildMenu(); registerQuickKey(); });

function buildMenu() {
  const cmd = (action) => () => send('menu', action);
  const over = loadConfig().shortcuts || {};
  const item = (id) => {
    const sc = SHORTCUTS.find((x) => x.id === id);
    const key = id in over ? over[id] : sc.key;
    return { label: sc.label, ...(key ? { accelerator: key } : {}), click: cmd(id) };
  };
  const sep = { type: 'separator' };
  const checkUpdates = { label: 'Check for Updates…', click: () => updater?.check(true) };
  const template = [
    ...(IS_MAC ? [{
      label: app.name,
      submenu: [
        { role: 'about' }, checkUpdates, sep, { role: 'services' }, sep,
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, sep, { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Board',
      submenu: [
        item('new:claude'), item('new:codex'), item('new:gemini'), item('new:shell'), item('new:note'), item('new:group'), sep,
        item('tasks'), item('diagram'), item('flows'), item('usage'), item('palette'), sep,
        item('sidebar'),
        { label: 'Skills and Agents…', click: cmd('skills') },
        { label: 'Subscriptions and Accounts…', click: cmd('accounts') }, sep,
        item('arrange'), item('fit'), item('zoom:in'), item('zoom:out'), sep,
        item('shortcuts'), item('settings'),
        ...(IS_MAC ? [] : [sep, checkUpdates, { role: 'quit', label: 'Quit' }]),
      ],
    },
    { label: 'Projects', submenu: [item('space:next'), item('space:prev'), item('space:all')] },
    // On Windows we do NOT register the Edit menu: its Ctrl+C/Ctrl+V shortcuts
    // would steal Ctrl+C (interrupt) from the terminals. The UI handles the
    // clipboard there.
    ...(IS_MAC ? [{ role: 'editMenu' }] : []),
    // ⌘W closes the window (agents keep running in the background), ⌘M minimizes
    ...(IS_MAC ? [{ role: 'windowMenu' }] : []),
    {
      label: 'View',
      // Reload without Ctrl+R on Windows (that is the shell's history search)
      submenu: [
        IS_MAC ? { role: 'reload' } : { label: 'Reload', click: () => win && win.reload() },
        { role: 'toggleDevTools' }, sep, { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- Updates ----------
let updater = null;
ipcMain.on('update:download', (_e, url) => updater?.download(url));
ipcMain.on('update:install', () => updater?.install());

// The window theme (traffic lights, menus, dialogs) follows the app's theme.
ipcMain.on('app:theme', (_e, mode) => { nativeTheme.themeSource = ['light', 'dark'].includes(mode) ? mode : 'system'; });

// ---------- Icon, tray and background mode ----------
// Closing the window only hides it (while agents are running): they keep working
// and queued tasks keep being dispatched. To really quit: ⌘Q or the tray.
let tray = null;
let quitting = false;
let trayHintShown = false;
const ICON = path.join(__dirname, 'renderer', 'icon.png');

function showWindow() {
  if (!win) createWindow();
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
}

function busyCount() { return bridge ? bridge.busyIds().length : 0; }

function refreshTray() {
  if (!tray) return;
  const n = ptys.size, busy = busyCount();
  tray.setToolTip(`AgentBoard — ${n} agent${n === 1 ? '' : 's'} open, ${busy} working`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show AgentBoard', click: showWindow },
    { label: `${n} open · ${busy} working`, enabled: false },
    { type: 'separator' },
    { label: 'Quit (stops the agents)', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (img.isEmpty()) return;
  tray = new Tray(img);
  tray.on('click', showWindow);
  refreshTray();
  setInterval(refreshTray, 5000);
}

function confirmQuit() {
  if (!ptys.size) return true;
  const busy = busyCount();
  const r = dialog.showMessageBoxSync(win && win.isVisible() ? win : null, {
    type: 'question',
    buttons: ['Quit', 'Keep Running in Background', 'Cancel'],
    defaultId: busy ? 1 : 0, cancelId: 2,
    message: `${ptys.size} agent${ptys.size === 1 ? ' is' : 's are'} open${busy ? ` (${busy} working)` : ''}.`,
    detail: 'Quitting stops them; their sessions resume the next time you open AgentBoard. Your subscriptions stay signed in either way.',
  });
  if (r === 1 && win) win.hide();
  return r === 0;
}

function createWindow() {
  win = new BrowserWindow({
    icon: ICON,
    width: 1500,
    height: 950,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0f1115',
    title: 'AgentBoard',
    titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // keep statuses and the task queue up to date while hidden
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Links (http/https) open in the browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (quitting) return;
    if (loadConfig().keepRunning && ptys.size) {
      e.preventDefault();
      win.hide();
      if (!IS_MAC && tray && !trayHintShown) {
        trayHintShown = true;
        tray.displayBalloon?.({ title: 'AgentBoard is still running', content: 'Your agents keep working. Open or quit it from this icon.' });
      }
    } else if (!confirmQuit()) e.preventDefault();
    else quitting = true;
  });
  win.on('closed', () => { killAll(); win = null; });
}

// Single instance: opening the app again shows the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    loadShellPath();
    if (IS_MAC && !app.isPackaged) app.dock?.setIcon(ICON);
    buildMenu();
    startBridge();
    createWindow();
    createTray();
    registerQuickKey();
    updater = createUpdater({
      send, loadConfig,
      // Restarting to install stops the agents: ask first, like ⌘Q
      onBeforeInstall: () => { if (!confirmQuit()) return false; quitting = true; return true; },
    });
    updater.start();
    app.on('activate', showWindow);
  });
}

app.on('before-quit', (e) => {
  if (!quitting && !confirmQuit()) { e.preventDefault(); return; }
  quitting = true;
  killAll(); bridge?.stop();
});
app.on('window-all-closed', () => { killAll(); bridge?.stop(); app.quit(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
