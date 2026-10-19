// Updates by download: ask GitHub for the latest release and offer this computer's installer.
// Used where the app cannot replace itself (unsigned macOS builds, Linux AppImages).
'use strict';
const { net } = require('electron');
const { newer, installerFor } = require('./versions');

const DETAIL = {
  darwin: 'Open the .dmg and drag AgentBoard to Applications to replace this version.',
  linux: 'Download the new AppImage, make it executable and open it instead of this one.',
};

class GitHubReleaseStrategy {
  constructor({ repo, currentVersion }) {
    Object.assign(this, { repo, currentVersion });
  }

  // Resolves with { latest } when up to date, or { update: { version, url, detail } }.
  async check() {
    // no-store: Chromium's HTTP cache could answer with an older "latest" release
    const res = await net.fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
      cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AgentBoard' },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const rel = await res.json();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!version || !newer(version, this.currentVersion())) return { latest: version };
    return { update: { version, url: installerFor(rel.assets) || rel.html_url, detail: DETAIL[process.platform] || 'Run the installer to replace this version.' } };
  }
}

module.exports = { GitHubReleaseStrategy };
