// AgentBoard — Subscriptions: the CLIs, extra Claude accounts and local models.
'use strict';

// ---------- Agents and models ----------
let catalog = [];

// Add (or show again) a catalog agent in the bottom bar.
function ensureAgent(item, show = true) {
  const cur = cfg.agents[item.key];
  if (!cur) {
    cfg.agents[item.key] = { label: item.label.replace(/ CLI$/, ''), command: item.command, resumeArgs: item.resumeArgs, color: item.color };
  }
  if (show) delete cfg.agents[item.key].hidden;
  return item.key;
}

function setPinned(item, pinned) {
  if (pinned) ensureAgent(item);
  else if (cfg.agents[item.key]) cfg.agents[item.key].hidden = true;
  save(); renderAgentButtons();
}

async function openAccounts() {
  $('#accounts').showModal();
  await renderAccounts();
}

async function renderAccounts() {
  $('#catalogRows').innerHTML = '<span class="muted small">Checking what you have installed…</span>';
  $('#localRows').innerHTML = '<span class="muted small">Looking for local models…</span>';
  const [cat, local, avail] = await Promise.all([ab.catalogStatus(), ab.localModels(), ab.checkAgents()]);
  catalog = cat;
  agentAvailable = avail;
  renderAgentButtons();
  renderCatalog();
  renderLocal(local);
  renderClaudeAccounts();
}

// ---------- Multiple Claude accounts ----------
// Each extra account is an agent with its own CLAUDE_CONFIG_DIR: separate login,
// history and skills. The task queue treats them as different subscriptions.
const ACCOUNT_COLORS = ['#f0a070', '#d97757', '#f4c77d', '#e8875f', '#c96442'];
async function renderClaudeAccounts() {
  const box = $('#claudeAccounts');
  const extra = Object.entries(cfg.agents).filter(([, a]) => isClaude(a) && a.env?.CLAUDE_CONFIG_DIR);
  const status = await ab.claudeAccountStatus(extra.map(([, a]) => a.env.CLAUDE_CONFIG_DIR));
  const main = catalog.find((i) => i.key === 'claude');
  box.innerHTML = [
    `<div class="hub-row"><span class="dot" style="background:${esc(cfg.agents.claude?.color || '#e8875f')};color:${esc(cfg.agents.claude?.color || '#e8875f')}"></span>
      <span class="meta"><strong>${esc(cfg.agents.claude?.label || 'Claude')}</strong><small>Main account · <code>~/.claude</code></small></span>
      <span class="badge ${main?.loggedIn ? 'ok' : 'no'}">${main?.loggedIn ? 'Signed in' : 'Signed out'}</span><span></span></div>`,
    ...extra.map(([k, a]) => `<div class="hub-row" data-k="${esc(k)}"><span class="dot" style="background:${esc(a.color)};color:${esc(a.color)}"></span>
      <span class="meta"><strong>${esc(a.label)}</strong><small><code>${esc(a.env.CLAUDE_CONFIG_DIR)}</code></small></span>
      <span class="badge ${status[a.env.CLAUDE_CONFIG_DIR] ? 'ok' : 'no'}">${status[a.env.CLAUDE_CONFIG_DIR] ? 'In use' : 'Sign-in needed'}</span>
      <span class="acts"><button type="button" data-x="login" title="Open this account in a card; the first time, sign in with /login">Open or Sign In</button><button type="button" class="icon" data-x="remove" title="Remove from AgentBoard (keeps the folder and the session)">${icon('close', 13)}</button></span></div>`),
  ].join('');
}

$('#claudeAccounts').addEventListener('click', (e) => {
  const row = e.target.closest('[data-k]');
  const x = e.target.closest('[data-x]')?.dataset.x;
  if (!row || !x) return;
  const k = row.dataset.k;
  if (x === 'login') { $('#accounts').close(); newCard('term', k, { title: `${cfg.agents[k].label}` }); }
  if (x === 'remove' && confirm(`Remove "${cfg.agents[k].label}" from AgentBoard? Its folder and session stay on disk.`)) {
    delete cfg.agents[k];
    cfg.autoAgents = (cfg.autoAgents || []).filter((a) => a !== k);
    save(); renderAgentButtons(); renderClaudeAccounts();
  }
});

