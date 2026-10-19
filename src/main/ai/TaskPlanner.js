// Short, cheap model calls with no terminal, no tools and no repository access: splitting
// and routing tasks (haiku), and the questions automations ask (design, explain, decide).
'use strict';
const { wrap } = require('../core/platform');

const CLAUDE_HEADLESS = (model) => `claude -p --model ${model} --tools "" --no-session-persistence`;
const MODELS = ['haiku', 'sonnet'];

class TaskPlanner {
  constructor({ shellEnv }) {
    this.shellEnv = shellEnv;
  }

  // The router's instructions: what it may choose, the user's markers, and what it knows
  // about the subscriptions (local ones are free; past results per subscription).
  static planPrompt(text, { agents = [], projects = [], local = [], history = '' } = {}) {
    const names = agents.join('|') || 'claude|codex|gemini';
    return [
      'Turn this to-do list into concrete, independent tasks for coding agents that will run in parallel.',
      'Reply ONLY with a JSON array, no extra text:',
      `[{"text":"clear, self-contained instruction","agent":"auto|${names}","light":true|false,"heavy":true|false,"project":"name or empty","group":"short label or empty","after":-1}]`,
      'after: the index (0-based, in this same list) of an earlier task that must finish first, or -1 when it can start right away. Prefer -1: only use it when the task really needs the other\'s result.',
      'Split a large request into tasks that touch different files or areas, so agents do not step on each other; keep small requests as one task.',
      'light=true for simple work (docs, renames, a small test, a question); heavy=true only for hard work (architecture, tricky bugs, large refactors); never both.',
      'Use "auto" unless the text asks for a specific agent.',
      ...(local.length ? [`These agents run local models for free: ${local.join(', ')}. Send them trivial tasks (renames, docs, small questions) with light=true.`] : []),
      ...(history ? [`How each agent did on past tasks: ${history}. When a task is clearly the kind one agent is better at, pick it; otherwise use "auto".`] : []),
      'Markers in a line are the user\'s choice and win: @name = agent, #name = group, +name = project, ! = light, !! = heavy. Do not copy markers into "text".',
      'Write each task in the same language as the to-do list.',
      `Available projects: ${projects.join(', ') || '(none)'}. Do not invent projects.`,
      'To-do list:',
      String(text).slice(0, 8000),
    ].join('\n');
  }

  // The tasks in a model's answer (the JSON array, whatever surrounds it).
  static parsePlan(out) {
    const m = String(out).match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Claude did not return a list.');
    const list = JSON.parse(m[0]);
    if (!Array.isArray(list)) throw new Error('Invalid response.');
    return list.filter((t) => t && typeof t.text === 'string' && t.text.trim()).slice(0, 40);
  }

  async plan(text, opts) {
    return TaskPlanner.parsePlan(await this.shellEnv.runHeadless(CLAUDE_HEADLESS('haiku'), TaskPlanner.planPrompt(text, opts)));
  }

  async ask(prompt, model = 'haiku') {
    if (!MODELS.includes(model)) throw new Error('Invalid model.');
    return (await this.shellEnv.runHeadless(CLAUDE_HEADLESS(model), String(prompt).slice(0, 30000), 180_000)).trim();
  }

  register(ipcMain) {
    ipcMain.handle('tasks:plan', wrap((_e, text, opts) => this.plan(text, opts)));
    ipcMain.handle('ai:ask', wrap((_e, prompt, model) => this.ask(prompt, model)));
  }
}

module.exports = { TaskPlanner };
