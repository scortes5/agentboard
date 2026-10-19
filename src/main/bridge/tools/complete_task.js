'use strict';

module.exports = {
  name: 'complete_task',
  description: 'Marks the AgentBoard task assigned to you as finished, with a one-line summary. Call it when you finish a task that came from the AgentBoard list.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What you did, in one line.' },
      blocked: { type: 'boolean', description: 'true if you could not finish and need the user.' },
      task_id: { type: 'string', description: 'Task id (optional; defaults to yours).' },
    },
    required: ['summary'],
  },
  async run(args, ctx, bridge) {
    const r = await bridge.askWindow('task-done', {
      id: args.task_id ? String(args.task_id) : null, card: ctx.from,
      summary: String(args.summary || '').slice(0, 500), blocked: !!args.blocked,
    });
    if (!r || r.error) throw new Error(r?.error || 'No task is assigned to this agent.');
    return `Task "${r.text.slice(0, 80)}" marked as ${r.status}.`;
  },
};
