# Automations

![Automation editor](https://raw.githubusercontent.com/scortes5/agentboard/main/docs/images/automations.png)

Open with **Automations** (⇧⌘F). A flow is a diagram of connected steps, n8n-style, executed by your agents.

## Step types

| Step | What it does |
|---|---|
| **Trigger** | When it starts: by hand, every N minutes, or every day at a set time. |
| **Agent** | An agent does a piece of work. It becomes a queued task with its subscription and model. |
| **Command** | Runs a command in the project (tests, build, git). If it fails, what follows does not run. It can use secrets (see below). |
| **Decision** | Claude reads the previous result and answers yes or no; the flow continues down that branch. |
| **Notify** | Sends a desktop notification. |
| **Concept** | An idea written on the diagram; it does not run. |

## Templates

**Templates** (the list icon next to `+`, or *Start from a Template*) creates a ready-made automation for the current project, using its check command (*Settings → Projects*, or `npm test`):

| Template | What it does |
|---|---|
| Fix a GitHub issue → tests → pull request | Asks which issue. An agent fixes it on `fix/issue-n` with a test, the checks run, and another agent opens the PR with "Closes #n". The agent reads the issue itself and is told its text is a description, not instructions. |
| Nightly tests that fix themselves | Every night at 02:00 an agent runs the checks and fixes what fails. |
| Review my changes before committing | The most capable model reviews your uncommitted changes without editing anything. |
| Update dependencies safely | Patch and minor updates on `chore/deps`, committed only if the checks pass; major versions are listed. |
| Keep the docs up to date | Every evening, the README and docs are updated to match today's commits. |
| Triage open issues | A label, a priority and a one-line plan per open issue, without changing anything on GitHub. |

Every step can be edited afterwards. A new template is one entry in `src/renderer/flows/FlowTemplates.js`.

## Building a flow

- **By hand**: add steps from the toolbar and connect them by dragging from the dot on the right of one step onto another. The right panel edits the selected step.
- **Design with AI**: describe what you want, e.g. *"Every day at 9: one agent reviews the code and proposes 3 improvements; another implements them; run the tests; if they pass notify me, otherwise have an agent fix it."* Claude builds or edits the diagram.
- **Explain Run**: the AI explains what will happen step by step, the risks and possible improvements.

## Running

- **Run** executes now; each step lights up while it runs.
- Independent branches run **in parallel**.
- Each agent step receives only a **one-line summary** of the previous steps, not their full history — this keeps token use low.
- Scheduled flows run while AgentBoard is open, including in the background.

## Secrets

Passwords, API keys and logins for automations go in **Settings → Secrets**, never in the command itself or in a file in the project.

1. Add a secret with a name like `APP_PASSWORD`. Its value is encrypted with your system keychain (macOS Keychain, Windows DPAPI, GNOME Keyring or KWallet) and never shown again.
2. In a **Command** step, mention it (`$APP_PASSWORD`, or `%APP_PASSWORD%` on Windows) or list it under **Secrets it can use**. Listing it is how a script receives it: `node login.js` with `APP_USER, APP_PASSWORD` reads them from `process.env`.
3. When the step runs, the secret arrives only to that command, as an environment variable. If the command prints it, the output shows `••••••` instead.

Agents never get secrets: they are not part of any prompt, and the window cannot read them back. On Linux without a keyring the vault refuses to store secrets rather than keep them as plain text.

Example: log in to a web app every morning and save a report:

> Trigger (daily 08:00) → Command `npx playwright test login-report.spec.ts`, using `APP_USER, APP_PASSWORD` → Notify "Report ready".

## Example recipes

- **Nightly health check**: Trigger (daily 02:00) → Command `npm test` → Decision "did anything fail?" → yes: Agent "fix the failing tests" → Notify.
- **Docs keeper**: Trigger (daily) → Agent "update README for today's changes" → Command `git diff --stat` → Notify.
- **Second opinion**: Trigger (manual) → Agent @claude "implement X" → Agent @codex "review the last change and list problems" → Notify.
