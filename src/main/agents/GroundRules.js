// Ground rules: what you want every agent to follow (commit as you, explain before deleting
// files, …), written once in Settings. They go into the global instructions file each CLI reads
// at the start of every session (CLAUDE.md, AGENTS.md, GEMINI.md…, declared by the provider
// files), inside a marked block, so the rest of each file stays yours. Agents without such a
// file get the rules in their task prompt instead.
'use strict';
const fs = require('fs');
const path = require('path');
const probe = require('./probe');
const { loadProviders } = require('./registry');
const { wrap } = require('../core/platform');

const START = '<!-- agentboard:ground-rules:start (edit them in AgentBoard → Settings → Ground Rules) -->';
const END = '<!-- agentboard:ground-rules:end -->';
const BLOCK_RE = /\n*<!-- agentboard:ground-rules:start[^\n]*-->[\s\S]*?<!-- agentboard:ground-rules:end -->\n*/;

class GroundRules {
  constructor({ config, claudeAccounts, providers = loadProviders() }) {
    Object.assign(this, { config, claudeAccounts, providers });
  }

  // The file's text with the block replaced, added at the end, or removed when there are no rules.
  static merge(text, rules) {
    const rest = String(text || '').replace(BLOCK_RE, '\n\n').trim();
    const block = rules.trim() ? `${START}\n## Ground rules\n\n${rules.trim()}\n${END}` : '';
    return [rest, block].filter(Boolean).join('\n\n') + (rest || block ? '\n' : '');
  }

  // Instructions files of the CLIs used on this computer (their folder exists), and of every
  // extra Claude account.
  targets() {
    const list = this.providers.filter((p) => p.instructions).map((p) => ({ cli: p.command, label: p.label, file: p.instructions(probe) }));
    for (const dir of this.claudeAccounts.dirs()) list.push({ cli: 'claude', label: `Claude (${path.basename(dir)})`, file: path.join(dir, 'CLAUDE.md') });
    const seen = new Set();
    return list.filter((t) => fs.existsSync(path.dirname(t.file)) && !seen.has(t.file) && seen.add(t.file));
  }

  apply(rules = this.config.load().groundRules || '') {
    const written = [];
    for (const t of this.targets()) {
      const before = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '';
      // a file without our block is only touched to add rules
      const after = BLOCK_RE.test(before) || rules.trim() ? GroundRules.merge(before, rules) : before;
      if (after !== before) fs.writeFileSync(t.file, after);
      written.push(t);
    }
    return this.status(written);
  }

  // Which CLIs read the rules from a file (the rest get them in the task prompt).
  status(targets = this.targets()) {
    return { files: targets.map(({ label, file }) => ({ label, file })), clis: [...new Set(targets.map((t) => t.cli))] };
  }

  // A CLI installed or an account added since the last start gets the rules too.
  onReady() { try { this.apply(); } catch (err) { console.error('Ground rules:', err.message); } }

  register(ipcMain) {
    ipcMain.handle('rules:apply', wrap((_e, rules) => this.apply(String(rules ?? ''))));
    ipcMain.handle('rules:status', () => this.status());
  }
}

module.exports = { GroundRules };
