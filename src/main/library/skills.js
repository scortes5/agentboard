// Skills, commands and agents of each CLI, read from this computer's disk.
// Only names and descriptions are read; nothing leaves the machine.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const codexDir = () => process.env.CODEX_HOME || path.join(HOME, '.codex');
const geminiDir = () => path.join(HOME, '.gemini');

function read(file, max = 64 * 1024) {
  try { const s = fs.readFileSync(file, 'utf8'); return s.length > max ? s.slice(0, max) : s; } catch { return null; }
}
function subdirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() || d.isSymbolicLink()).map((d) => d.name); } catch { return []; }
}
function files(dir, ext) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(ext)).map((d) => path.join(dir, d.name)); } catch { return []; }
}

// Minimal YAML: top-level keys, single-line values or > / | blocks
function frontmatter(text) {
  const m = (text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text || '' };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      let v = kv[2].trim();
      if (/^[>|][-+]?$/.test(v)) v = '';
      else if (/^".*"$/.test(v)) { try { v = JSON.parse(v); } catch { v = v.slice(1, -1); } }
      else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'");
      meta[key] = v;
    } else if (key && /^\s+\S/.test(line)) {
      meta[key] = (meta[key] ? meta[key] + ' ' : '') + line.trim();
    }
  }
  return { meta, body: m[2] };
}

const skillDirs = (root) => subdirs(root).map((n) => path.join(root, n)).filter((d) => fs.existsSync(path.join(d, 'SKILL.md')));

function skill(dir, provider, scope) {
  const text = read(path.join(dir, 'SKILL.md'));
  if (text == null) return null;
  const { meta } = frontmatter(text);
  return { kind: 'skill', provider, scope, name: meta.name || path.basename(dir), description: meta.description || '', path: dir };
}

function codexPlugins() {
  const text = read(path.join(codexDir(), 'config.toml')) || '';
  const markets = {};
  const enabled = [];
  let sec = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const h = line.match(/^\[(.+)\]$/);
    if (h) { sec = h[1]; continue; }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv || !sec) continue;
    let m;
    if ((m = sec.match(/^marketplaces\.("?)([^"]+)\1$/)) && kv[1] === 'source') markets[m[2]] = kv[2].trim().replace(/^"|"$/g, '');
    if ((m = sec.match(/^plugins\."([^"]+)"$/)) && kv[1] === 'enabled' && kv[2].trim() === 'true') enabled.push(m[1]);
  }
  return enabled
    .map((id) => { const [name, market] = id.split('@'); return { name, dir: markets[market] ? path.join(markets[market], 'plugins', name) : null }; })
    .filter((p) => p.dir && fs.existsSync(p.dir));
}

function claudePlugins() {
  let s = {};
  try { s = JSON.parse(read(path.join(claudeDir(), 'settings.json')) || '{}'); } catch {}
  const out = [];
  for (const [id, on] of Object.entries(s.enabledPlugins || {})) {
    if (!on) continue;
    const [name, market = ''] = id.split('@');
    const base = path.join(claudeDir(), 'plugins');
    const candidates = [path.join(base, 'marketplaces', market, 'plugins', name), path.join(base, 'marketplaces', market, name)];
    for (const v of subdirs(path.join(base, 'cache', market, name))) candidates.push(path.join(base, 'cache', market, name, v));
    const dir = candidates.find((d) => fs.existsSync(d));
    if (dir) out.push({ name, dir });
  }
  return out;
}

function scanSkills(projects) {
  const items = [];
  const add = (x) => { if (x) items.push(x); };
  const commandMd = (f, provider, scope, prefix) => {
    const { meta } = frontmatter(read(f) || '');
    items.push({ kind: 'command', provider, scope, name: prefix + path.basename(f, '.md'), description: meta.description || '', path: f });
  };

  // Claude Code
  for (const d of skillDirs(path.join(claudeDir(), 'skills'))) add(skill(d, 'claude', 'User'));
  for (const p of projects) for (const d of skillDirs(path.join(p.path, '.claude', 'skills'))) add(skill(d, 'claude', `Project · ${p.name}`));
  for (const pl of claudePlugins()) for (const d of skillDirs(path.join(pl.dir, 'skills'))) add(skill(d, 'claude', `Plugin · ${pl.name}`));
  for (const f of files(path.join(claudeDir(), 'commands'), '.md')) commandMd(f, 'claude', 'User', '/');

  // Codex
  for (const d of skillDirs(path.join(codexDir(), 'skills'))) add(skill(d, 'codex', 'User'));
  for (const d of skillDirs(path.join(codexDir(), 'skills', '.system'))) add(skill(d, 'codex', 'System'));
  for (const d of skillDirs(path.join(HOME, '.agents', 'skills'))) add(skill(d, 'codex', 'User'));
  for (const p of projects) {
    for (const root of ['.agents', '.codex']) for (const d of skillDirs(path.join(p.path, root, 'skills'))) add(skill(d, 'codex', `Project · ${p.name}`));
  }
  for (const pl of codexPlugins()) for (const d of skillDirs(path.join(pl.dir, 'skills'))) add(skill(d, 'codex', `Plugin · ${pl.name}`));
  for (const f of files(path.join(codexDir(), 'prompts'), '.md')) commandMd(f, 'codex', 'User', '/prompts:');

  // Gemini CLI
  for (const d of skillDirs(path.join(geminiDir(), 'skills'))) add(skill(d, 'gemini', 'User'));
  for (const f of files(path.join(geminiDir(), 'commands'), '.toml')) {
    const m = (read(f) || '').match(/^description\s*=\s*"(.*)"/m);
    items.push({ kind: 'command', provider: 'gemini', scope: 'User', name: '/' + path.basename(f, '.toml'), description: m ? m[1] : '', path: f });
  }
  for (const n of subdirs(path.join(geminiDir(), 'extensions'))) {
    const dir = path.join(geminiDir(), 'extensions', n);
    let j = {};
    try { j = JSON.parse(read(path.join(dir, 'gemini-extension.json')) || '{}'); } catch {}
    items.push({ kind: 'extension', provider: 'gemini', scope: 'Extension', name: j.name || n, description: j.description || '', path: dir });
  }

  const seen = new Set();
  return items.filter((x) => { const k = x.provider + '\0' + path.resolve(x.path); if (seen.has(k)) return false; seen.add(k); return true; });
}

