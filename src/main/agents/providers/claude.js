'use strict';
const { IS_MAC } = require('../../core/platform');

module.exports = {
  key: 'claude', label: 'Claude Code', order: 1, command: 'claude', color: '#e8875f',
  plan: 'Claude Pro / Max', install: 'npm i -g @anthropic-ai/claude-code',
  agent: { label: 'Claude', resumeArgs: '--continue', lightArgs: '--model haiku', heavyArgs: '--model opus' },
  login: 'claude', where: IS_MAC ? 'macOS Keychain' : '~/.claude',
  async isSignedIn({ keychainHas, exists, home }) {
    return (await keychainHas('Claude Code-credentials')) || exists(process.env.CLAUDE_CONFIG_DIR || home('.claude'), '.credentials.json');
  },
  mcp: {
    add: (script) => `claude mcp add --scope user agentboard -- node ${script}`,
    remove: 'claude mcp remove --scope user agentboard',
    isRegistered: ({ readJson, home }) => !!readJson(home('.claude.json'))?.mcpServers?.agentboard,
  },
};
