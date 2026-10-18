'use strict';

module.exports = {
  key: 'gemini', label: 'Gemini CLI', order: 3, command: 'gemini', color: '#6c9cf5',
  plan: 'Google account (free)', install: 'npm i -g @google/gemini-cli',
  agent: { label: 'Gemini', resumeArgs: '', lightArgs: '-m gemini-2.5-flash', heavyArgs: '-m gemini-2.5-pro' },
  instructions: ({ home }) => home('.gemini', 'GEMINI.md'),
  login: 'gemini', where: '~/.gemini',
  isSignedIn: ({ exists, home }) => exists(home('.gemini'), 'oauth_creds.json'),
  mcp: {
    add: (script) => `gemini mcp add --scope user agentboard node ${script}`,
    remove: 'gemini mcp remove --scope user agentboard',
    isRegistered: ({ readJson, home }) => !!readJson(home('.gemini', 'settings.json'))?.mcpServers?.agentboard,
  },
};
