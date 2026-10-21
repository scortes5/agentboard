# Changelog

All notable changes to AgentBoard. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: new features raise the middle number (`1.1.0`), fixes and small changes the last one (`1.0.1`), and a milestone with many features the first one (`2.0.0`).

## [Unreleased]

### Added

- Branch per group (Queue Options or Settings → Tasks): tasks of the same `#group` share one worktree on `agentboard/group-<name>`, each finished task is committed there, and the branch is pushed to origin once the group has nothing left to run.
- Automation run summary: after each run, a table of its steps (status, time, tokens, result) and a few lines from haiku on what worked, what failed and what to check; **Copy Summary** gives it as Markdown.
- Lessons per automation: **Correct It** on a failed step (or **Add Lesson**) saves a rule that the automation's agents and conditions get on every later run, and that Design with AI keeps.
- Live view of automation agents: a running Agent step shows the last line of its terminal on the node and in the inspector, with **Open Terminal**.
- A task's terminals (its agent and its subagents) close on their own a few seconds after it is done; blocked tasks stay open. With cross-review on, the author's card waits for the reviewer. Turn it off in Settings → Tasks.

### Changed

- Tasks without a marker and the subagents agents open now run on a mid-tier model (`normal args`: Claude `--model sonnet`, Codex `gpt-5.6-terra`) instead of the CLI's default. Codex light and heavy tasks now pick a model too (`gpt-5.6-luna` / `gpt-6-astra`); boards still on the old Codex defaults move to the new ones.
- Task results are clearer: agents end with «DONE: what they did | files | checked | pending» (or «BLOCKED: … | needs: …»), shown as labeled rows with the files git saw change. A DONE line the CLI wrapped onto several rows is now read whole (it used to keep only the first row).
- The router sends more simple work (config tweaks, one-file fixes) to the light model.

## [1.11.0] - 2026-10-20

### Added
- **Branches follow GitHub**: every 15 minutes AgentBoard fetches each project and fast-forwards the local branches that are only behind GitHub and are not checked out, so no working folder changes by itself (turn it off with *Auto* in the Branches view). **Pull All** does it now and also updates checked-out branches without uncommitted changes. **Push** lists the branches with commits GitHub does not have (selected) and those that only exist on this computer (not selected) and pushes the ones you pick. Branches only on GitHub are listed with **Track** to create a local branch that follows them. Nothing is ever forced: branches with commits on both sides are left alone and reported, and git never waits for a password.

## [1.10.0] - 2026-10-20

### Added
- **Event triggers for automations**: an automation can start *when a task finishes* (done, blocked or either; optionally only in one project or for tasks that mention some text) or *when a new GitHub issue is opened* (optionally with a label, checked every few minutes with the `gh` CLI). The task's summary or the issue reaches the agents as context, and `{issue}` in an instruction or a command becomes the issue's number. Issues already open when you turn it on are skipped, issues from outside the project are ignored unless you allow them, and tasks created by automations never start one, so automations cannot loop.
- **Clean Up in the Branches view**: lists the branches already merged into the main branch (or whose pull request was merged) and AgentBoard's task worktrees that no task or card uses, all selected for you to review, and deletes the ones you keep checked. Worktrees with uncommitted changes or unmerged commits are shown but never deleted.
- **Branch graph**: *Graph* in the Branches view shows the history of every local branch as colored lines, one color per branch kept along its history, with hollow dots where a branch was merged and a label naming the merged branch, even after it was deleted. Click a branch to jump to it and highlight its commits, click a commit (or move with ↑ ↓, and ← for its parent) to see its message, the files it changed and links to its parents and children, and open it on GitHub.
- **Issues and branches linked**: the Branches view shows the issue each branch works on (from its name, like `fix/issue-12`, or because its pull request closes it), and *Issues* shows the branches and pull requests already working on each issue.

## [1.9.0] - 2026-10-19

