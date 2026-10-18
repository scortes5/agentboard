# Automations

![Automation editor](https://raw.githubusercontent.com/scortes5/agentboard/main/docs/images/automations.png)

Open with **Automations** (⇧⌘F). A flow is a diagram of connected steps, n8n-style, executed by your agents.

## Step types

| Step | What it does |
|---|---|
| **Trigger** | When it starts: by hand, every N minutes, or every day at a set time. |
| **Agent** | An agent does a piece of work. It becomes a queued task with its subscription and model. |
| **Command** | Runs a command in the project (tests, build, git). If it fails, what follows does not run. |
| **Decision** | Claude reads the previous result and answers yes or no; the flow continues down that branch. |
| **Notify** | Sends a desktop notification. |
| **Concept** | An idea written on the diagram; it does not run. |

## Building a flow

- **By hand**: add steps from the toolbar and connect them by dragging from the dot on the right of one step onto another. The right panel edits the selected step.
- **Design with AI**: describe what you want, e.g. *"Every day at 9: one agent reviews the code and proposes 3 improvements; another implements them; run the tests; if they pass notify me, otherwise have an agent fix it."* Claude builds or edits the diagram.
- **Explain Run**: the AI explains what will happen step by step, the risks and possible improvements.

## Running

- **Run** executes now; each step lights up while it runs.
- Independent branches run **in parallel**.
- Each agent step receives only a **one-line summary** of the previous steps, not their full history — this keeps token use low.
- Scheduled flows run while AgentBoard is open, including in the background.

## Example recipes

- **Nightly health check**: Trigger (daily 02:00) → Command `npm test` → Decision "did anything fail?" → yes: Agent "fix the failing tests" → Notify.
- **Docs keeper**: Trigger (daily) → Agent "update README for today's changes" → Command `git diff --stat` → Notify.
- **Second opinion**: Trigger (manual) → Agent @claude "implement X" → Agent @codex "review the last change and list problems" → Notify.
