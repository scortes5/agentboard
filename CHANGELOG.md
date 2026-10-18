# Changelog

All notable changes to AgentBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added
- Repository setup: CI workflow, Dependabot for npm and GitHub Actions, issue and pull request templates, contributing guide, code of conduct, security policy and a [wiki](https://github.com/scortes5/agentboard/wiki) published from `wiki/`.
- Release notes are generated automatically on tagged builds.

## [0.6.0] - 2026-10-17

### Added
- **Updates**: AgentBoard checks for a new release when it opens and every six hours. On Windows it downloads the update in the background and installs it on restart (**Restart to Update**). On Mac it shows a notice with a **Download** button that opens the `.dmg` for your Mac; silent installs need an Apple Developer ID signature, which the app does not have yet.
- **Check for Updates…** in the app menu (Mac) or the Board menu (Windows), and **Settings → General → Check for updates automatically** (on by default).

### Changed
- The Windows installer is now named `AgentBoard-Setup-x.y.z.exe`, and each release also includes `latest.yml` and a `.blockmap` for updates.

## [0.5.0] - 2026-10-17

### Added
- **Usage and Savings** panel (⇧⌘U): a GitHub-style heatmap of daily activity (tokens, sessions or tasks done), totals, cache savings and hit rate, task success rate, median time and tokens per task, and usage by subscription and project. It reads the Claude Code and Codex logs on this computer (all Claude accounts included); nothing leaves it.
- **Light subagents**: `start_agent` accepts `light: true` to open the agent with its cheap model, and the diagram draws which agent opened which.
- A **Saving mode** switch in each card's options menu.

## [0.4.0] - 2026-10-17

### Added
- Documentation: README with screenshots, a [getting started guide](docs/GUIDE.md) for first-time users, and this changelog.
- MIT license (`LICENSE`).

### Changed
- **The app is now in English**: interface, menus, notifications, prompts sent to the agents and documentation.
- Data saved by earlier versions (task statuses, automation modes) is migrated on load; nothing is lost.
- Agents now finish tasks with `DONE: …` / `BLOCKED: …`. The older `HECHO:` / `BLOQUEADO:` lines are still recognized.
- The token-saving skills are renamed `context-saving`, `agentboard-task` and `compact-handoff`. Installing them removes the copies with the old names.
- Automations: connections that go down from one row to the next are drawn along the side instead of crossing the diagram.
- Groups that only hold notes show how many they have instead of "empty".

### Fixed
- The theme preview in Settings was not applied to the terminals.
- An automation step whose agent had been deleted showed "undefined".

## [0.3.0] - 2026-10-17

Includes the 0.2.0 changes, which were not released separately.

### Added
- **Projects in parallel**: each project is a tab with its own view and groups; agents in all of them keep working at once.
- **Settings** by section: General, Appearance, Agents, Shortcuts, Projects, Tasks and Advanced (JSON editor).
- **Appearance**: light, dark or automatic theme, accent color, interface size, typeface, and terminal theme and line height, with a live preview.
- **Editable keyboard shortcuts**, with a warning when two actions share a combination.
- n8n-style **automations**: trigger, agent, command, decision, notify and concept. Branches run in parallel and can be scheduled.
- **Design with AI** (from a description to a diagram) and **Explain Run** (the AI describes what will happen, the risks and possible improvements).
- **Contextual help**: hold the pointer over a button for 2 seconds to see what it does.

### Changed
- **macOS style**: unified toolbar, edge-to-edge sidebar and inspector, system typeface and hairlines.
- Custom line icons instead of emoji and symbols.

## [0.2.0] - 2026-10-17

### Added
- **Several Claude accounts** as separate subscriptions, each with its own config folder.
- **Usage limit**: if a subscription runs out, the task moves to another; the exhausted one waits for its reset time.
- **Heavy mode** (`!!`) besides light mode (`!`).
- **Trust and Continue**: a button that answers the trust prompt of a new folder.
- **Review and merge** a task's work done in a worktree, or discard it.
- Move a task to the top of the queue, a **daily summary** in Markdown and a Dock badge.
- A **global shortcut** to add tasks from any app and a **command palette** (⇧⌘P).

### Fixed
- The clipboard did not work with Electron 44 (copying from the terminals).

## [0.1.2] - 2026-10-17

### Changed
- New logo and app icons, generated from an SVG.

## [0.1.1] - 2026-10-17

### Fixed
- Tasks were not marked as done when the agent's summary contained «» quotes.

## [0.1.0] - 2026-10-17

### Added
- **Desktop app** with its own icon, installed with `npm run app`.
- **Background mode**: closing the window does not stop the agents; menu bar icon.
- Each Claude card resumes **its own session** when reopened.
- **Tasks**: a to-do list spread across subscriptions, with a queue and parallelism limits, an optional worktree per task and AI splitting.
- MCP tools `list_tasks`, `add_task` and `complete_task`.
- Board **groups** and a **Diagram** view by project, group and agent.
- **Token-saving skills** (then named `ahorro-contexto`, `tarea-agentboard` and `traspaso-compacto`).

### Fixed
- Terminals did not open on Mac (`posix_spawnp failed`) because of a missing node-pty permission.
- A false "process exited" notice when restarting a card.
- Claude did not start when AgentBoard was opened from a Claude Code terminal.

## [0.0.2] - 2026-10-17

### Added
- Redesigned canvas, agent panel, minimap and per-card options menu.
- CLI catalog per subscription and local models (Ollama, LM Studio).
- Skills and agents: view and copy skills between CLIs; create and edit Claude subagents.
- Local MCP bridge so agents can list each other, message each other and open other agents.

## [0.0.1] - 2026-10-17

### Added
- First release: a board of terminals for CLI agents on Mac and Windows.

[Unreleased]: https://github.com/scortes5/agentboard/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/scortes5/agentboard/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/scortes5/agentboard/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/scortes5/agentboard/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/scortes5/agentboard/compare/v0.1.2...v0.3.0
[0.2.0]: https://github.com/scortes5/agentboard/compare/v0.1.2...v0.3.0
[0.1.2]: https://github.com/scortes5/agentboard/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/scortes5/agentboard/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/scortes5/agentboard/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/scortes5/agentboard/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/scortes5/agentboard/releases/tag/v0.0.1
