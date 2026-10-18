// The token-saving skills bundled with AgentBoard (skills-pack/<name>/SKILL.md), installed
// into each CLI's skills folder; the SKILL.md format is the same in Claude Code, Codex and Gemini.
'use strict';
const fs = require('fs');
const path = require('path');
const skills = require('./skills');
const { wrap } = require('../core/platform');

const PACK_DIR = path.join(__dirname, '..', '..', '..', 'skills-pack');
// Names the same skills had up to v0.3.0; removed on install so they are not duplicated.
const LEGACY = ['ahorro-contexto', 'tarea-agentboard', 'traspaso-compacto'];
const ROOTS = { claude: () => path.join(skills.claudeDir(), 'skills'), codex: () => path.join(skills.codexDir(), 'skills'), gemini: () => path.join(skills.geminiDir(), 'skills') };

class SkillPack {
  constructor({ claudeAccounts }) {
    this.claudeAccounts = claudeAccounts;
  }

  names() {
    try { return fs.readdirSync(PACK_DIR).filter((n) => fs.existsSync(path.join(PACK_DIR, n, 'SKILL.md'))); } catch { return []; }
  }

  // Each bundled skill and whether each CLI has it up to date ('ok'), outdated ('old') or not at all.
  status() {
    return this.names().map((name) => {
      const text = fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md'), 'utf8');
      const installed = {};
      for (const [k, root] of Object.entries(ROOTS)) {
        try { installed[k] = fs.readFileSync(path.join(root(), name, 'SKILL.md'), 'utf8') === text ? 'ok' : 'old'; } catch { installed[k] = null; }
      }
      return { name, description: skills.frontmatter(text).meta.description || '', installed };
    });
  }

  // Copy every bundled skill into one skills folder (readFileSync works inside app.asar; cpSync does not).
  installInto(root, label) {
    for (const n of LEGACY) fs.rmSync(path.join(root, n), { recursive: true, force: true });
    return this.names().map((name) => {
      fs.mkdirSync(path.join(root, name), { recursive: true });
      fs.writeFileSync(path.join(root, name, 'SKILL.md'), fs.readFileSync(path.join(PACK_DIR, name, 'SKILL.md')));
      return `${label}/${name}`;
    });
  }

  // Install (or update) for the given CLIs; Claude also gets it in every extra account.
  install(providers = []) {
    const done = [];
    for (const k of providers.filter((p) => ROOTS[p])) {
      done.push(...this.installInto(ROOTS[k](), k));
      if (k === 'claude') for (const dir of this.claudeAccounts.dirs()) done.push(...this.installInto(path.join(dir, 'skills'), path.basename(dir)));
    }
    return done;
  }

  register(ipcMain) {
    ipcMain.handle('pack:status', () => this.status());
    ipcMain.handle('pack:install', wrap((_e, providers) => this.install(providers)));
  }
}

module.exports = { SkillPack };
