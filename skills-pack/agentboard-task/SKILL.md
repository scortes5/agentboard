---
name: agentboard-task
description: Protocol for tasks that come from the AgentBoard to-do list (messages that start with "[AgentBoard task"). Use it to stay focused, avoid stepping on other agents and report when you finish.
---

# AgentBoard task

This task comes from the user's list. Other agents (other subscriptions) may be working in parallel on the same project.

1. **Scope**: do only what the task asks. If you see something else to fix, mention it at the end in one line; do not do it.
2. **Do not step on others**: touch only the files the task needs. Do not `git checkout`, `reset`, `stash` or switch branches unless the task asks for it. If you are in an AgentBoard worktree (`.agentboard/worktrees/…`), work there and commit on that branch.
3. **Save tokens**: apply the `context-saving` skill (search before reading, bounded output, short answers).
4. **No loops**: finish the task in this session. Do not start `/goal`, `/loop`, scheduled wakeups or recurring jobs: they keep you working turn after turn and spend tokens after the work is done. Use them only when the task explicitly asks to repeat something or keep watching over time (e.g. "check the deploy every 10 minutes", "keep retrying until CI passes").
5. **Verify** the minimum that proves it works (the affected test or command).
6. **Finish** like this, so AgentBoard marks the task:
   - If you have the `complete_task` tool (AgentBoard MCP), call it with that same line as the summary (`blocked: true` if you could not finish).
   - And write as the last line of your answer, exactly:
     - `DONE: <what you did> | files: <main files changed> | checked: <how you verified it> | pending: <what is left, or nothing>` or
     - `BLOCKED: <what stops you> | needs: <what you need from the user>`
