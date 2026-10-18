# Remote Control and Integrations

Everything here is in **Settings → Integrations** and is off until you turn it on.

## Remote control from your phone

1. Turn on **Let my phone control AgentBoard** and press **Save**.
2. Copy one of the links that appear and open it on your phone. The phone must be on the same Wi-Fi as the computer.
3. The page shows:
   - your tasks live: status, agent, time, tokens and the last line of output;
   - every permission request from the agents, with **Approve** and **Reject**;
   - a box to **add a task**, which goes to the queue like one you type in the Tasks panel.

**Security**
- Every request needs the random token in the link. The token travels after the `#`, a part the browser never sends to servers.
- **New Link** creates a new token; the old link stops working.
- The page uses plain http on your local network. Turn it on only on networks you trust (home or office, not a café or an airport).
- The port is `7777` by default. Change it if something else uses that port: the setting shows an error when the port is taken.

## Daily summary to a chat

1. Create an *incoming webhook* in your chat app:
   - **Slack:** *Apps → Incoming Webhooks*.
   - **Discord:** *Channel → Edit → Integrations → Webhooks*.
   - **Microsoft Teams** and **Google Chat** also give you a webhook URL.
2. Paste the URL (it must start with `https://`) and pick a time.
3. **Send Test** sends today's summary right away.

The summary is sent once a day, at the chosen time or as soon as the app is open after it. It lists the tasks done today and the ones still pending, the same Markdown as **Summary** in the Tasks panel.

## GitHub issues as tasks

**Issues** in the Tasks panel lists the open issues of the project chosen in the panel. Pick some and press **Add**:

- each one becomes a task (`#12 Fix the login`);
- the agent receives the issue's text;
- the pull request created from the task says `Closes #12`.

This needs the [GitHub CLI](https://cli.github.com) installed and signed in (`gh auth login`). AgentBoard stores no GitHub token.

## Ground rules

**Settings → Ground Rules** holds rules every agent follows, so you don't repeat them in each task. Examples:

- commit with your git author only, no `Co-Authored-By` lines;
- explain why before deleting a file, and wait for your OK;
- name branches `feat/…` or `fix/…`.

**Add Suggested Rules** fills in a starting set you can edit.

Where the rules go:
- AgentBoard writes them into the instructions file each CLI reads when it starts, so agents you open by hand follow them too:
  - `~/.claude/CLAUDE.md`, plus each extra Claude account's folder;
  - `~/.codex/AGENTS.md`;
  - `~/.gemini/GEMINI.md`;
  - `~/.qwen/QWEN.md`;
  - `~/.config/opencode/AGENTS.md`.
- The rules sit inside a marked block, and the rest of each file is left alone. Clearing the rules removes the block.
- Agents whose CLI has no such file get the rules at the start of each task instead.
