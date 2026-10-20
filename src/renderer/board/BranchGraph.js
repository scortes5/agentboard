// AgentBoard — the branch graph: the history of every local branch as colored lanes, one color
// per branch, with the point where each one was merged. Click a branch to jump to it and
// highlight its line, click a commit (or move with the arrow keys) to see its files, and follow
// its parents. Opened from the Branches view.
'use strict';
/* global ab, esc, cfg, fmt, icon, toast, basename */

const GRAPH_ROW = 28;   // px per commit
const GRAPH_LANE = 14;  // px between lanes
const GRAPH_COLORS = 8; // --lane-0 … --lane-7 in the stylesheet; 0 is the main branch

class BranchGraph {
  constructor() {
    this.limit = 400;
  }

  // The branch each commit belongs to: the main branch's first-parent line first, then every
  // other branch's, then the side of each merge, named from its message when the branch is gone.
  static owners(commits, base) {
    const bySha = new Map(commits.map((c) => [c.sha, c]));
    const owner = new Map();
    const claim = (sha, name) => {
      while (sha && bySha.has(sha) && !owner.has(sha)) { owner.set(sha, name); sha = bySha.get(sha).parents[0]; }
    };
    // the main branch first, then integration branches, then older branches before newer ones,
    // so a new branch only claims its own commits and not the history it started from
    const LONG_LIVED = ['develop', 'dev', 'next', 'staging'];
    const rank = (b) => (b === base ? -2 : LONG_LIVED.includes(b) ? -1 : 0);
    const tips = commits.flatMap((c) => c.branches.map((b) => ({ b, c })))
      .sort((x, y) => rank(x.b) - rank(y.b) || x.c.at - y.c.at);
    for (const { b, c } of tips) claim(c.sha, b);
    for (const c of commits) {
      for (const p of c.parents.slice(1)) claim(p, BranchGraph.mergedName(c.subject) || `merged into ${owner.get(c.sha) || 'a branch'}`);
    }
    return owner;
  }

