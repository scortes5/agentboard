// Update checks.
// Windows (installed build): electron-updater downloads the new installer from the
// GitHub release in the background and installs it on restart; NSIS needs no signature.
// macOS: the app is not signed with an Apple Developer ID, so Squirrel.Mac refuses to
// install updates. We only ask GitHub for the latest release and offer the .dmg.
const { app, net, shell, dialog, BrowserWindow } = require('electron');

const REPO = 'scortes5/agentboard';
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const EVERY = 6 * 60 * 60 * 1000;

// Lets a maintainer test the banner from source: AGENTBOARD_FAKE_VERSION=0.1.0 npm start
function currentVersion() {
  return (!app.isPackaged && process.env.AGENTBOARD_FAKE_VERSION) || app.getVersion();
}

// a > b for plain "X.Y.Z" versions (a leading "v" is ignored).
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// The .dmg for this Mac: electron-builder names them AgentBoard-X.Y.Z-arm64.dmg and AgentBoard-X.Y.Z.dmg (x64).
function dmgFor(assets, arch) {
  const dmgs = (assets || []).filter((a) => /\.dmg$/i.test(a.name));
  const pick = arch === 'arm64' ? dmgs.find((a) => /arm64\.dmg$/i.test(a.name)) : dmgs.find((a) => !/arm64\.dmg$/i.test(a.name));
  return pick?.browser_download_url || null;
}

function createUpdater({ send, loadConfig, onBeforeInstall }) {
  const native = process.platform === 'win32' && app.isPackaged;
  let notified = null;   // version already shown by an automatic check
  let manual = false;    // the current check was asked for from the menu
  let autoUpdater = null;

  // A sheet on a hidden window would never be seen
  const parent = () => BrowserWindow.getAllWindows().find((w) => w.isVisible()) || null;
  const info = (message, detail) => dialog.showMessageBox(parent(), { type: 'info', message, detail, buttons: ['OK'] });

  function offer(update) {
    if (!manual && notified === update.version) return;
    notified = update.version;
    send('update:available', update);
  }

  function failed(err) {
    console.error('[updates]', err?.message || err);
    if (manual) dialog.showMessageBox(parent(), { type: 'warning', message: 'Could not check for updates', detail: String(err?.message || err), buttons: ['OK'] });
    manual = false;
  }

  function upToDate() {
    if (manual) info('AgentBoard is up to date', `You have the latest version (${currentVersion()}).`);
    manual = false;
  }

  if (native) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', (u) => { if (manual) info(`Downloading AgentBoard ${u.version}…`, 'It will be ready to install in a moment.'); });
    autoUpdater.on('update-not-available', upToDate);
    autoUpdater.on('update-downloaded', (u) => { offer({ version: u.version, ready: true, detail: 'It is downloaded. Restart AgentBoard to install it.' }); manual = false; });
    autoUpdater.on('error', failed);
  }

  async function checkGithub() {
    const res = await net.fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgentBoard' } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!version || !newer(version, currentVersion())) return upToDate();
    const url = (process.platform === 'darwin' ? dmgFor(rel.assets, process.arch) : null) || rel.html_url;
    const detail = process.platform === 'darwin'
      ? 'Open the .dmg and drag AgentBoard to Applications to replace this version.'
      : 'Run the installer to replace this version.';
    offer({ version, url, detail });
    manual = false;
  }

  async function check(fromMenu = false) {
    manual = fromMenu;
    try {
      if (native) await autoUpdater.checkForUpdates();
      else await checkGithub();
    } catch (err) { failed(err); }
  }

  function start() {
    const auto = () => { if (loadConfig().checkUpdates !== false) check(false); };
    setTimeout(auto, 10 * 1000); // let the window and agents start first
    setInterval(auto, EVERY);
  }

  // Only GitHub release URLs are opened, whatever the renderer sends.
  function download(url) {
    if (typeof url === 'string' && url.startsWith(`https://github.com/${REPO}/`)) shell.openExternal(url);
  }

  function install() {
    if (!autoUpdater) return;
    if (onBeforeInstall && !onBeforeInstall()) return; // the user kept their agents running
    autoUpdater.quitAndInstall();
  }

  return { start, check, download, install };
}

module.exports = { createUpdater, newer, dmgFor };
