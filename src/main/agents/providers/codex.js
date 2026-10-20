'use strict';
const path = require('path');

const codexHome = (home) => process.env.CODEX_HOME || home('.codex');

module.exports = {
  key: 'codex', label: 'Codex', order: 2, command: 'codex', color: '#3fbf8f',
  plan: 'ChatGPT Plus / Pro', install: 'npm i -g @openai/codex',
  // The Codex counterparts of haiku / sonnet / opus (editable in Settings → Agents when the
  // model names change).
  agent: {
    label: 'Codex', resumeArgs: 'resume --last',
    lightArgs: '-m gpt-5.6-luna -c model_reasoning_effort=low',
    normalArgs: '-m gpt-5.6-terra -c model_reasoning_effort=medium',
    heavyArgs: '-m gpt-6-astra -c model_reasoning_effort=high',
  },
  // Earlier defaults: a saved board still holding one of these moves to the new default.
  previousArgs: { lightArgs: ['-c model_reasoning_effort=low'], heavyArgs: ['-c model_reasoning_effort=high'] },
  instructions: ({ home }) => path.join(codexHome(home), 'AGENTS.md'),
  login: 'codex login', where: '~/.codex',
  isSignedIn: ({ exists, home }) => exists(codexHome(home), 'auth.json'),
  mcp: {
    add: (script) => `codex mcp add agentboard -- node ${script}`,
    remove: 'codex mcp remove agentboard',
    isRegistered: ({ readText, home }) => /^\[mcp_servers\.("?)agentboard\1\]/m.test(readText(path.join(codexHome(home), 'config.toml'))),
  },
};
