# Agent Connection (MCP)

In *Skills and Agents → Agent Connection*, one click registers AgentBoard as an **MCP server** in each CLI. From then on every agent on the board can use these tools:

| Tool | Use |
|---|---|
| `list_agents` | See the agents on the board and their status. |
| `send_to_agent` | Send a message to another agent. |
| `read_agent_output` | Read another agent's recent output. |
| `start_agent` | Open a new agent with a task. |
| `list_tasks` / `add_task` / `complete_task` | Use the shared task list: hand out work and mark it done. |

Example prompts:

- *"Ask Codex what it thinks of this change and summarize its comments."*
- *"Split this refactor into three tasks with add_task and give one to Gemini."*
- *"Start an agent in the docs project that updates the changelog."*

## How it works

`scripts/agentboard-mcp.js` is a small stdio MCP server launched by each CLI. It reads `bridge.json` from AgentBoard's data folder and talks to the app over a **local socket** (a Unix socket with `0600` permissions, or a named pipe on Windows) protected by a **random token** compared in constant time.

Safety limits:

- It only writes to cards running an agent, never to a plain shell.
- Each card can turn the bridge off.
- Messages are rate-limited per minute.
- If AgentBoard is not running, the tools simply answer that it is not available.
