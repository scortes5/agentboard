// AgentBoard — cards: creating, mounting and closing them, and the command each one runs.
'use strict';

// ---------- Cards ----------
// opts: { cwd, title, args, env, startCmd, text, x, y, w, h }
function newCard(type, agentKey, opts = {}) {
  if (type === 'term' && !('cwd' in opts) && !cfg.selectedProject) {
    const any = cfg.projects[0];
    if (!any) { addProject().then((ok) => ok && newCard(type, agentKey, opts)); return; }
    cfg.selectedProject = any.path;
  }
  const v = visibleRect();
  const r = { width: v.left * 2 + v.width, height: v.top * 2 + v.height }; // center of the visible area
  const vp = cfg.viewport;
  const offset = (cfg.cards.length % 8) * 30;
  const w = opts.w || (type === 'note' ? 360 : type === 'group' ? DEFAULT_W * 2 + 76 : DEFAULT_W);
  const h = opts.h || (type === 'note' ? 280 : type === 'group' ? DEFAULT_H + 76 : DEFAULT_H);
  const c = {
    id: uid(), type, agent: agentKey || 'shell',
    cwd: type === 'term' ? ('cwd' in opts ? opts.cwd : cfg.selectedProject) : null,
    title: opts.title || (type === 'note' ? 'Note' : type === 'group' ? 'Group' : (cfg.agents[agentKey] || cfg.agents.shell).label),
    args: opts.args || '',
    env: opts.env || null,
    startCmd: opts.startCmd || '',
    x: opts.x ?? (r.width / 2 - vp.x) / vp.zoom - w / 2 + offset,
    y: opts.y ?? (r.height / 2 - vp.y) / vp.zoom - h / 2 + offset,
    w, h, text: opts.text || '',
  };
  if (type !== 'term') c.space = opts.space ?? currentSpace();
  if (type === 'group') c.color = opts.color || GROUP_COLORS[cfg.cards.filter((x) => x.type === 'group').length % GROUP_COLORS.length];
  if (type === 'term' && isClaude(cfg.agents[c.agent])) c.sessionId = newSessionId();
  if (opts.prompt) c.prompt = opts.prompt;
  if (opts.parent) c.parent = opts.parent;
  if (opts.taskId) c.taskId = opts.taskId;
  cfg.cards.push(c);
  mountCard(c, { resume: false });
  if (!inSpace(c)) runtime.get(c.id).el.style.display = 'none';
  if (!opts.noFocus) focusCard(c.id);
  save();
  updateEmpty();
  renderSidebar();
  return c;
}

function duplicateCard(c) {
  newCard(c.type, c.agent, {
    cwd: c.cwd, args: c.args, env: c.env, text: c.text, title: `${c.title} (copy)`,
    x: c.x + c.w + 28, y: c.y, w: c.w, h: c.h,
  });
}

