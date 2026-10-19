---
name: agentboard-task
description: Protocol for tasks that come from the AgentBoard to-do list (messages that start with "[AgentBoard task"). Use it to stay focused, avoid stepping on other agents and report when you finish.
---

# AgentBoard task

This task comes from the user's list. Other agents (other subscriptions) may be working in parallel on the same project.

1. **Scope**: do only what the task asks. If you see something else to fix, mention it at the end in one line; do not do it.
2. **Do not step on others**: touch only the files the task needs. Do not `git checkout`, `reset`, `stash` or switch branches unless the task asks for it. If you are in an AgentBoard worktree (`.agentboard/worktrees/…`), work there and commit on that branch.
3. **Save tokens**: apply the `context-saving` skill (search before reading, bounded output, short answers).
4. **Verify** the minimum that proves it works (the affected test or command).
5. **Finish** like this, so AgentBoard marks the task:
   - If you have the `complete_task` tool (AgentBoard MCP), call it with a one-line summary (`blocked: true` if you could not finish).
   - And write as the last line of your answer, exactly:
     - `DONE: <what you did, in one line>` or
     - `BLOCKED: <what you need from the user>`
