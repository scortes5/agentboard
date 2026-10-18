---
name: context-saving
description: Work with few tokens and little context. Use it always for tasks that come from AgentBoard, in large repos, or when the user asks to save tokens, go fast or be brief.
---

# Context saving

Every token you read or write counts against the user's subscription. Do the same with less.

## Reading
- Search before opening: `grep -rn`/`rg` with a precise pattern, narrow `ls` or `find -name`. Do not list the whole repo.
- Open only the range you need (offset/limit, `sed -n 'A,Bp'`), not whole files hundreds of lines long.
- Do not re-read a file you already read, or the one you just edited.
- Do not open `node_modules`, `dist`, `build`, lockfiles, binaries or generated data.

## Commands
- Limit output: `| head -50`, `| tail -30`, `--quiet`, `-q`, `--silent`, `--porcelain`.
- Tests: run only the affected file or test, not the whole suite, except at the end.
- If a command can print thousands of lines, redirect it to a file and read only the summary or the error.

## Writing
- Edit with targeted replacements; do not rewrite whole files to change a few lines.
- Do not paste back to the user code that is already in the file; name `file:line`.
- Short answers: what changed, where, and what is left. Do not restate the task or explain the obvious.

## Thinking
- If the task is ambiguous, pick the simplest reading and say so in one line instead of exploring everything.
- For broad searches use a subagent or one well-aimed search, not ten scattered reads.
- If the context is already long and you change topic, suggest `/compact` or a new session.