const SKILL_ROOTS = { claude: () => path.join(claudeDir(), 'skills'), codex: () => path.join(codexDir(), 'skills'), gemini: () => path.join(geminiDir(), 'skills') };

// Copy a skill into another CLI's user folder (the SKILL.md format is the same).
function copySkill(src, target, projects) {
  const known = scanSkills(projects).some((x) => x.kind === 'skill' && path.resolve(x.path) === path.resolve(src));
  if (!known) throw new Error('Unknown skill.');
  if (!SKILL_ROOTS[target]) throw new Error('Invalid destination.');
  const root = SKILL_ROOTS[target]();
  const dest = path.join(root, path.basename(src));
  if (fs.existsSync(dest)) throw new Error('A skill with that name already exists there.');
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
  return dest;
}

// ---------- Claude Code subagents (~/.claude/agents/*.md) ----------
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MODELS = ['', 'inherit', 'sonnet', 'opus', 'haiku'];

function agentDirs(projects) {
  return [
    { scope: 'User', project: null, dir: path.join(claudeDir(), 'agents') },
    ...projects.map((p) => ({ scope: `Project · ${p.name}`, project: p.path, dir: path.join(p.path, '.claude', 'agents') })),
  ];
}

function listAgents(projects) {
  const out = [];
  for (const { scope, project, dir } of agentDirs(projects)) {
    for (const f of files(dir, '.md')) {
      const { meta, body } = frontmatter(read(f) || '');
      out.push({
        provider: 'claude', scope, project, file: f,
        name: meta.name || path.basename(f, '.md'),
        description: meta.description || '', model: meta.model || '', tools: meta.tools || '',
        prompt: body.trim(),
      });
    }
  }
  return out;
}

function isAgentFile(file, projects) {
  const r = path.resolve(file);
  return r.endsWith('.md') && agentDirs(projects).some(({ dir }) => path.dirname(r) === path.resolve(dir));
}

// Returns { file, replaced } — `replaced` is the previous file when renamed (main moves it to the Trash).
function saveAgent(a, projects) {
  const name = String(a.name || '').trim();
  if (!AGENT_NAME.test(name)) throw new Error('Invalid name: use lowercase letters, numbers and hyphens (e.g. code-reviewer).');
  if (!MODELS.includes(a.model || '')) throw new Error('Invalid model.');
  const tools = String(a.tools || '').replace(/[\r\n]+/g, ' ').trim();
  if (tools && !/^[\w\s,.*():\-/]+$/.test(tools)) throw new Error('Invalid tools.');
  const project = a.project ? projects.find((p) => p.path === a.project) : null;
  if (a.project && !project) throw new Error('Unknown project.');

  const dir = project ? path.join(project.path, '.claude', 'agents') : path.join(claudeDir(), 'agents');
  const file = path.join(dir, name + '.md');
  const prev = a.file ? path.resolve(a.file) : null;
  if (prev && !isAgentFile(prev, projects)) throw new Error('Invalid agent file.');
  if (prev !== file && fs.existsSync(file)) throw new Error('An agent with that name already exists there.');

  const lines = ['---', `name: ${name}`, `description: ${JSON.stringify(String(a.description || '').replace(/\s+/g, ' ').trim())}`];
  if (tools) lines.push(`tools: ${tools}`);
  if (a.model) lines.push(`model: ${a.model}`);
  lines.push('---', '', String(a.prompt || '').trim(), '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join('\n'));
  return { file, replaced: prev && prev !== file ? prev : null };
}

module.exports = { scanSkills, copySkill, listAgents, saveAgent, isAgentFile, frontmatter, claudeDir, codexDir, geminiDir };
