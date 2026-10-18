# Architecture

AgentBoard is a plain-JavaScript **Electron** app with no build step. The renderer uses **xterm.js** for terminals and the main process uses **node-pty** to spawn them.

```
┌───────────────────── Renderer (index.html, plain scripts) ─────────────────────┐
│ app.js board, cards, settings   tasks.js queue, live progress                  │
│ task-checks.js checks, cross-review   approvals.js permission inbox            │
│ review.js diff, merge, PR, undo   templates.js   flows.js   diagram.js  …       │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ window.ab (contextBridge, preload.js)
┌───────────────▼──────────────────────── Main process ──────────────────────────┐
│ main.js  lifecycle, window, menus, tray — wires the modules below              │
│ pty-host.js terminals   git.js git & worktrees   agents.js CLIs & accounts      │
│ library.js skills & usage   ai.js cheap model calls   config.js   shell-env.js │
│ bridge.js local socket + token for agent-to-agent MCP                          │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ Unix socket / named pipe
┌───────────────▼────────────────────────────────────────┐
│ scripts/agentboard-mcp.js  stdio MCP server per CLI    │
└────────────────────────────────────────────────────────┘
```

## Processes

- **Main** (`src/main.js` and its modules): `main.js` creates the window with `contextIsolation: true` and `nodeIntegration: false`, builds the menus and the tray and wires the modules. Each module owns one area and registers its own `ipcMain.handle` channels: `pty-host` (`pty:*`), `git` (`git:*`), `agents` (`agents:*`, `catalog:status`, `local:models`, `accounts:*`, `bridge:status`), `library` (`skills:*`, `pack:*`, `usage:scan`) and `ai` (`tasks:plan`, `ai:ask`, `flow:exec`).
- **Preload** (`src/preload.js`): the only bridge between the page and Node, via `contextBridge`.
- **Renderer** (`src/renderer/*`): plain scripts loaded by `index.html`; all UI state lives here and is saved through `config:save`.

## Agent bridge

`src/bridge.js` listens on a per-user socket (`0600`) or named pipe and writes `bridge.json` (socket path + random token) to the data folder. Each CLI launches `scripts/agentboard-mcp.js`, which forwards MCP tool calls to the bridge with the token. Token comparison uses `crypto.timingSafeEqual`; writes are limited to agent cards and rate-limited.

## Tasks and status detection

A task opens a new card with the right CLI and model flags, optionally inside a fresh worktree (`agentboard/<task>`). Status comes from the terminal's recent output: `DONE: …` and `BLOCKED: …` lines (and the legacy `HECHO:` / `BLOQUEADO:`) finish a task; usage-limit messages move it to another subscription.

## Packaging

`electron-builder` produces a `.dmg` (arm64 and x64) and an NSIS `.exe`. `node-pty` and the MCP script are unpacked from the asar so they can be executed. Icons are generated from `src/assets/logo.svg` (`npm run icon`).

## Design

The code favors small, explicit pieces over frameworks. The patterns in use, and why:

- **Modules with one responsibility.** Each main-process file owns one area and exposes `register(ipcMain)`; `main.js` only wires them. The renderer is split the same way (tasks, checks, approvals, review, templates…). Files that grow past one job get split.
- **Factories with injected dependencies.** `createPtyHost({ send, getBridge })`, `createBridge({ … })` and `createUpdater({ … })` receive what they need instead of reaching for globals, so each can be reasoned about (and tested) on its own.
- **Result objects at the IPC boundary.** Handlers that can fail are wrapped (`platform.wrap`) and answer `{ ok, value }` or `{ ok: false, error }`; the interface always gets a message it can show instead of an exception crossing processes.
- **Request/response by id.** When the main process needs the window to answer (open a card for a subagent, add a task), `askWindow()` sends a request id and resolves when the answer with that id comes back, or with `null` after a timeout.
- **A small pipeline after each task.** `task-checks.js` decides what a DONE means: run the checks, send failures back, then optionally hand the work to a reviewer. Each step is one function.
- **Data over branches.** Per-CLI differences live in tables (`PROVIDERS`, `CATALOG`, the MCP commands) rather than in `if` chains.

What is deliberately *not* used: no bundler, no framework and no class hierarchies. The app is a few thousand lines of plain JavaScript, and plain functions over shared state keep it easy to read.

## Tests

`npm run test:e2e` opens the real app with a throwaway board and drives a task with `test/fake-agent.sh` standing in for a coding agent: a permission prompt in the inbox, failing checks sent back, a cross-review, the review diff, undo, dependencies and templates. CI runs it on Linux under `xvfb` on every pull request, together with syntax checks for every file.
