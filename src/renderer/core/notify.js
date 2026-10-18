// AgentBoard — notices: toasts and pinging a card.
'use strict';

// ---------- Notifications ----------
function toast(html, ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// A new release: on Windows it is already downloaded (restart installs it);
// on macOS the button opens the .dmg for this Mac in the browser.
ab.onUpdate((u) => {
  $('#updateTitle').textContent = `AgentBoard ${u.version} is available`;
  $('#updateDetail').textContent = u.detail;
  const go = $('#updateGo');
  go.textContent = u.ready ? 'Restart to Update' : 'Download';
  go.title = u.ready ? 'Quit AgentBoard, install the update and open it again' : 'Open the installer for this computer in your browser';
  go.onclick = () => { $('#updateBanner').classList.add('hidden'); u.ready ? ab.updateInstall() : ab.updateDownload(u.url); };
  $('#updateBanner').classList.remove('hidden');
});
$('#updateLater').onclick = () => $('#updateBanner').classList.add('hidden');

function ping(id) {
  const el = runtime.get(id)?.el;
  if (!el) return;
  el.classList.remove('pinged');
  void el.offsetWidth; // restart the animation
  el.classList.add('pinged');
}
