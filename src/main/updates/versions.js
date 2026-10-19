// Version helpers shared by the update strategies.
'use strict';

// a > b for plain "X.Y.Z" versions (a leading "v" is ignored).
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

// The installer for this computer among a release's files: the .dmg for this Mac
// (AgentBoard-X.Y.Z-arm64.dmg or AgentBoard-X.Y.Z.dmg), or the .AppImage on Linux.
function installerFor(assets = [], platform = process.platform, arch = process.arch) {
  const named = (re) => assets.filter((a) => re.test(a.name));
  let pick = null;
  if (platform === 'darwin') {
    const dmgs = named(/\.dmg$/i);
    pick = arch === 'arm64' ? dmgs.find((a) => /arm64\.dmg$/i.test(a.name)) : dmgs.find((a) => !/arm64\.dmg$/i.test(a.name));
  } else if (platform === 'linux') {
    pick = named(/\.AppImage$/i)[0];
  }
  return pick?.browser_download_url || null;
}

module.exports = { newer, installerFor };