### Added
- **"On error" paths in automations**: *Agent* and *Command* steps have a second, red output for what to do if they fail, for example an agent that fixes the failing tests. A failure handled this way no longer stops the run.
- **Time limits for automation steps**: an *Agent* step can give up after a number of minutes (60 for new steps, no limit for existing ones), so a task left waiting for review no longer hangs the run; the task itself is left for you. A *Command* step's limit (10 minutes before) can now be set from 1 to 180 minutes.
- **Pull requests in the Branches view**: each branch shows its pull request (open, draft, merged or closed) and, while it is open, whether its checks pass, fail or are running. Click it to open the PR on GitHub. Needs the `gh` CLI; without it, branches still show.
- **Fix this issue**: a button on each issue in *Issues* creates the *Fix a GitHub issue* automation for it, ready to run.
- **Branches view**: a branch button in the Tasks panel (and *All branches…* in a card's branch menu) lists every branch of the project, the ones being worked on first, with the tasks and agent cards on each, its worktree, last commit, commits ahead of and behind the main branch, and whether it is pushed. Switch to a branch or copy its name from there.
- **Automation history**: the automations list shows when each one last ran, and its panel shows the next scheduled run and the last runs with their result and duration.

### Changed
- **Issues** has a cleaner layout: label colors, age, author, comments, assignees and milestone for each issue, a text filter, label filters, *Select all*, a button to read the issue's text and another to open it on GitHub.
- Narrow windows: the toolbar no longer pushes *Settings* off-screen. Below 1500 px the computer name is hidden (it wrapped onto three lines), below 1366 px most toolbar buttons show only their icon, and below 1024 px all of them do. *Usage*, *Skills and Agents* and *Subscriptions* got icons.
- The Tasks panel's *Summary*, *Issues* and *Clear* buttons are icons (with their descriptions on hover), so its toolbar fits on one line.
- With the Tasks panel open on a narrow window, the dock's *Note* and *Group* show only their icon so every agent button stays visible.

### Fixed
- Automations: a new daily schedule (for example the *Nightly tests* template created in the afternoon) no longer runs right away, and turning an automation back on no longer catches up on missed runs.
- Automations: what you type in the side panel, and nodes you drag, are no longer lost when a running automation refreshes the diagram.
- Automations: a *Command* step set to run in the previous task's folder uses the task that leads to it, not one from a parallel branch.
- Automations: deleting a running automation stops it first; skipped steps are no longer passed to agents as context; a stopped run says so; a *Decision* answered "Sí" counts as yes.
- The *Fix a GitHub issue* template accepts only an issue number.
- First launch: the welcome guide has proper margins again (its text and step dots touched the window's edges), keeps a steady height between steps, and starts with *Next* focused.
- The empty board message and the bottom dock are centered on the part of the board the side bars leave visible, like new cards, instead of on the whole window. On narrow boards the minimap sits above the dock instead of overlapping it.
- A card's name no longer shrinks to a few letters next to a long branch name; the branch name is shortened instead.
- The Branches view: an agent card working on a branch shows as a small chip again instead of a broken box over the next branch, and popovers no longer run past the bottom of the window.
- Switching the system between light and dark while the app is starting no longer throws an error.

## [1.8.2] - 2026-10-19

### Fixed
- Windows and Linux: tooltips, the palette, the welcome guide and the empty board show shortcuts with Ctrl (Ctrl+Shift+T) instead of the Mac symbols (⇧⌘T).
- Windows and Linux: the File/Edit/View menu bar no longer sits above the app's own top bar; press Alt to show it.

## [1.8.1] - 2026-10-19

### Fixed
- A task now always runs in the project chosen when it was added. Before, it could run in the project you had open instead: when you opened another project while *Route* was splitting the text, when you wrote a task and then opened another project before adding it, or when a queued task had no folder.

## [1.8.0] - 2026-10-19

### Added
- **Tokens per session**: *Usage* has a *By Session* table with every Claude and Codex session, its subscription (and Claude account), the card or task that ran it, when it was last used, its turns, its tokens (hover for input, cache and output) and the context its last answer had to read. Filter it by subscription and sort it by most recent or most tokens.
- **Token counter on each Claude card**: the header shows the session's tokens so far, updated every 10 seconds. It turns orange when each turn re-reads 150k tokens or more, the point where `/compact` or a new session saves tokens. Click it to open *Usage*.

## [1.7.0] - 2026-10-19

### Added
- **Close a task's terminals**: each task in the Tasks panel has a button that closes its agent card and every subagent it opened, with one confirmation. The new button next to *Clear* does the same for every finished or blocked task.

### Changed
- Task agents and the subagents they open are told to finish in their session and not to start `/goal`, `/loop`, scheduled wakeups or recurring jobs unless the task explicitly asks to repeat something or keep watching. The bundled `agentboard-task` skill says the same; update it from *Skills and Agents → Token Saving*.

### Fixed
- Cards no longer cover the top bar, menus and popovers after you click on them many times.
- The Tasks panel's filter row wraps on narrow panels instead of cutting off its last buttons.

## [1.6.0] - 2026-10-19

### Added
- **Work summaries**: the *Work* button shows what each agent is doing and, for every finished task, the files it changed (lines added and removed), its commits and its branch. Files that were already modified before the task started are flagged as pre-existing.
- **Desktop notifications for tasks**: native notifications when a task starts, is done, is blocked or needs review, and when an agent without a task finishes working. *Settings → General → Notifications* chooses which ones, the sound and whether they only show while AgentBoard is in the background, with a *Test* button. Clicking one brings the window forward on that card.
- **Stop idle agents**: optionally stop agent cards with no task in progress after a number of minutes without activity (*Settings → General*, off by default). Plain terminals are never stopped and *Restart* resumes the session.

### Changed
- Board zoom now goes from 10% to 100%; boards saved with a zoom outside that range are adjusted when opened.

## [1.5.1] - 2026-10-18

### Added
- **Usage at API prices**: an estimate in dollars of what the tokens would cost through the API, in total and per project this month. Prices are $ per million tokens, editable in *Settings → Tasks* (Claude Sonnet's by default). With a subscription you don't pay per token.
- **Activity log**: search it, and *Export CSV* saves it whole. Cells are written so a spreadsheet never runs them as formulas.
- **Command steps** can run in the folder of the previous agent's task, its worktree if it has one. The *Fix a GitHub issue* template now uses this, so its checks test the agent's changes with *Worktree per task* on as well.

### Changed
- The dangerous-request rule for `.env` now flags `.env`, `.env.local`, `.env.production`… but no longer `.env.example` or `process.env` in code. Lists saved by earlier versions are updated when read.
- New README and wiki screenshots of the current interface, taken from the app by `scripts/demo/screenshots.js`.

### Fixed
- The demo agent read model arguments (`-m …`) as its task.

## [1.5.0] - 2026-10-18

### Added
- **Cost by project** (*Usage*): tokens per project today, this week and this month, with the last 30 days as small bars, read from the agents' logs (sessions in a subfolder or a worktree count for their project).
- **Weekly and monthly budgets**, for all projects (*Settings → Tasks*, besides the daily one) and per project (*Settings → Projects*). You get a notice at 80% and at 100% of each, once per period (and, if you turn it on, a message in the daily summary's chat). Past a budget, new tasks there use light models until the period ends. *Usage → Budgets* shows how far along each one is.
- **Automation templates** (*Automations → Templates*, or *New Automation from a Template* in the palette), built for the current project with its check command:
  - fix a GitHub issue → checks → pull request with "Closes #n";
  - nightly tests that fix themselves;
  - review my changes before committing;
  - update dependencies safely;
  - keep the docs up to date;
  - triage open issues.

### Changed
- "Design with AI" and the templates build the flow with the same code (`flowFromSpec`).

## [1.4.0] - 2026-10-18

### Added
- **Settings → Security**:
  - *Dangerous* rules (a built-in list you can edit: `rm -rf`, `git push --force`, `sudo`, `curl … | sh`, `.env`, `.ssh/`…). Matching permission requests are flagged in red, left out of **Approve All**, ask once more before you approve them, and can't be approved from the phone.
  - *Approve automatically* rules, empty by default.
  - The **activity log**: answers (yours, the phone's or a rule's), remote devices, automation commands with the secrets they got, and secrets saved or removed (`audit.log`, readable only by your user).
- **GitHub issues**: issues from people outside the project are flagged and show their text, and ask before being queued. Every issue's text reaches the agent between markers, with the instruction to treat it only as a description.

### Changed
- **Phone remote**: served over **HTTPS** with a certificate made on your computer (its SHA-256 fingerprint is shown in Settings). It turns itself off after 8 hours by default, each new device is announced and logged, and repeated wrong links block the address for a few minutes.
- The daily summary's **webhook URL** is kept encrypted in Secrets; one saved by 1.1–1.3 moves there by itself.
- The window runs in Chromium's **sandbox**.

## [1.3.1] - 2026-10-18

### Fixed
- On Windows, the window resized itself before the board had loaded and the interface logged an error at startup ("Cannot read properties of null").

### Added
- CI opens the real app on macOS and Windows (`npm run test:smoke`): it runs a command in a real terminal and opens every panel.

## [1.3.0] - 2026-10-18

### Added
- **Side bars like VS Code**: the left and right bars are made of views (**Agents**, **Tasks**, **Approvals**, **Queue Options**).
  - Click a title to collapse it.
  - Drag a title to reorder a view or move it to the other side.
  - Hide a view from its **⋯** menu; the bar's **⋯** shows it again or resets the layout.
  - Drag a bar's inner edge to resize it, and the line between two views to share the height.
  - The layout is saved with your board.
- **Approvals view**: the permission requests now also have their own view in the side bar, besides the toolbar popover.
- Palette: *Approvals View* and *Reset Side Bar Layout*.

### Changed
- The task queue options (Run queue, parallel limits, worktrees, which subscriptions "auto" uses) moved to the **Queue Options** view, collapsed by default, leaving more room for the task list.

## [1.2.0] - 2026-10-18

### Added
- **Secrets vault** (*Settings → Secrets*): passwords and API keys for automations, encrypted with the system keychain (macOS Keychain, Windows DPAPI, GNOME Keyring or KWallet). A **Command** step gets a secret as an environment variable when it mentions it (`$APP_PASSWORD`) or lists it under *Secrets it can use*, and the value is hidden in its output. The window can list names but never read values back, and agents never see them. Without a keyring the vault refuses to store anything rather than keep plain text.
- **Linux**: an `AgentBoard-x.y.z.AppImage` in every release. The app offers new versions as a download.
- **Welcome guide** on a new board: which agent CLIs you have (install or sign in from there), your first project, connecting the agents and the token-saving skills, ground rules and a sample task. The palette opens it again (*Welcome Guide*).
- A demo GIF at the top of the README, recorded from the app by `scripts/demo/record-demo.js`.

### Fixed
- A permission request you had already answered came back to the approvals inbox when the agent printed more lines below it.
- A finished task could stay listed as working until something else redrew the Tasks panel.
- `npm run app` on Windows looked for the old installer name and stopped with "Installer not found"; it now also opens the installer directly instead of through `cmd.exe` (CodeQL `js/shell-command-injection-from-environment`).

## [1.1.0] - 2026-10-18

### Added
- **Remote control from your phone**: turn it on in *Settings → Integrations* and open the link on your phone (same Wi-Fi). The page shows your tasks live (status, agent, time, tokens, last line), lets you **approve or reject** what agents ask, and **adds tasks**. Every request needs the random token in the link; **New Link** makes the old one stop working. Off by default.
- **Daily summary to Slack, Discord, Teams or Google Chat**: paste an incoming-webhook URL and pick a time; today's done and pending tasks are sent once a day. **Send Test** sends it now.
- **GitHub issues as tasks**: **Issues** in the Tasks panel lists the open issues of the chosen project (through the `gh` CLI) and queues the ones you pick. The agent gets the issue's text and the pull request says `Closes #n`.
- **Ground rules** (*Settings → Ground Rules*): rules every agent follows, written once (commit as you, explain before deleting files…). They go into each CLI's own instructions file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`, Qwen and OpenCode) in a marked block that leaves the rest of the file alone, so they also apply to agents you open by hand; agents without such a file get them in each task. **Add Suggested Rules** fills in a starting set.

### Changed
- Extension points: provider files can declare `instructions` (their global instructions file), main-process services can have `onReady()` and `onQuit()`, and new Settings sections plug in through `settingsSections` without changing the dialog's code.

## [1.0.1] - 2026-10-18

### Changed
- **The code is organized by area, with a class for each process.** The main process lives in `src/main/` (app, core, shell, terminals, git, agents, library, ai, bridge, updates) and `src/main/index.js` is the only place that builds and wires the services. The interface lives in `src/renderer/` folders (core, board, watchers, tasks, review, settings…), and its styles in seven files loaded in order.
- **Extension points instead of edits**: a new CLI is a file in `agents/providers`, a new tool for agents is a file in `bridge/tools` (the MCP server now asks the app for its tools), updates use a strategy per platform, terminal detections are watchers and post-task steps are pipeline steps. Tests check that each one plugs in without changing the code that uses it.
- Repeated number and time formatting merged into one helper.

## [1.0.0] - 2026-10-18

### Added
- **All subscriptions out**: when every subscription in the queue has hit its usage limit, a screen says *"You have reached your limits. Come back in …"* with the time of the soonest reset, plus one of 20 ideas for the break (a walk, a coffee, the news…). The ideas come from a shuffled deck, so none repeats until all have been shown. Queued tasks start by themselves when a subscription is back.
- A task pinned to a subscription (`@claude`) also moves to another one when that subscription hits its limit (can be turned off). *Settings → Tasks* lists the subscriptions that are out, with **Use Again**.
- **Live cost**: tokens per running task, read from Claude's session logs, under each task and in total in the progress bar; finished tasks keep their count.
- **Budgets**: a token budget per task (warn, or ask the agent to wrap up with the smallest change that works) and a daily budget (past it, new tasks use light models).
- **Smarter routing**: haiku also sees how each subscription did on past tasks, and which agents run free local models.
- **Local models first for light tasks**: mark an agent as *local* in *Settings → Agents* and light tasks go to it first.
- **Appearance**: the terminal's font, cursor shape and blinking, and how many lines each terminal keeps, in the panel instead of the JSON.
- `npm test` runs unit tests for the main-process modules.

### Changed
- Versions: new features now raise the first number (this release is 1.0.0); fixes and small changes raise the last one.
- Settings moved to its own file (`renderer/settings.js`); terminals get their options from one function.

## [0.9.0] - 2026-10-18

### Added
- **Approvals inbox**: when Claude Code, Codex or Gemini asks for permission ("Do you want to proceed?", "Allow execution?"), the request appears under **Approvals** in the toolbar and under its task, with the command or file it is about. Approve or reject from there (or everything at once) without going to each card; you also get a notice and a notification.
- **Review**: a task's full diff, file by file, with line numbers. Click a line to quote it, write what to change and **Send to Agent**: the same agent goes back to work. From the same window, **Merge**, **Create Pull Request** (pushes the branch; uses the GitHub CLI when installed, otherwise opens GitHub) or **Discard**.
- **Checkpoints and undo**: before a task starts (without a worktree), AgentBoard snapshots the project. **Undo** puts it back exactly as it was: files the task created are removed and the ones it changed or deleted come back.
- **Checks after each task**: a command per project (*Settings → Projects*) or a default one (*Settings → Tasks*), such as `npm test`. When the agent says DONE the command runs; if it fails, its output goes back to the same agent (twice by default) before the task is marked blocked.
- **Cross-review** (off by default): another subscription reviews each finished task without editing anything, and approves it or sends the problems back to the first agent.
- **Dependencies**: start a line with `>` to make it wait for the task above. Route also lets haiku mark a task that needs another one's result.
- **Templates** for to-dos you write often, with `<placeholders>`; save your own from the composer.
- An end-to-end test that opens the real app with a fake agent, run in CI on every pull request.

### Changed
- The main process is split into modules with one job each (`config`, `shell-env`, `pty-host`, `git`, `agents`, `library`, `ai`), and duplicated code was removed.
- Tasks remember their Claude session, so the Usage panel counts tokens per task.

## [0.8.0] - 2026-10-18

### Added
- **Live task progress**: a progress bar at the top of Tasks (done, working, subagents, errors, blocked) and, under each running task, how long it has been working, the last line its agent printed and every subagent it opened with its own status. Click a line to jump to that card.
- **Error alerts**: a card that prints an error (`npm ERR!`, `Error:`, `Traceback`, `FAIL`, `command not found`, API or rate-limit errors…) gets a red mark, a notice and a notification if you are in another app. Clicking the card clears it. Turn it off in *Settings → Tasks*.
- **Visible subagents**: when Agent Connection is set up, task agents are told they may split the work with `start_agent`. Each helper opens as a card next to its parent (or in its group), titled `↳ Agent`, linked in the Diagram and listed under its task. *Settings → Tasks* sets whether they may and how many at once (4 by default).
- **Close several cards**: ⌘/Ctrl or Shift + click title bars (or names in the agent list) to select them, then **Close** in the bar that appears. Also in the palette: *Close Cards of Finished Tasks*, *Close Stopped Cards* and *Close All Cards in This View*; and *Close Its Cards* in a group's menu. One confirmation for all of them.

### Fixed
- *Check for Updates* always asks GitHub again instead of using a cached answer, and its "up to date" message shows this copy's version, the latest release and where the running app is, so an old copy left in Downloads is easy to spot.

## [0.7.0] - 2026-10-18

### Added
- **Route** in Tasks (on by default): adding tasks sends what you wrote to Claude's cheapest model (haiku), which splits it into independent tasks and picks a subscription and a light or heavy model for each one; the queue runs them in parallel. Your `@`, `#`, `+`, `!` and `!!` markers always win. Also in *Settings → Tasks*.
- Repository setup: CI workflow, Dependabot for npm and GitHub Actions, issue and pull request templates, contributing guide, code of conduct, security policy and a [wiki](https://github.com/scortes5/agentboard/wiki) published from `wiki/`.
- Releases are published automatically: when a new version in `package.json` reaches `main`, the installers are built and the release and its tag are created, with generated notes.

### Fixed
- Codex, Gemini and other CLIs installed with npm under nvm, fnm or volta showed as not installed when AgentBoard was opened from Finder. The app now reads the PATH your interactive shell sets up (`~/.zshrc`), so detection, Split, automations and headless runs find them.

### Changed
- The Mac install steps describe *Privacy & Security → Open Anyway*: right-click → *Open* no longer works on macOS 15 and later.

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

[Unreleased]: https://github.com/scortes5/agentboard/compare/v1.11.0...HEAD
[1.11.0]: https://github.com/scortes5/agentboard/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/scortes5/agentboard/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/scortes5/agentboard/compare/v1.8.2...v1.9.0
[1.8.2]: https://github.com/scortes5/agentboard/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/scortes5/agentboard/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/scortes5/agentboard/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/scortes5/agentboard/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/scortes5/agentboard/compare/v1.5.1...v1.6.0
[1.0.1]: https://github.com/scortes5/agentboard/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/scortes5/agentboard/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/scortes5/agentboard/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/scortes5/agentboard/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/scortes5/agentboard/compare/v0.6.0...v0.7.0
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
