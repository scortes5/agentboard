# Architecture

AgentBoard is a plain-JavaScript **Electron** app with no build step. The interface uses **xterm.js** for terminals; the main process uses **node-pty** to run them.

```
src/
  main/                 main process (Node)
    index.js            composition root: builds every service and hands them to App
    app/                App (window, background mode, quitting), AppMenu, TrayIcon, QuickKey,
                        SystemIpc (board file, folders, clipboard), WindowRequests
    core/               ConfigStore (board.json), platform helpers
    shell/              ShellEnv: the user's shell, its PATH, headless and shell runs
    terminals/          PtyHost: one real terminal per card
    git/                GitRunner, GitService (status, checkpoints, diffs), WorktreeService
    agents/             AgentCatalog, LocalModels, ClaudeAccounts; providers/ = one file per CLI
    library/            SkillLibrary, SkillPack, UsageService (+ the skills and usage readers)
    ai/                 TaskPlanner: haiku routing and the automations' questions
    bridge/             AgentBridge (local socket for agent-to-agent MCP); tools/ = one file per tool
    updates/            Updater with a strategy per platform (NativeUpdateStrategy, GitHubReleaseStrategy)
  preload/index.js      the only bridge between the page and Node (contextBridge)
  renderer/             the window (plain scripts loaded by index.html, in order)
    core/               shared state, formatting, icons, notices
    board/              viewport, cards, selection, groups, status loop, git pill, sidebar, minimap, tabs
    watchers/           TerminalWatchers registry; ErrorWatch, ApprovalsInbox
    tasks/              the queue and panel; pipeline/ (TaskPipeline + steps), CostTracker,
                        LimitsNotice, TemplateLibrary
    review/             ReviewDialog, UnifiedDiff
    agents/, settings/, flows/, diagram/, palette/, usage/   one folder per panel
    styles/             01-base … 07-task-control, loaded in that order
scripts/agentboard-mcp.js   stdio MCP server each CLI runs; asks the bridge for its tools
test/                   unit, open/closed and end-to-end tests
```

## Processes

- **Main** — `index.js` is the only place that creates services and wires them: each one is a class that receives its dependencies in its constructor and registers its own IPC channels in `register(ipcMain)`. `App` only owns the window and the app's lifecycle.
- **Preload** — exposes `window.ab`, the list of calls the page may make.
- **Renderer** — plain scripts sharing the board state (`cfg`). The board's building blocks are grouped by area; the processes with a life of their own (watchers, the task pipeline, review, costs, limits, templates) are classes, each with one instance.

## Extending AgentBoard (open/closed)

New behavior is added with a new file; the code that uses it does not change.

| To add… | Create… | Picked up by |
|---|---|---|
| A CLI (catalog, sign-in check, MCP registration, default agent) | `src/main/agents/providers/<key>.js` | `AgentCatalog`, the default board |
| A tool agents can call | `src/main/bridge/tools/<name>.js` (`name`, `description`, `inputSchema`, `run`) | `AgentBridge`, and the MCP server through it |
| A way to install updates | a class with `check()` (and `install()`) in `src/main/updates/` | `Updater` |
| Something to detect in terminals | a watcher with `name`, `every`, `enabled()`, `scan()`, registered with `terminalWatchers.add()` | the status loop |
| A step after a task says DONE | a step with `prompt()`, `onMarker()` or `afterFinish()`, registered with `taskPipeline.use()` | the task queue |
| A main-process service | a class with `register(ipcMain)` (and, if it needs them, `onReady()` and `onQuit()`) | one line in `src/main/index.js` |
| A CLI's global instructions file (for ground rules) | `instructions: (probe) => path` in its provider file | `GroundRules` |
| A view in the side bars | a `<section class="view" data-view="id">` with its body, and `viewLayout.register({ id, title, side, … })` | `ViewLayout` (collapse, drag, hide, resize, saved layout) |
| An automation template | an entry `{ id, name, description, ask, build }` in `FLOW_TEMPLATES` (`flows/FlowTemplates.js`) | the Templates menu |
| A section in Settings | an object with `load(form)`, `save(form)` and `saved()`, pushed to `settingsSections` | the Settings dialog |

`test/ocp.test.js` proves the first two by adding a provider and a tool as files in a temporary folder; the end-to-end test registers a pipeline step and a watcher from outside and checks they run.

## Design choices

- **Classes for processes, plain functions for helpers.** A class owns state and a lifecycle (a socket, a timer, a dialog); pure helpers (`platform`, `format`, `UnifiedDiff.parse`) stay functions.
- **Dependencies are passed in**, never reached for: services can be built and tested on their own.
- **Results, not exceptions, across IPC**: handlers that can fail answer `{ ok, value }` or `{ ok: false, error }`.
- **Data over branches**: per-CLI differences live in provider files, not in `if` chains.
- No bundler, framework or class hierarchies: a few thousand lines of plain JavaScript stay easy to read.

## Agent bridge

`AgentBridge` listens on a per-user socket (`0600`) or named pipe and writes `bridge.json` (socket path and random token) to the data folder. Each CLI launches `scripts/agentboard-mcp.js`, which asks the bridge for the tool list and forwards calls with the token (compared with `crypto.timingSafeEqual`). Writes go only to agent cards and are rate-limited.

## Tests

- `npm test` — unit tests (helpers, usage, the router's prompt) and the open/closed tests.
- `npm run test:e2e` — opens the real app with a throwaway board and drives tasks with `test/fake-agent.sh` standing in for a coding agent: the MCP server, approvals, checks, cross-review, review and undo, dependencies, templates, Settings, limits, every panel, and the extension points. CI runs both on every pull request (the end-to-end one under `xvfb`).
