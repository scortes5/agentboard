# Security Policy

## Supported versions

Only the latest release receives security fixes. Please update before reporting.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through [GitHub Security Advisories](https://github.com/scortes5/agentboard/security/advisories/new).

Include what you found, how to reproduce it and the impact you expect. You will get an answer within a few days; once a fix is released you will be credited in the advisory unless you prefer otherwise.

## Scope

AgentBoard runs CLI agents in real terminals on your computer, so these areas matter most:

- **The agent bridge** (`src/bridge.js`, `scripts/agentboard-mcp.js`): a local socket protected by a random token. Anything that lets another local user or a web page talk to it, bypass the token, or write to a plain shell card is in scope.
- **Renderer isolation** (`src/preload.js`): any way for terminal output or board content to run code with Node privileges.
- **Saved data** (`board.json`): it should only be readable by your user.
- **Worktrees and git commands** run on your behalf.

Problems in the agent CLIs themselves (Claude Code, Codex, Gemini CLI…) should be reported to their vendors.
