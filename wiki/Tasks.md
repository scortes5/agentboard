# Tasks

![Tasks panel](https://raw.githubusercontent.com/scortes5/agentboard/main/docs/images/tasks.png)

Open with the **Tasks** button (⇧⌘T). Write one to-do per line and press Enter.

## Syntax

| Token | Meaning |
|---|---|
| `@claude`, `@codex`, `@gemini`… | Which subscription does it. Without `@` it is **auto**: the one with the least work. |
| `#group` | Open the agent in that board group (created if missing). |
| `+project` | Which project it runs in. |
| `!` | **Light**: a cheaper model (e.g. haiku). |
| `!!` | **Heavy**: a more capable model (e.g. opus). |

Example:

```
fix the Google login #backend
@claude write tests for the payments API
update the README !
refactor the payments module !!
```

## Lifecycle

| Status | When |
|---|---|
| **Queued** | Waiting for a free slot. |
| **Working** | An agent is on it, in a **fresh session**. |
| **Needs your review** | The agent finished or asked a question. |
| **Done** | The agent wrote `DONE: <summary>`. |
| **Blocked** | The agent wrote `BLOCKED: <reason>`. |

## Queue and limits

- **Parallel** caps how many tasks run at once; **per subscription** caps each plan.
- With **Run queue** on, queued tasks start by themselves when there is room.
- **Move to top** reorders the queue.
- **Usage limit**: if a subscription runs out, the task moves to another; the exhausted one waits for its reset time.
- **Trust and Continue** answers the "trust this folder" prompt without going to the card.

## Worktree per task

Each task works on its own branch `agentboard/<task>` in a separate git worktree, so several agents can change the same repository safely. When it finishes, **View changes** shows the diff and lets you **Merge** or **Discard**.

## Helpers

- **Route** (on by default): when you add tasks, Claude's cheapest model (haiku, one short call with no terminal) splits what you wrote into independent tasks and picks the subscription and the model (light or heavy) for each one; the queue then runs them in parallel. Markers you write (`@agent`, `#group`, `+project`, `!`, `!!`) always win. Turn it off in the composer or in *Settings → Tasks*. Without Claude installed, lines are added as they are.
- **Split**: paste free text and Claude breaks it into tasks, without starting them.
- **Summary**: copies what was done today and what is pending, as Markdown.
- **Global shortcut** (⌃⌥Space, configurable): add a task from any app.
- **Command palette** (⇧⌘P): typing something that does not exist and pressing Enter adds it as a task.
- Agents can also manage tasks themselves through MCP: see [[Agent Connection]].