$('#addClaudeAccount').onclick = async () => {
  const input = $('#claudeAccountName');
  const name = input.value.trim();
  if (!name) return input.focus();
  const r = await ab.claudeAccountDir(name);
  if (!r.ok) return toast(esc(r.error));
  const key = `claude-${r.value.slug}`;
  if (cfg.agents[key]) return toast('An account with that name already exists.');
  const base = cfg.agents.claude || {};
  const n = Object.values(cfg.agents).filter((a) => a.env?.CLAUDE_CONFIG_DIR).length;
  cfg.agents[key] = {
    label: `Claude · ${name}`, command: 'claude', resumeArgs: '--continue',
    lightArgs: base.lightArgs || '--model haiku', normalArgs: base.normalArgs || '--model sonnet', heavyArgs: base.heavyArgs || '--model opus',
    color: ACCOUNT_COLORS[n % ACCOUNT_COLORS.length], env: { CLAUDE_CONFIG_DIR: r.value.dir },
  };
  cfg.autoAgents = [...new Set([...(cfg.autoAgents || ['claude']), key])];
  input.value = '';
  await saveNow();
  renderAgentButtons(); renderClaudeAccounts();
  $('#accounts').close();
  newCard('term', key, { title: `${cfg.agents[key].label} · sign in` });
  toast(`Sign in with your other account in this card (<code>/login</code>). From then on, "auto" spreads tasks across your accounts.`, 7000);
};

function renderCatalog() {
  const box = $('#catalogRows');
  box.innerHTML = '';
  for (const item of catalog) {
    if (item.key === 'ollama') continue; // listed under "Local Models"
    const row = document.createElement('div');
    row.className = 'hub-row';
    const pinned = !!cfg.agents[item.key] && !cfg.agents[item.key].hidden;
    const [cls, badge] = !item.installed ? ['no', 'Not installed']
      : item.loggedIn === true ? ['ok', 'Signed in']
      : item.loggedIn === false ? ['no', 'Signed out'] : ['', 'Installed'];
    const detail = !item.installed ? `<code>${esc(item.install)}</code>`
      : item.where ? `${esc(item.plan)} · session in ${esc(item.where)}` : `${esc(item.plan)} · sign in inside the CLI`;
    const action = !item.installed ? 'Install' : item.loggedIn === false ? 'Sign In' : 'Open';
    row.innerHTML = `
      <span class="dot" style="background:${esc(item.color)};color:${esc(item.color)}"></span>
      <span class="meta"><strong>${esc(item.label)}</strong><small title="${esc(item.install)}">${detail}</small></span>
      <span class="badge ${cls}">${badge}</span>
      <span class="acts">
        <label class="pin" title="Show it in the bottom bar"><input type="checkbox" ${pinned ? 'checked' : ''}/> bar</label>
        <button type="button" title="${action === 'Install' ? 'Open a terminal with the install command' : action === 'Sign In' ? 'Open the CLI to sign in with your account' : 'Open this agent in the current project'}">${action}</button>
      </span>`;
    $('input', row).onchange = (e) => setPinned(item, e.target.checked);
    $('button', row).onclick = () => {
      $('#accounts').close();
      if (!item.installed) {
        newCard('term', 'shell', { cwd: null, title: `Install ${item.label}`, startCmd: item.install });
      } else if (item.loggedIn === false) {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key, { cwd: null, title: `Sign in · ${item.label}`, startCmd: item.login });
      } else {
        ensureAgent(item); renderAgentButtons();
        newCard('term', item.key);
      }
    };
    box.appendChild(row);
  }
}

// Ways to use a local model. Names come from the local server: only safe
// characters are accepted because they end up on the command line.
const SAFE_MODEL = /^[\w.:/@+-]+$/;
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const HARNESSES = {
  ollama: [
    { id: 'chat', label: 'Chat (ollama run)', agent: 'ollama', args: (m) => `run ${m}` },
    { id: 'codex', label: 'Codex (--oss)', agent: 'codex', args: (m) => `--oss -m ${m}` },
    { id: 'aider', label: 'Aider', agent: 'aider', args: (m) => `--model ollama_chat/${m}`, env: { OLLAMA_API_BASE: OLLAMA_BASE } },
  ],
  lmstudio: [
    { id: 'aider', label: 'Aider', agent: 'aider', args: (m) => `--model lm_studio/${m}`,
      env: { LM_STUDIO_API_BASE: 'http://127.0.0.1:1234/v1', LM_STUDIO_API_KEY: 'dummy-api-key' } },
  ],
};