  // "Merge pull request #41 from owner/feature/x" or "Merge branch 'feature/x' into main".
  static mergedName(subject) {
    const pr = /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject);
    if (pr) return pr[1];
    const br = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject);
    return br ? br[1].replace(/^origin\//, '') : null;
  }

  static colorIndex(name, base) {
    if (!name) return 1;
    if (name === base) return 0;
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 1 + (h % (GRAPH_COLORS - 1));
  }

  // Lanes, newest commit first: each row knows the lanes above and below it, the lane of its
  // commit, the lanes that end in it (where a branch started) and the lines to its parents.
  static layout(commits) {
    const lanes = [];
    const rows = [];
    for (const c of commits) {
      const before = lanes.slice();
      let col = lanes.indexOf(c.sha);
      if (col < 0) { col = lanes.indexOf(null); if (col < 0) col = lanes.length; }
      for (let i = 0; i < lanes.length; i++) if (lanes[i] === c.sha) lanes[i] = null; // lines that meet here
      lanes[col] = c.parents[0] || null;
      const outs = c.parents[0] ? [{ to: col, sha: c.parents[0] }] : [];
      for (const p of c.parents.slice(1)) {
        let j = lanes.indexOf(p);
        if (j < 0) { j = lanes.indexOf(null); if (j < 0) j = lanes.length; lanes[j] = p; }
        outs.push({ to: j, sha: p, merge: true });
      }
      while (lanes.length && lanes[lanes.length - 1] == null) lanes.pop();
      rows.push({ c, col, before, after: lanes.slice(), outs });
    }
    return rows;
  }

  static svg(rows, colorOf, width) {
    const x = (i) => 10 + i * GRAPH_LANE;
    const line = (x1, y1, x2, y2, k) => {
      const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
      return `<path d="${d}" class="bg-line" style="stroke:var(--lane-${k})"/>`;
    };
    const parts = [];
    const dots = [];
    rows.forEach((r, n) => {
      const top = n * GRAPH_ROW, mid = top + GRAPH_ROW / 2, bottom = top + GRAPH_ROW;
      r.before.forEach((sha, i) => {
        if (!sha) return;
        if (sha === r.c.sha) parts.push(line(x(i), top, x(r.col), mid, colorOf(sha)));
        else parts.push(line(x(i), top, x(i), bottom, colorOf(sha)));
      });
      for (const o of r.outs) parts.push(line(x(r.col), mid, x(o.to), bottom, colorOf(o.merge ? o.sha : r.c.sha)));
      const k = colorOf(r.c.sha);
      dots.push(r.c.parents.length > 1
        ? `<circle cx="${x(r.col)}" cy="${mid}" r="4.5" class="bg-merge" style="stroke:var(--lane-${k})"/>`
        : `<circle cx="${x(r.col)}" cy="${mid}" r="4" class="bg-dot" style="fill:var(--lane-${k})"/>`);
    });
    return `<svg class="bg-svg" width="${width}" height="${rows.length * GRAPH_ROW}">${parts.join('')}${dots.join('')}</svg>`;
  }

  async open(cwd) {
    document.querySelector('dialog.branch-graph')?.remove();
    const dlg = document.createElement('dialog');
    dlg.className = 'branch-graph';
    dlg.innerHTML = '<div class="hint">Reading the history…</div>';
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    this.cwd = cwd;
    await this.load(dlg);
  }

  async load(dlg) {
    const r = await ab.gitGraph(this.cwd, this.limit);
    if (!dlg.isConnected) return;
    if (!r.ok) { dlg.innerHTML = `<div class="hint">${esc(r.error)}</div><div class="bg-foot"><button type="button" data-close title="Close the graph">Close</button></div>`; dlg.querySelector('[data-close]').onclick = () => dlg.close(); return; }
    const { top, base, current, commits, more, repoUrl } = r.value;
    const owner = BranchGraph.owners(commits, base);
    const colorOf = (sha) => BranchGraph.colorIndex(owner.get(sha), base);
    const rows = BranchGraph.layout(commits);
    const lanes = Math.max(1, ...rows.map((x) => Math.max(x.before.length, x.after.length, x.col + 1)));
    const width = 20 + lanes * GRAPH_LANE;
    const proj = cfg.projects.find((p) => p.path === this.cwd || p.path === top)?.name || basename(top);
    const tips = commits.flatMap((c) => c.branches.map((b) => ({ b, sha: c.sha, at: c.at })))
      .sort((a, b) => (a.b === base ? -1 : b.b === base ? 1 : b.at - a.at));
    const merges = commits.filter((c) => c.parents.length > 1).length;
    const chip = (b) => `<span class="bg-ref" style="--k:var(--lane-${BranchGraph.colorIndex(b, base)})" title="Branch ${esc(b)}">${b === current ? `${icon('dot', 8)} ` : ''}${esc(b)}</span>`;
    dlg.innerHTML = `<div class="bg-head"><b>Branch graph</b><span class="muted">${esc(proj)}</span>
        <span class="muted small">${commits.length} commits · ${merges} merges · main branch <span class="mono">${esc(base)}</span></span><span class="spacer"></span>
        ${more ? '<button type="button" data-more title="Load older commits">Show More</button>' : ''}
        <button type="button" class="card-btn" data-close title="Close the graph (Esc)">${icon('close', 14)}</button></div>
      <div class="bg-body">
        <aside class="bg-legend"><div class="bg-section">Branches <span>${tips.length}</span></div>
          ${tips.map((t) => `<button type="button" class="bg-branch" data-head="${esc(t.sha)}" data-name="${esc(t.b)}" title="Jump to ${esc(t.b)} and highlight its line">
            <i style="background:var(--lane-${BranchGraph.colorIndex(t.b, base)})"></i><span>${esc(t.b)}</span>${t.b === current ? '<em>current</em>' : ''}</button>`).join('')}
          <p class="muted small">Each branch keeps its color along its history; a hollow dot is a merge, where a colored line joins another branch.</p></aside>
        <div class="bg-scroll" tabindex="0">
          <div class="bg-rows" style="--graph-w:${width}px">
            ${BranchGraph.svg(rows, colorOf, width)}
            ${rows.map((x, n) => {
              const c = x.c;
              const merged = c.parents.length > 1 ? owner.get(c.parents[1]) : '';
              return `<div class="bg-row" data-i="${n}" data-sha="${esc(c.sha)}" data-owner="${esc(owner.get(c.sha) || '')}">
                <span class="bg-msg">${c.branches.map(chip).join('')}${c.tags.map((t) => `<span class="bg-tag" title="Tag ${esc(t)}">${esc(t)}</span>`).join('')}
                  ${merged ? `<span class="bg-mergelabel" style="--k:var(--lane-${colorOf(c.parents[1])})" title="This commit merges ${esc(merged)} into ${esc(owner.get(c.sha) || 'this branch')}">merge ${esc(merged)}</span>` : ''}
                  <span class="bg-subject">${esc(c.subject)}</span></span>
                <span class="bg-author">${esc(c.author)}</span><span class="bg-date" title="${esc(new Date(c.at).toLocaleString())}">${esc(fmt.ago(c.at))}</span><span class="bg-sha mono">${esc(c.sha.slice(0, 7))}</span></div>`;
            }).join('')}
          </div>
        </div>
        <aside class="bg-detail"><div class="hint">Select a commit to see its message, its files and its parents. Use ↑ ↓ to move and ← to go to the parent.</div></aside>
      </div>`;
    const scroll = dlg.querySelector('.bg-scroll');
    const detail = dlg.querySelector('.bg-detail');
    const rowEls = [...dlg.querySelectorAll('.bg-row')];
    const index = new Map(rowEls.map((el, i) => [el.dataset.sha, i]));
    let sel = -1;
    let focusName = '';

    const select = async (i, { center = false } = {}) => {
      if (!Number.isInteger(i) || i < 0 || i >= rowEls.length) return;
      rowEls[sel]?.classList.remove('sel');
      sel = i;
      const el = rowEls[i];
      el.classList.add('sel');
      if (center) scroll.scrollTop = Math.max(0, el.offsetTop - scroll.clientHeight / 2);
      else el.scrollIntoView({ block: 'nearest' });
      const c = commits[i];
      const kids = commits.filter((x) => x.parents.includes(c.sha));
      const jump = (sha, label) => (index.has(sha)
        ? `<button type="button" class="bg-jump" data-jump="${esc(sha)}" title="Go to ${esc(sha.slice(0, 7))}">${esc(label)} <span class="mono">${esc(sha.slice(0, 7))}</span></button>`
        : `<span class="muted small" title="Older than what is loaded: use Show More">${esc(label)} <span class="mono">${esc(sha.slice(0, 7))}</span></span>`);
      detail.innerHTML = `<div class="bg-d-head"><span class="bg-ref" style="--k:var(--lane-${colorOf(c.sha)})">${esc(owner.get(c.sha) || 'unknown branch')}</span></div>
        <div class="bg-d-subject">${esc(c.subject)}</div>
        <div class="muted small">${esc(c.author)} · ${esc(new Date(c.at).toLocaleString())}</div>
        <div class="bg-d-sha"><span class="mono">${esc(c.sha)}</span><button type="button" class="card-btn" data-copy="${esc(c.sha)}" title="Copy the commit hash">${icon('copy', 12)}</button>
          ${/^https:\/\/github\.com\//.test(repoUrl || '') ? `<a class="card-btn" href="${esc(repoUrl)}/commit/${esc(c.sha)}" target="_blank" title="Open this commit on GitHub">${icon('external', 12)}</a>` : ''}</div>
        <div class="bg-d-links">${c.parents.map((p, k) => jump(p, c.parents.length > 1 ? (k ? `merged ${owner.get(p) || 'parent'}` : 'parent') : 'parent')).join('')}
          ${kids.map((k) => jump(k.sha, k.parents.length > 1 && k.parents[0] !== c.sha ? `merged in ${owner.get(k.sha) || ''}` : 'child')).join('')}</div>
        <div class="bg-d-files"><div class="hint">Loading files…</div></div>`;
      const d = await ab.gitCommit(this.cwd, c.sha);
      if (sel !== i || !detail.isConnected) return;
      const box = detail.querySelector('.bg-d-files');
      if (!d.ok) { box.innerHTML = `<div class="hint">${esc(d.error)}</div>`; return; }
      const body = d.value.message.split('\n').slice(1).join('\n').trim();
      box.innerHTML = `${body ? `<pre class="bg-d-body">${esc(body)}</pre>` : ''}
        <div class="bg-section">${d.value.files.length} file${d.value.files.length === 1 ? '' : 's'} changed${c.parents.length > 1 ? ' (compared with its first parent)' : ''}</div>
        ${d.value.files.map((f) => `<div class="bg-file" title="${esc(f.file)}"><span class="bg-file-name">${esc(f.file)}</span>${f.add == null ? '<span class="muted small">binary</span>' : `<span class="ok">+${f.add}</span><span class="bad">−${f.del}</span>`}</div>`).join('')}`;
    };

    const highlight = (name) => {
      focusName = focusName === name ? '' : name;
      dlg.classList.toggle('focus', !!focusName);
      rowEls.forEach((el) => el.classList.toggle('on', !!focusName && el.dataset.owner === focusName));
      dlg.querySelectorAll('.bg-branch').forEach((b) => b.classList.toggle('active', b.dataset.name === focusName));
    };

    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) return dlg.close();
      if (e.target.closest('[data-more]')) { this.limit = Math.min(3000, this.limit * 2.5); dlg.innerHTML = '<div class="hint">Reading more history…</div>'; this.load(dlg); return; }
      const tip = e.target.closest('[data-head]');
      if (tip) { highlight(tip.dataset.name); select(index.get(tip.dataset.head), { center: true }); return; }
      const j = e.target.closest('[data-jump]');
      if (j) { select(index.get(j.dataset.jump), { center: true }); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { ab.copy(cp.dataset.copy); toast('Commit hash copied'); return; }
      const row = e.target.closest('.bg-row');
      if (row) select(+row.dataset.i);
    });
    dlg.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); select(sel + 1); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); select(Math.max(0, sel - 1)); }
      if ((e.key === 'ArrowLeft' || e.key === 'p') && sel >= 0) {
        e.preventDefault();
        const p = commits[sel].parents[0];
        if (index.has(p)) select(index.get(p), { center: true });
      }
    });
    const start = commits.findIndex((c) => c.head);
    select(start >= 0 ? start : 0, { center: true });
    scroll.focus();
  }
}

const branchGraph = new BranchGraph();
