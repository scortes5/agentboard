'use strict';
const path = require('path');

module.exports = {
  name: 'list_tasks',
  description: 'Lists the user\'s AgentBoard tasks: text, status (pending/running/review/done/blocked), assigned agent and project.',
  inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status (optional).' } } },
  async run(args, _ctx, bridge) {
    const cfg = bridge.config.load();
    const want = String(args.status || '').toLowerCase();
    const tasks = (cfg.tasks || []).filter((t) => !want || t.status === want).map((t) => ({
      id: t.id, text: t.text.length > 300 ? t.text.slice(0, 300) + '…' : t.text, status: t.status,
      agent: t.agent, project: cfg.projects.find((p) => p.path === t.cwd)?.name || (t.cwd ? path.basename(t.cwd) : ''),
      group: t.group || '', card: t.cardId || null, summary: t.summary || '',
    }));
    return tasks.length ? JSON.stringify(tasks, null, 2) : 'No tasks.';
  },
};
