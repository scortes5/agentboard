// What the CLIs know: skills, commands and subagents, the bundled token-saving skills,
// and the usage read from their local logs.
'use strict';
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const skills = require('./skills');
const usage = require('./usage');
const { wrap } = require('./platform');
const { loadConfig } = require('./config');
const { claudeAccountDirs } = require('./agents');

const projectsOf = () => loadConfig().projects || [];

// skills-pack/<name>/SKILL.md, copied into each CLI's skills folder; the
// SKILL.md format is the same in Claude Code, Codex and Gemini.
const PACK_DIR = path.join(__dirname, '..', 'skills-pack');

// Names the same skills had up to v0.3.0; removed on install so they are not duplicated
const LEGACY_PACK = ['ahorro-contexto', 'tarea-agentboard', 'traspaso-compacto'];

const removeLegacyPack = (root) => { for (const n of LEGACY_PACK) fs.rmSync(path.join(root, n), { recursive: true, force: true }); };

const PACK_ROOTS = { claude: () => path.join(skills.claudeDir(), 'skills'), codex: () => path.join(skills.codexDir(), 'skills'), gemini: () => path.join(skills.geminiDir(), 'skills') };

function packSkills() {
  let names = [];
  try { names = fs.readdirSync(PACK_DIR).filter((n) => fs.existsSync(path.join(PACK_DIR, n, 'SKILL.md'))); } catch {}
  return names.map((name) => {
    const text = fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md'), 'utf8');
    const { meta } = skills.frontmatter(text);
    const installed = {};
    for (const [k, root] of Object.entries(PACK_ROOTS)) {
      try { installed[k] = fs.readFileSync(path.join(root(), name, 'SKILL.md'), 'utf8') === text ? 'ok' : 'old'; } catch { installed[k] = null; }
    }
    return { name, description: meta.description || '', installed };
  });
}

// Copy every bundled skill into one CLI's skills folder (readFileSync works inside app.asar; cpSync does not).
function installPack(root, label) {
  removeLegacyPack(root);
  return packSkills().map(({ name }) => {
    const dest = path.join(root, name);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'SKILL.md'), fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md')));
    return `${label}/${name}`;
  });
}

function register(ipcMain) {
  ipcMain.handle('usage:scan', wrap((_e, tasks) => usage.scanUsage({
    tasks, historyFile: path.join(app.getPath('userData'), 'task-history.json'),
    claudeDirs: [skills.claudeDir(), ...claudeAccountDirs()], codexDir: skills.codexDir(),
  })));

  ipcMain.handle('skills:scan', () => skills.scanSkills(projectsOf()));

  ipcMain.handle('skills:copy', wrap((_e, src, target) => skills.copySkill(src, target, projectsOf())));

  ipcMain.handle('agents:list', () => skills.listAgents(projectsOf()));

  ipcMain.handle('agents:save', wrap(async (_e, a) => {
    const r = skills.saveAgent(a, projectsOf());
    if (r.replaced) await shell.trashItem(r.replaced);
    return r.file;
  }));

  ipcMain.handle('agents:delete', wrap(async (_e, file) => {
    if (!skills.isAgentFile(file, projectsOf())) throw new Error('Invalid agent file.');
    await shell.trashItem(file); // to the Trash: recoverable
    return true;
  }));

  ipcMain.handle('skills:reveal', (_e, p) => {
    const known = skills.scanSkills(projectsOf()).some((x) => path.resolve(x.path) === path.resolve(p))
      || skills.listAgents(projectsOf()).some((x) => path.resolve(x.file) === path.resolve(p));
    if (known) shell.showItemInFolder(p);
  });

  ipcMain.handle('pack:status', () => packSkills());

  // Install (or update) the token-saving skills for the given subscriptions.
  ipcMain.handle('pack:install', wrap((_e, providers) => {
    const done = [];
    for (const k of providers || []) {
      if (!PACK_ROOTS[k]) continue;
      done.push(...installPack(PACK_ROOTS[k](), k));
      if (k === 'claude') for (const dir of claudeAccountDirs()) done.push(...installPack(path.join(dir, 'skills'), path.basename(dir)));
    }
    return done;
  }));
}

module.exports = { register };