function mountCard(c, { resume }) {
  if (c.type === 'group') return mountGroup(c);
  // Without "resume on open": each Claude card starts a new session
  if (resume && !cfg.resumeOnOpen && c.sessionId) { c.sessionId = newSessionId(); c.sessionUsed = false; }
  const agent = agentOf(c);
  const el = document.createElement('div');
  el.className = 'card' + (c.type === 'note' ? ' note-card' : '');
  el.style.setProperty('--agent', c.type === 'note' ? '' : agent.color);
  el.style.zIndex = ++zTop;
  el.innerHTML = `
    <div class="card-head">
      <span class="status"></span>
      <span class="title">${esc(c.title)}</span>
      ${c.type === 'term' ? `<span class="proj" title="${esc(c.cwd || 'Home folder')}">${esc(basename(c.cwd) || '~')}</span>` : ''}
      <span class="spacer"></span>
      ${c.type === 'term' ? `<span class="alertpill hidden" title="">${icon('alert', 12)}</span><span class="tokpill hidden"></span><span class="gitpill hidden"></span>
        <button class="card-btn" data-act="open" title="Open the project folder in Finder">${icon('folder', 14)}</button>
        <button class="card-btn" data-act="restart" title="Restart the agent (resumes its session)">${icon('refresh', 14)}</button>
        <button class="card-btn lockbtn" data-act="lock">${icon('lock', 14)}</button>` : ''}
      <button class="card-btn" data-act="edit" title="${c.type === 'term' ? 'Change name, agent, project or arguments; send context to another agent' : 'Edit or duplicate the note'}">${icon('more', 14)}</button>
      <button class="card-btn" data-act="zoom" title="Focus this card (fills the view)">${icon('focus', 14)}</button>
      <button class="card-btn" data-act="close" title="Close the card and stop its process">${icon('close', 14)}</button>
    </div>
    <div class="card-body"></div>
    <div class="resize"></div>`;
  world.appendChild(el);

  const rt = { el, statusEl: $('.status', el), gitEl: $('.gitpill', el), tokEl: $('.tokpill', el), alertEl: $('.alertpill', el), lastData: 0, busySince: 0, alive: false, alert: null };
  runtime.set(c.id, rt);
  const body = $('.card-body', el);

  if (c.type === 'note') {
    const ta = document.createElement('textarea');
    ta.className = 'note';
    ta.placeholder = 'Notes, prompts, to-dos…';
    ta.value = c.text || '';
    ta.addEventListener('input', () => { c.text = ta.value; save(); });
    body.appendChild(ta);
    rt.noteEl = ta;
    rt.statusEl.classList.add('hidden');
  } else {
    const term = new Terminal({ ...termOptions(c), allowProposedApi: true, macOptionIsMeta: true });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => window.open(url)));
    term.open(body);
    term.attachCustomKeyEventHandler((e) => clipboardKeys(e, term));
    term.onData((d) => { rt.lastActivity = Date.now(); ab.ptyWrite(c.id, d); });
    term.textarea && term.textarea.addEventListener('focus', () => focusCard(c.id, false));
    rt.term = term; rt.fit = fit;
    layoutCard(c);
    requestAnimationFrame(() => startPty(c, resume));
  }

  layoutCard(c);
  refreshLock(c);
  wireCard(c, el);
}

// ---------- Locked cards ----------
// A locked terminal is never closed or stopped on its own: not when its task is done, not when
// it sits idle, not by "close finished". Closing it by hand still works.
function refreshLock(c) {
  const btn = runtime.get(c.id)?.el.querySelector('.lockbtn');
  if (!btn) return;
  btn.classList.toggle('on', !!c.locked);
  btn.title = c.locked ? 'Locked: never closed automatically. Click to unlock' : 'Lock: keep this terminal open when its task finishes or it goes idle';
}

function setCardLocked(c, on) {
  c.locked = !!on;
  refreshLock(c);
  save();
  if (typeof renderTasks === 'function') renderTasks();
}

