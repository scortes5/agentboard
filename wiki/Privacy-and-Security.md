# Privacy and Security

- Everything runs on your computer. AgentBoard has **no server and no telemetry**.
- Each CLI keeps its credentials where it always does; AgentBoard does not read or copy them.
- Your code is read by the agents you open, exactly as if you ran them in a terminal.

## Where data is stored

Readable only by your user:

| System | Path |
|---|---|
| macOS | `~/Library/Application Support/AgentBoard/board.json` |
| Windows | `%APPDATA%\AgentBoard\board.json` |

To move your board to another computer, copy `board.json`. Boards are intentionally not synced.

## Agent bridge

A local socket with a random token (see [[Agent Connection]]). It only writes to agent cards, can be turned off per card and is rate-limited.

## Reporting a vulnerability

Please use a [private security advisory](https://github.com/scortes5/agentboard/security/advisories/new). See the [security policy](https://github.com/scortes5/agentboard/security/policy).
