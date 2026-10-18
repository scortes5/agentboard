'use strict';

module.exports = {
  name: 'send_to_agent',
  description: 'Sends a message or task to another agent on the board; it arrives as if the user typed it in that terminal. Use it to delegate or to ask for a second opinion, then read the answer with read_agent_output.',
  inputSchema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'Card name, agent type (e.g. "codex") or id, as returned by list_agents.' },
      message: { type: 'string', description: 'Full text of the task or question, with the context it needs.' },
    },
    required: ['agent', 'message'],
  },
  async run(args, ctx, bridge) {
    const cfg = bridge.config.load();
    const target = bridge.resolveCard(cfg, args.agent);
    const message = String(args.message || '').trim();
    if (!message) throw new Error('The message is empty.');
    if (message.length > 20000) throw new Error('Message too long (max 20,000 characters).');
    if (target.id === ctx.from) throw new Error('You cannot send messages to yourself.');
    if (!bridge.canReceive(cfg, target)) throw new Error(`"${target.title}" does not accept messages (it is a terminal, it is closed, or the user disabled it).`);
    if (!bridge.rateOk(ctx.from || 'unknown')) throw new Error('Too many messages in a row; wait a minute.');
    const from = cfg.cards.find((c) => c.id === ctx.from);
    const header = `[Message from ${from ? from.title : 'another agent'} via AgentBoard]\n`;
    bridge.paste(target.id, header + message);
    bridge.notify({ kind: 'send', from: ctx.from, to: target.id });
    return `Sent to "${target.title}". Read its answer with read_agent_output in a while (if it is "working", wait until it is "waiting").`;
  },
};
