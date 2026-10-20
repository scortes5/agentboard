// AgentBoard — each card's git pill: branch and changes, and switching branches.
'use strict';

// ---------- Git ----------
const gitCache = {}; // cwd -> last status (the diagram uses it too)
async function refreshGit() {
  if (!cfg) return;
  const cwds = [...new Set(cfg.cards.filter((c) => c.type === 'term').map((c) => c.cwd))];
  const results = {};
  await Promise.all(cwds.map(async (cwd) => { results[cwd] = await ab.gitStatus(cwd); }));
  Object.assign(gitCache, results);
  for (const c of cfg.cards) {
    const rt = runtime.get(c.id);
    if (!rt || !rt.gitEl) continue;
    const g = results[c.cwd];
    if (!g) { rt.gitEl.classList.add('hidden'); continue; }
    rt.gitEl.classList.remove('hidden');
    rt.gitEl.innerHTML = `${icon('branch', 12)} ${esc(g.branch)}`
      + (g.changes ? ` <span class="dirty">${g.changes} change${g.changes === 1 ? '' : 's'}</span>` : '')
      + (g.ahead ? ` <span class="ab">↑${g.ahead}</span>` : '')
      + (g.behind ? ` <span class="ab">↓${g.behind}</span>` : '');
    rt.gitEl.title = `${g.changes} uncommitted changes · ${g.ahead} ahead · ${g.behind} behind — click to switch branch`;
  }
}
setInterval(refreshGit, 4000);

async function branchMenu(c, anchor) {
  closePopover();
  const [branches, status] = await Promise.all([ab.gitBranches(c.cwd), ab.gitStatus(c.cwd)]);
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.innerHTML = branches.map((b) =>
    `<button data-b="${esc(b)}" class="${b === status?.branch ? 'current' : ''}">${esc(b)}${b === status?.branch ? ' (current)' : ''}</button>`).join('')
    + '<hr/><button data-overview title="See every branch of this project, with the tasks and cards working on each">All branches…</button>'
    + '<input id="newBranch" placeholder="New branch… (Enter)" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:5px;padding:5px 8px;color:var(--text);font:12px var(--font-mono)"/>';
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(r.left, innerWidth - 230) + 'px';
  pop.style.top = r.bottom + 4 + 'px';
  document.body.appendChild(pop);

  pop.addEventListener('click', async (e) => {
    if (e.target.closest('[data-overview]')) { branchOverview.open(c.cwd, anchor); return; }
    const b = e.target.closest('[data-b]')?.dataset.b;
    if (!b) return;
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, b, false))) alert(`Could not switch to "${b}". Are there uncommitted changes?`);
    refreshGit();
  });
  const input = $('#newBranch', pop);
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') closePopover();
    if (e.key !== 'Enter' || !input.value.trim()) return;
    const name = input.value.trim();
    closePopover();
    if (!(await ab.gitCheckout(c.cwd, name, true))) alert(`Could not create the branch "${name}".`);
    refreshGit();
  });
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  // only this menu: "All branches…" may have opened another popover in its place
  function outside(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', outside, true); } }
}
function closePopover() { document.querySelectorAll('.popover').forEach((p) => p.remove()); }
