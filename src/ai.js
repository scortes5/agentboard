// Short, cheap model calls with no terminal and no repository access: splitting and
// routing tasks, designing and explaining automations, and an automation's shell steps.
'use strict';
const { wrap } = require('./platform');
const { runHeadless, runInShell } = require('./shell-env');

function register(ipcMain) {
  // Split free text into tasks with Claude in non-interactive mode and the cheapest
  // model (haiku): one short call, no terminal, no repository access.
  ipcMain.handle('tasks:plan', wrap(async (_e, text, opts = {}) => {
    const agents = (opts.agents || []).join(', ') || 'claude, codex, gemini';
    const projects = (opts.projects || []).join(', ') || '(none)';
    const prompt = [
      'Turn this to-do list into concrete, independent tasks for coding agents that will run in parallel.',
      'Reply ONLY with a JSON array, no extra text:',
      '[{"text":"clear, self-contained instruction","agent":"auto|' + agents.replace(/, /g, '|') + '","light":true|false,"heavy":true|false,"project":"name or empty","group":"short label or empty","after":-1}]',
      'after: the index (0-based, in this same list) of an earlier task that must finish first, or -1 when it can start right away. Prefer -1: only use it when the task really needs the other\'s result.',
      'Split a large request into tasks that touch different files or areas, so agents do not step on each other; keep small requests as one task.',
      'light=true for simple work (docs, renames, a small test, a question); heavy=true only for hard work (architecture, tricky bugs, large refactors); never both.',
      'Use "auto" unless the text asks for a specific agent.',
      'Markers in a line are the user\'s choice and win: @name = agent, #name = group, +name = project, ! = light, !! = heavy. Do not copy markers into "text".',
      'Write each task in the same language as the to-do list.',
      'Available projects: ' + projects + '. Do not invent projects.',
      'To-do list:',
      String(text).slice(0, 8000),
    ].join('\n');
    const out = await runHeadless('claude -p --model haiku --tools "" --no-session-persistence', prompt);
    const m = out.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('Claude did not return a list.');
    const list = JSON.parse(m[0]);
    if (!Array.isArray(list)) throw new Error('Invalid response.');
    return list.filter((t) => t && typeof t.text === 'string' && t.text.trim()).slice(0, 40);
  }));

  // Short question to Claude with no terminal and no tools (design a flow, explain it, decide YES/NO).
  ipcMain.handle('ai:ask', wrap(async (_e, prompt, model = 'haiku') => {
    if (!['haiku', 'sonnet'].includes(model)) throw new Error('Invalid model.');
    const out = await runHeadless(`claude -p --model ${model} --tools "" --no-session-persistence`, String(prompt).slice(0, 30000), 180_000);
    return out.trim();
  }));

  // "Command" step of an automation, and a task's checks: runs in the user's shell, inside the project.
  ipcMain.handle('flow:exec', wrap((_e, cmd, cwd) => runInShell(cmd, cwd)));
}

module.exports = { register };
