'use strict';

module.exports = {
  name: 'list_agents',
  description: 'Lists the agents open on the user\'s AgentBoard (Claude Code, Codex, Gemini, local models…) with their project, group, current task, status (working/waiting/stopped) and whether they accept messages. "you": true marks the caller.',
  inputSchema: { type: 'object', properties: {} },
  async run(_args, ctx, bridge) {
    const cfg = bridge.config.load();
    const agents = cfg.cards.filter((c) => c.type === 'term').map((c) => ({ ...bridge.describe(cfg, c), you: c.id === ctx.from }));
    return agents.length ? JSON.stringify(agents, null, 2) : 'No agents are open on the board.';
  },
};
