'use strict';

module.exports = {
  name: 'read_agent_output',
  description: 'Reads the last lines shown by another agent\'s terminal, together with its status.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Agent name, type or id.' },
      lines: { type: 'number', description: 'How many lines to read (1–400, default 80).' },
    },
    required: ['agent'],
  },
  async run(args, ctx, bridge) {
    const cfg = bridge.config.load();
    const target = bridge.resolveCard(cfg, args.agent);
    const lines = Math.min(Math.max(parseInt(args.lines, 10) || 80, 1), 400);
    bridge.notify({ kind: 'read', from: ctx.from, to: target.id });
    const d = bridge.describe(cfg, target);
    return `Status: ${d.status}\n---\n${bridge.readTail(target.id, lines) || '(no output yet)'}`;
  },
};
