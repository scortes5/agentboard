'use strict';

module.exports = {
  name: 'start_agent',
  description: 'Opens a new agent on the board (e.g. "codex", "claude", "gemini") and optionally sends it a first task. By default it opens in the caller\'s project. For simple subtasks pass light=true (cheaper model, saves tokens).',
  inputSchema: {
    type: 'object',
    properties: {
      agent_type: { type: 'string', description: 'Agent type: claude, codex, gemini or another one configured in AgentBoard.' },
      project: { type: 'string', description: 'AgentBoard project name (optional).' },
      title: { type: 'string', description: 'Card name (optional).' },
      message: { type: 'string', description: 'First task (optional).' },
      light: { type: 'boolean', description: 'Saving mode: opens the agent with its cheap model (e.g. Claude Haiku). Use it for simple subtasks.' },
    },
    required: ['agent_type'],
  },
  async run(args, ctx, bridge) {
    const cfg = bridge.config.load();
    const want = String(args.agent_type || '').trim().toLowerCase();
    const key = Object.keys(cfg.agents).find((k) => k === want || (cfg.agents[k].label || '').toLowerCase() === want);
    if (!key || !cfg.agents[key].command) throw new Error(`Unknown agent type. Options: ${Object.entries(cfg.agents).filter(([, a]) => a.command).map(([k]) => k).join(', ')}`);
    let cwd = cfg.cards.find((c) => c.id === ctx.from)?.cwd || cfg.selectedProject || null;
    if (args.project) {
      const p = cfg.projects.find((x) => x.name.toLowerCase() === String(args.project).toLowerCase() || x.path === args.project);
      if (!p) throw new Error(`Unknown project. Options: ${cfg.projects.map((x) => x.name).join(', ')}`);
      cwd = p.path;
    }
    if (!bridge.rateOk(ctx.from || 'unknown')) throw new Error('Too many actions in a row; wait a minute.');
    const id = await bridge.requestNewCard({ agent: key, cwd, title: args.title ? String(args.title).slice(0, 60) : null, light: !!args.light, from: ctx.from || null });
    if (!id) throw new Error('Could not open the agent.');
    bridge.notify({ kind: 'start', from: ctx.from, to: id });
    if (args.message) {
      // Wait for the CLI to start before typing into it.
      const t0 = Date.now();
      while (!bridge.ptys.has(id) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 200));
      await new Promise((r) => setTimeout(r, 4000));
      const from = cfg.cards.find((c) => c.id === ctx.from);
      // Subagents get the same rule as task agents: no /goal or /loop unless the task asks to repeat.
      bridge.paste(id, `[Task from ${from ? from.title : 'another agent'} via AgentBoard]\n${String(args.message).slice(0, 20000)}\n`
        + '(Finish in this session: do not start /goal, /loop, scheduled wakeups or recurring jobs unless the task explicitly asks to repeat something or keep watching over time.)');
    }
    return `Opened a ${cfg.agents[key].label} agent${args.light ? ' in saving mode' : ''} (id ${id}).${args.message ? ' Sent it the task.' : ''} Use read_agent_output with that id to follow its progress.`;
  },
};
