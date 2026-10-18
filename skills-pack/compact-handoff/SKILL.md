---
name: compact-handoff
description: How to hand work to another agent (send_to_agent, add_task, "Send to…") without sending it whole logs. Use it before delegating or asking another subscription for a second opinion.
---

# Compact handoff

The other agent starts without your context, and its subscription pays for every line you send. Send a summary, not your history.

Format (about 15 lines at most):

```
Goal: <what must be achieved, one line>
Status: <what is already done / what was tested>
Files: <relevant paths, with line numbers when useful>
Ask: <the concrete action you expect>
Done when: <how it will know it finished>
```

- Include only the error or code excerpt that is essential (≤ 20 lines), never the full output of a command.
- If the task is independent and can run in parallel, use `add_task` (it goes to the queue and picks a subscription with room) instead of waiting for the answer.
- To read the answer use `read_agent_output` with few lines (30–60), and only when the agent is "waiting".
