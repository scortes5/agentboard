// AgentBoard — Settings → Ground Rules: rules every agent follows. The main process writes them
// into each CLI's instructions file; agents whose CLI has none get them in the task prompt.
'use strict';
/* global $, ab, cfg, esc, toast, settingsSections */

const SUGGESTED_RULES = `- Commit with my git author only (the user.name and user.email already configured). Never add Co-Authored-By or other trailers, and never change the git config.
- Before deleting or overwriting a file, explain why and what it affects, then wait for my OK.
- Name branches feat/…, fix/… or refactor/…; never commit straight to main.
- Never push, force-push or rewrite history unless I ask.
- Never commit secrets (.env files, keys, tokens).
- Keep changes small and focused on the task; say what you did not do.`;

class GroundRules {
  constructor() {
    this.clis = [];   // CLIs that read the rules from their instructions file
    $('#rulesSuggest').onclick = () => {
      const area = $('#groundRules');
      area.value = [area.value.trim(), SUGGESTED_RULES].filter(Boolean).join('\n');
      area.focus();
    };
    ab.rulesStatus().then((s) => { this.clis = s.clis; });
  }

  static cli(key) {
    return (cfg.agents[key]?.command || '').trim().split(/\s+/)[0].split(/[\\/]/).pop().replace(/\.(cmd|exe)$/i, '');
  }

  // For the task prompt: only when the agent's CLI does not read them already.
  forTask(t) {
    const rules = (cfg.groundRules || '').trim();
    return rules && !this.clis.includes(GroundRules.cli(t.assigned)) ? `(Ground rules, always follow them:\n${rules})\n` : '';
  }

  renderFiles(s) {
    $('#rulesFiles').innerHTML = s.files.length
      ? `Written to: ${s.files.map((f) => `<code title="${esc(f.file)}">${esc(f.file.replace(/^.*?([\\/]\.[^\\/]+[\\/])/, '~$1'))}</code>`).join(' ')}. Other agents get them in each task.`
      : 'No CLI with an instructions file found yet: the rules go in each task instead.';
  }

  load(f) {
    f.groundRules.value = cfg.groundRules || '';
    ab.rulesStatus().then((s) => this.renderFiles(s));
  }

  save(f) { cfg.groundRules = f.groundRules.value.trim(); }

  async saved() {
    const r = await ab.rulesApply(cfg.groundRules);
    if (!r.ok) return toast(`Could not write the ground rules: ${esc(r.error)}`, 6000);
    this.clis = r.value.clis;
  }
}

const groundRules = new GroundRules();
settingsSections.push(groundRules);
