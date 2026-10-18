'use strict';
const path = require('path');

const codexHome = (home) => process.env.CODEX_HOME || home('.codex');

module.exports = {
  key: 'codex', label: 'Codex', order: 2, command: 'codex', color: '#3fbf8f',
  plan: 'ChatGPT Plus / Pro', install: 'npm i -g @openai/codex',
  agent: { label: 'Codex', resumeArgs: 'resume --last', lightArgs: '-c model_reasoning_effort=low', heavyArgs: '-c model_reasoning_effort=high' },
  instructions: ({ home }) => path.join(codexHome(home), 'AGENTS.md'),
  login: 'codex login', where: '~/.codex',
  isSignedIn: ({ exists, home }) => exists(codexHome(home), 'auth.json'),
  mcp: {
    add: (script) => `codex mcp add agentboard -- node ${script}`,
    remove: 'codex mcp remove agentboard',
    isRegistered: ({ readText, home }) => /^\[mcp_servers\.("?)agentboard\1\]/m.test(readText(path.join(codexHome(home), 'config.toml'))),
  },
};
