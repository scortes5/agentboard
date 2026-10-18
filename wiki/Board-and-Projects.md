# Board and Projects

![Board](https://raw.githubusercontent.com/scortes5/agentboard/main/docs/images/board.png)

## Cards

Each card is a **real terminal (PTY)** that opens an agent (or a plain shell) in the project folder. A card shows:

- its status — *working*, *waiting* or *stopped* (estimated from recent output),
- the **git branch** and number of uncommitted changes; click the branch to switch or create one,
- buttons to open the folder, restart, options, focus and close.

The **options menu** (three dots) lets you rename the card, change its agent, project or arguments (e.g. `--model opus`), duplicate it or **Send to…** another agent a piece of the conversation.

Drag the title bar to move, the bottom-right corner to resize, double-click the title to rename.

## Projects (tabs)

The toolbar shows **All** plus one tab per project, with its number of agents and a dot when any is working. Each tab remembers its own view. **Agents in every project keep working while you look at another.** `+` adds a folder; ⌘⌥→ / ⌘⌥← switch tabs, ⌘⌥0 shows all.

## Groups

Frames that gather a team of agents (*Backend*, *Frontend*…). Moving the frame moves its cards. A task written with `#Backend` opens its agent inside that group (creating it if needed). **Arrange** (⇧⌘O) lays everything out while keeping the groups.

## Notes, minimap and agent list

Sticky notes live on the same board; the **minimap** (bottom right) and the **agent list** (⇧⌘A, left) help you move around.

## Background mode and sessions

Closing the window keeps AgentBoard running in the background (menu-bar / tray icon). Quitting with ⌘Q asks for confirmation. When you reopen, each Claude card resumes **its own** conversation (`--resume <id>`), even with several in the same project.
