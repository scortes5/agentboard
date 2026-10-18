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

## What agents can do

Agents run with **your permissions**: anything you can do on this computer, they can. AgentBoard does not sandbox them; it helps you decide what to allow.

- **Settings → Security → Dangerous** (on by default: `rm -rf`, `git push --force`, `git reset --hard`, `sudo`, `curl … | sh`, `.env`, `.ssh/`, `DROP TABLE`, `npm publish`…): matching requests are flagged in red, left out of **Approve All**, ask once more before you approve them and can't be approved from the phone.
- **Approve automatically**: empty by default. Add only commands that read or test (`npm test`, `git status`).
- **Activity**: every answer (yours, the phone's or a rule's), remote devices, automation commands with the secrets they got, and secrets saved or removed, in `audit.log` (readable only by your user).

## Text from outside

Anything an agent reads can try to give it instructions ("prompt injection"): a README, a web page, an issue. AgentBoard fences GitHub issue text in the prompt and tells the agent to treat it only as a description; issues from outside the project are flagged and shown before you queue them. Keep reading what agents ask to run, especially after they read content from strangers.

## The window

The interface runs in Chromium's sandbox with context isolation, no Node.js, a strict content security policy and navigation blocked: what a terminal prints or a board contains cannot run code.

## The phone remote

Off by default. HTTPS with a certificate made on your computer, a random token in the link, off by itself after 8 hours, each device announced and logged, wrong links rate-limited, dangerous requests only approvable at the computer. See [[Remote Control and Integrations]].

## Secrets

Encrypted with your system keychain; the window can list names but not read values; only the automation commands that ask for one get it, and its value is hidden in their output. A command can still send a secret somewhere on purpose: give secrets only to commands you trust. See [[Automations]].

## Unsigned app

The installers are not signed with an Apple or Microsoft certificate, so your system cannot confirm they come from this project. Download them only from this repository's Releases page.

## Agent bridge

A local socket with a random token (see [[Agent Connection]]). It only writes to agent cards, can be turned off per card and is rate-limited.

## Reporting a vulnerability

Please use a [private security advisory](https://github.com/scortes5/agentboard/security/advisories/new). See the [security policy](https://github.com/scortes5/agentboard/security/policy).