function launchLocal(provider, model, harnessId) {
  const h = HARNESSES[provider].find((x) => x.id === harnessId);
  const item = catalog.find((i) => i.key === h.agent);
  if (item) ensureAgent(item, false);
  $('#accounts').close();
  newCard('term', h.agent, { title: `${model} · ${h.label.split(' (')[0]}`, args: h.args(model), env: h.env || null });
  renderAgentButtons();
}

function modelRow(provider, model) {
  const row = document.createElement('div');
  row.className = 'hub-row';
  const opts = HARNESSES[provider].map((h) => {
    const ok = catalog.find((i) => i.key === h.agent)?.installed !== false;
    return `<option value="${h.id}" ${ok ? '' : 'disabled'}>${esc(h.label)}${ok ? '' : ' — not installed'}</option>`;
  }).join('');
  row.innerHTML = `
    <span class="dot" style="background:var(--text);color:var(--text)"></span>
    <span class="meta"><strong>${esc(model)}</strong><small>${provider === 'ollama' ? 'Ollama' : 'LM Studio'} · runs on your machine</small></span>
    <select title="How to open this model">${opts}</select>
    <span class="acts"><button type="button" title="Open the model in a new card">Open</button></span>`;
  $('button', row).onclick = () => launchLocal(provider, model, $('select', row).value);
  return row;
}

function renderLocal(local) {
  const box = $('#localRows');
  box.innerHTML = '';
  const head = (name, badgeCls, badge) => {
    const h = document.createElement('div');
    h.className = 'local-head';
    h.innerHTML = `<strong>${name}</strong><span class="badge ${badgeCls}">${badge}</span>`;
    box.appendChild(h);
  };
  const note = (html) => { const n = document.createElement('div'); n.className = 'local-note'; n.innerHTML = html; box.appendChild(n); return n; };

  // Ollama
  const o = local.ollama;
  const oModels = o.models.filter((x) => SAFE_MODEL.test(x));
  head('Ollama', o.running ? 'ok' : 'no', o.running ? `Running · ${oModels.length} models` : o.installed ? 'Stopped' : 'Not installed');
  if (!o.installed) {
    note('Download it from <a href="https://ollama.com/download" target="_blank">ollama.com/download</a> and refresh.');
  } else if (!o.running) {
    const n = note('Ollama is installed but not running. ');
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = 'Start Ollama'; b.title = 'Run ollama serve in a new card';
    b.onclick = () => { $('#accounts').close(); newCard('term', 'shell', { cwd: null, title: 'ollama serve', startCmd: 'ollama serve' }); };
    n.appendChild(b);
  }
  if (o.installed) {
    if (o.running && !oModels.length) note('You have no models yet. Download one below.');
    for (const m of oModels) box.appendChild(modelRow('ollama', m));
    const pull = document.createElement('div');
    pull.className = 'pull-row';
    pull.innerHTML = `<input placeholder="Download a model, e.g. qwen3-coder, gpt-oss:20b, llama3.2" /><button type="button" title="Run ollama pull in a new card">Download</button>`;
    const go = () => {
      const m = $('input', pull).value.trim();
      if (!SAFE_MODEL.test(m)) { $('input', pull).focus(); return; }
      $('#accounts').close();
      newCard('term', 'shell', { cwd: null, title: `ollama pull ${m}`, startCmd: `ollama pull ${m}` });
    };
    $('button', pull).onclick = go;
    $('input', pull).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    box.appendChild(pull);
  }

  // LM Studio
  const l = local.lmstudio;
  const lModels = l.models.filter((x) => SAFE_MODEL.test(x));
  head('LM Studio', l.running ? 'ok' : '', l.running ? `Server running · ${lModels.length} models` : 'Server stopped');
  if (!l.running) note('Open LM Studio → Developer → start the local server (port 1234) and refresh.');
  for (const m of lModels) box.appendChild(modelRow('lmstudio', m));
}

$('#accountsBtn').onclick = openAccounts;
$('#moreAgents').onclick = openAccounts;
$('#accountsRefresh').onclick = renderAccounts;
