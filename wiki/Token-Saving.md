# Token Saving

Your plans have usage limits. AgentBoard is designed to stretch them:

- **A fresh session per task**: each task starts with a clean context.
- **Light mode** (`!`) uses a cheaper model for simple work; **heavy mode** (`!!`) only when needed.
- **Spreading across subscriptions and accounts** so you do not exhaust a single plan.
- **Minimal context in automations**: each step receives a one-line summary of the previous ones.

## Bundled skills

*Skills and Agents → Token Saving → Install or Update in All* installs them into Claude Code, Codex and Gemini:

| Skill | What it teaches the agent |
|---|---|
| `context-saving` | Search before reading, read only what is needed, answer briefly. |
| `agentboard-task` | Stay on the task, do not step on other agents, report `DONE:` / `BLOCKED:`. |
| `compact-handoff` | Delegate with a short summary, not the whole history. |

The source lives in [`skills-pack/`](https://github.com/scortes5/agentboard/tree/main/skills-pack).

## Habits that help

1. One task, one concrete to-do.
2. Prefer Tasks over long conversations.
3. Use `!` for text edits, renames and questions.
4. Add every Claude account you have under *Subscriptions*.