// ---------- Each card's command ----------
// Every Claude card has its own session id: when the app reopens or the card restarts
// it returns to ITS conversation (--resume <id>), even with several Claudes in the
// same project. Other agents use their "resume args" (e.g. codex resume --last).
const isClaude = (a) => !!a && /(^|[\\/])claude(\.cmd|\.exe)?$/i.test((a.command || '').trim().split(/\s+/)[0] || '');
function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const usesPowerShell = () => platform === 'win32' && (!cfg.shell || /pwsh|powershell/i.test(cfg.shell));
const usesCmd = () => platform === 'win32' && /(^|\\)cmd(\.exe)?(\s|$)/i.test(cfg.shell || '');
// PowerShell also ends a single-quoted string at the typographic quotes U+2018–U+201B, so each
// is doubled too: task text can come from GitHub issues, the phone page or other agents.
function shellQuote(s) {
  if (usesPowerShell()) return "'" + s.replace(/['‘-‛]/g, '$&$&') + "'";
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
// Control characters in a task (Ctrl-C, ESC, end of bracketed paste…) could cancel or escape the
// typed line, so they are dropped; tabs and line breaks stay.
const cleanPrompt = (s) => s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
function orElse(a, b) { return usesPowerShell() ? `${a}; if (-not $?) { ${b} }` : `${a} || ${b}`; }
// How an agent receives its first task: as an argument (independent of when the
// TUI finishes starting) or pasted into the terminal (unknown CLIs, cmd.exe).
function promptMode(a) {
  if (usesCmd()) return 'paste';
  return a.taskPrompt || ({ claude: 'arg', codex: 'arg', gemini: '-i' })[(a.command || '').trim().split(/\s+/)[0]] || 'paste';
}

function commandFor(c, resume) {
  if (c.startCmd) return resume ? '' : c.startCmd; // e.g. a login card: not repeated on reopen
  const a = agentOf(c);
  if (!a.command) return '';
  const session = c.sessionId && isClaude(a);
  const parts = [a.command, c.args];
  if (session) parts.push(c.sessionUsed ? `--resume ${c.sessionId}` : `--session-id ${c.sessionId}`);
  else if (resume && cfg.resumeOnOpen) parts.push(a.resumeArgs);
  const mode = promptMode(a);
  if (c.prompt && !c.promptSent && mode !== 'paste') {
    parts.push((mode === 'arg' ? '' : mode + ' ') + shellQuote(cleanPrompt(c.prompt).replace(/\s*\n\s*/g, ' ').trim()));
  }
  const cmd = parts.filter(Boolean).join(' ');
  // if the saved session no longer exists (nothing was ever typed), open a new one with the same id
  if (session && c.sessionUsed) return orElse(cmd, [a.command, c.args, `--session-id ${c.sessionId}`].filter(Boolean).join(' '));
  return cmd;
}

async function startPty(c, resume) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  try { rt.fit.fit(); } catch {}
  $('.overlay', rt.el)?.remove();
  const command = commandFor(c, resume);
  const env = { ...(agentOf(c).env || {}), ...(c.env || {}) }; // e.g. CLAUDE_CONFIG_DIR of an extra account
  const res = await ab.ptyCreate({ id: c.id, cwd: c.cwd, command, env: Object.keys(env).length ? env : undefined, cols: rt.term.cols, rows: rt.term.rows });
  if (!res.ok) { showOverlay(c, res.error); return; }
  rt.alive = true;
  rt.idleClosed = false;
  rt.lastData = rt.lastActivity = Date.now();
  if (focusedId === c.id) rt.term.focus();
  let dirty = false;
  if (c.sessionId && !c.sessionUsed && isClaude(agentOf(c))) { c.sessionUsed = true; dirty = true; }
  if (c.prompt && !c.promptSent) {
    c.promptSent = true; dirty = true;
    if (promptMode(agentOf(c)) === 'paste') {
      await waitReady(c.id);
      await ab.ptyPaste(c.id, cleanPrompt(c.prompt));
    }
  }
  if (dirty) save();
}

// Wait for the CLI to finish starting: some output, then ~1.5 s of silence.
async function waitReady(id, maxMs = 20000) {
  await waitAlive(id);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 2500));
  while (Date.now() - t0 < maxMs) {
    const rt = runtime.get(id);
    if (!rt) return;
    if (Date.now() - rt.lastData > 1500) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function restartCard(c) {
  const rt = runtime.get(c.id);
  if (!rt || !rt.term) return;
  ab.ptyKill(c.id);
  rt.alive = false;
  rt.term.reset();
  startPty(c, false);
}

function showOverlay(c, msg) {
  const rt = runtime.get(c.id);
  if (!rt) return;
  $('.overlay', rt.el)?.remove();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div>${esc(msg)}</div><button class="primary" title="Open the agent again in this card">Restart</button>`;
  $('button', ov).onclick = () => restartCard(c);
  $('.card-body', rt.el).appendChild(ov);
}

function closeCard(c) { return closeCards([c]); }

// Close one or more cards with a single confirmation for the processes still running.
function closeCards(list, { ask = true } = {}) {
  list = list.filter(Boolean);
  if (!list.length) return false;
  const running = list.filter((c) => runtime.get(c.id)?.alive);
  if (ask && running.length) {
    const msg = list.length === 1
      ? `Close "${list[0].title}"? Its process will be stopped.`
      : `Close ${list.length} cards? ${running.length === 1 ? '1 running process' : `${running.length} running processes`} will be stopped.`;
    if (!confirm(msg)) return false;
  }
  const ids = new Set(list.map((c) => c.id));
  for (const c of list) {
    const rt = runtime.get(c.id);
    if (c.type !== 'group') ab.ptyKill(c.id);
    rt?.term?.dispose();
    rt?.el.remove();
    runtime.delete(c.id);
    selected.delete(c.id);
    if (focusedId === c.id) focusedId = null;
  }
  cfg.cards = cfg.cards.filter((x) => !ids.has(x.id));
  save(); updateEmpty(); renderSidebar(); updateSelBar();
  return true;
}
