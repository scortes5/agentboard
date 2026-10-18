# Architecture

AgentBoard is a plain-JavaScript **Electron** app with no build step. The renderer uses **xterm.js** for terminals and the main process uses **node-pty** to spawn them.

```
┌──────────────── Renderer (index.html) ────────────────┐
│ app.js      board, cards, groups, tabs, settings       │
│ tasks.js    task queue, spreading across subscriptions │
│ flows.js    automations: editor, runs, AI design       │
│ diagram.js  diagram view   palette.js  command palette │
│ icons.js    icons and contextual help                  │
└───────────────┬────────────────────────────────────────┘
                │ window.api (contextBridge, preload.js)
┌───────────────▼──────────── Main process ──────────────┐
│ main.js   PTYs, git & worktrees, menu, tray, settings  │
│ skills.js read/edit each CLI's skills and subagents    │
│ bridge.js local socket + token for agent-to-agent MCP  │
└───────────────┬────────────────────────────────────────┘
                │ Unix socket / named pipe
┌───────────────▼────────────────────────────────────────┐
│ scripts/agentboard-mcp.js  stdio MCP server per CLI    │
└────────────────────────────────────────────────────────┘
```

## Processes

- **Main** (`src/main.js`): creates the window with `contextIsolation: true` and `nodeIntegration: false`, owns the PTYs, runs git commands and worktrees, persists `board.json`, and exposes everything through `ipcMain.handle` channels such as `pty:create`, `git:status`, `git:worktree`, `tasks:plan`, `ai:ask`, `flow:exec`, `skills:scan` and `bridge:status`.
- **Preload** (`src/preload.js`): the only bridge between the page and Node, via `contextBridge`.
- **Renderer** (`src/renderer/*`): plain scripts loaded by `index.html`; all UI state lives here and is saved through `config:save`.

## Agent bridge

`src/bridge.js` listens on a per-user socket (`0600`) or named pipe and writes `bridge.json` (socket path + random token) to the data folder. Each CLI launches `scripts/agentboard-mcp.js`, which forwards MCP tool calls to the bridge with the token. Token comparison uses `crypto.timingSafeEqual`; writes are limited to agent cards and rate-limited.

## Tasks and status detection

A task opens a new card with the right CLI and model flags, optionally inside a fresh worktree (`agentboard/<task>`). Status comes from the terminal's recent output: `DONE: …` and `BLOCKED: …` lines (and the legacy `HECHO:` / `BLOQUEADO:`) finish a task; usage-limit messages move it to another subscription.

## Packaging

`electron-builder` produces a `.dmg` (arm64 and x64) and an NSIS `.exe`. `node-pty` and the MCP script are unpacked from the asar so they can be executed. Icons are generated from `src/assets/logo.svg` (`npm run icon`).
