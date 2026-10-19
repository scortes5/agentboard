'use strict';

module.exports = {
  name: 'add_task',
  description: 'Adds a task to the user\'s queue. AgentBoard runs it in a new session with the given subscription (or the least busy one with "auto"), in parallel with others. Use it to spread independent work across Claude, Codex and Gemini.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Self-contained instruction: what to do, in which files, and how to tell it is done.' },
      agent: { type: 'string', description: '"auto" (default), "claude", "codex", "gemini" or another configured agent.' },
      project: { type: 'string', description: 'Project name (optional; defaults to the caller\'s project).' },
      group: { type: 'string', description: 'Board group where the agent should appear (optional).' },
      light: { type: 'boolean', description: 'true for simple tasks: uses that subscription\'s cheaper model.' },
    },
    required: ['text'],
  },
  async run(args, ctx, bridge) {
    const text = String(args.text || '').trim();
    if (!text) throw new Error('The task is empty.');
    if (text.length > 8000) throw new Error('Task too long (max 8,000 characters).');
    if (!bridge.rateOk(ctx.from || 'unknown')) throw new Error('Too many actions in a row; wait a minute.');
    const r = await bridge.askWindow('task-add', {
      text, agent: args.agent ? String(args.agent) : 'auto', project: args.project ? String(args.project) : '',
      group: args.group ? String(args.group).slice(0, 40) : '', light: !!args.light, from: ctx.from,
    });
    if (!r || r.error) throw new Error(r?.error || 'AgentBoard did not respond.');
    return `Task added (id ${r.id}). It will run with ${r.agent} as soon as there is a free slot.`;
  },
};
