# Getting started with AgentBoard

This guide is for someone who has never used AgentBoard or AI coding agents. It goes step by step and explains each idea the first time it comes up. It takes about 20 minutes.

**Contents**

1. [What AgentBoard is](#1-what-agentboard-is)
2. [Basic concepts](#2-basic-concepts)
3. [Before you start](#3-before-you-start)
4. [Install AgentBoard](#4-install-agentboard)
5. [Install your first agent](#5-install-your-first-agent)
6. [Open the app for the first time](#6-open-the-app-for-the-first-time)
7. [Your first agent on the board](#7-your-first-agent-on-the-board)
8. [Give it work with Tasks](#8-give-it-work-with-tasks)
9. [Organize the work: groups and projects](#9-organize-the-work-groups-and-projects)
10. [See everything at a glance: the Diagram](#10-see-everything-at-a-glance-the-diagram)
11. [Automate: your first flow](#11-automate-your-first-flow)
12. [Customize the app](#12-customize-the-app)
13. [Look after your tokens](#13-look-after-your-tokens)
14. [Frequently asked questions](#14-frequently-asked-questions)
15. [If something does not work](#15-if-something-does-not-work)
16. [Glossary](#16-glossary)

---

## 1. What AgentBoard is

There are AI assistants that can **work directly on your code**: they read your files, propose changes, apply them and run tests. They are called *coding agents*. The best known are **Claude Code** (by Anthropic), **Codex** (by OpenAI) and **Gemini CLI** (by Google).

Each one runs inside a *terminal*, the text window where you type commands. If you use several at once, you end up with lots of messy windows and no idea what each one is doing.

**AgentBoard puts that in order.** It is an app where each agent lives on a card on a board. From one place you can:

- see all your agents working at the same time,
- write a to-do list and have it spread across them,
- separate the work by project and by team,
- and build automations, for example "every morning, review the code and tell me if something fails".

![The board](images/board.png)

---

## 2. Basic concepts

| Concept | What it is, simply put |
|---|---|
| **Agent** | An AI assistant that works on your code. In AgentBoard each agent takes up one card. |
| **Subscription** | Your paid or free plan with an AI provider (for example Claude Pro). Agents run on your subscription. |
| **Terminal** | A text window where you type commands. Each card is a real terminal. |
| **Project** | A folder on your computer with the code you work on. In AgentBoard each project is a tab at the top. |
| **Task** | A to-do you write ("fix the payment button") that an agent carries out. |
| **Group** | A frame on the board that gathers several agents working on the same thing. |
| **Automation** | A sequence of steps that runs by itself, drawn as a diagram. |
| **Token** | The unit that measures how much text the AI processes. Your subscription has a usage limit; spending fewer tokens lets you do more. |

You do not need more than this to start. There is a [glossary](#16-glossary) at the end with other terms.

---

## 3. Before you start

You need:

1. **A computer** with macOS or Windows.
2. **A subscription to at least one agent.** The most common is **Claude Pro** or **Claude Max** (at [claude.ai](https://claude.ai)). One is enough.
3. **Node.js**, a program used to install the agents. Download it from [nodejs.org](https://nodejs.org) (the "LTS" version) and install it like any other program.
4. **Git** (recommended), so AgentBoard can show the changes to your code. It comes with the Mac; on Windows download it from [git-scm.com](https://git-scm.com).

> **How do I open the Terminal?** On Mac: press ⌘ + Space, type *Terminal* and press Enter. On Windows: Start menu, type *PowerShell* and press Enter. You only need it to install the first agent.

---

## 4. Install AgentBoard

1. Go to the [downloads page](https://github.com/scortes5/agentboard/releases/latest).
2. Download the file for your computer:
   - **Mac with an Apple chip (M1, M2, M3, M4)**: the one ending in `arm64.dmg`.
   - **Mac with Intel**: the `.dmg` without `arm64`. (To check which one you have: Apple menu → *About This Mac*.)
   - **Windows**: the `.exe`.
3. **Mac**: open the `.dmg` and drag AgentBoard into the *Applications* folder.
   **Windows**: open the `.exe` and follow the installer.
4. The first time, the system warns that the app is not signed (no Apple or Microsoft certificate was bought; it does not mean it is dangerous):
   - **Mac**: open AgentBoard; when macOS says it could not verify it, press *Done* (not *Move to Trash*). Open **System Settings → Privacy & Security**, scroll down to *Security* and press **Open Anyway**, then **Open Anyway** again.
   - **Windows**: in the blue warning, *More info* → *Run anyway*.

From then on you open it like any app: Launchpad, Spotlight (⌘ + Space → *AgentBoard*) or the Start menu. You can keep it in the Dock.

**New versions.** You don't need to come back to this page. When there is a new version, AgentBoard shows a notice in the top-right corner:
- **Windows**: it has already downloaded it; click **Restart to Update**.
- **Mac**: click **Download**, open the file and drag AgentBoard to *Applications* again (choose *Replace*). Your board, projects and settings stay as they were.

---

## 5. Install your first agent

You only do this once. Open the Terminal and type:

```bash
npm i -g @anthropic-ai/claude-code
```

Wait for it to finish. Then type:

```bash
claude
```

The first time, Claude asks you to **sign in**: the browser opens, you sign in with your Claude account and go back to the Terminal. Done; you can close the Terminal. AgentBoard will use this session.

> For Codex or Gemini it works the same way: `npm i -g @openai/codex` and then `codex`; `npm i -g @google/gemini-cli` and then `gemini`.

You can also do it from AgentBoard: **Subscriptions** button → *Install* or *Sign In* next to each agent.

---

## 6. Open the app for the first time

This is what you see:

| Area | What it is for |
|---|---|
| **Top bar** | Project tabs, and the Tasks, Search, Automations, Diagram, Skills and Agents, Subscriptions and Settings buttons. |
| **Agent list** (left) | All your agents, grouped by project. A click takes you to its card. |
| **Board** (center) | Where the cards live. Drag the background to move around; ⌘ + mouse wheel to zoom in or out. |
| **Bottom bar** | Buttons to open a new agent (Claude, Codex…), a note or a group, and to arrange the board. |
| **Minimap** (bottom right) | A small view of the board to move around quickly. |

> **Tip:** if you do not know what a button does, hold the pointer over it for 2 seconds and an explanation appears.

**Add your project.** Press `+` next to the tabs at the top and pick the folder with your code. It shows up as a new tab.

---

## 7. Your first agent on the board

1. With your project selected at the top, press **Claude** in the bottom bar (or ⇧⌘1).
2. A card appears and Claude opens inside it. The first time in a folder, Claude asks whether you **trust it**; choose *Yes, I trust this folder* with the arrow keys and Enter.
3. Write what you need in plain language, as you would to a person. For example:
   *"Explain what this project does and which files matter most."*
4. While it works, the card's dot **pulses** (*working*). When it finishes it turns green (*waiting*). If you are not looking, you get a notification.

You can open several agents at once, in the same project or in others. Each one works on its own.

**Card basics:**
- Drag the title bar to move it; the bottom-right corner resizes it.
- Double-click the title to rename it.
- The buttons on the right: open the folder, restart the agent, options, focus and close.

---

## 8. Give it work with Tasks

Writing to each agent works, but when you have several to-dos the **Tasks** panel is easier (*Tasks* button or ⇧⌘T).

![Tasks panel](images/tasks.png)

1. Write your to-dos in the box at the bottom, **one per line**:
   ```
   add validation to the payment form
   write tests for the shopping cart
   review the README and fix broken links !
   ```
2. Press **Add** (or Enter).
3. Turn on **Run queue**. AgentBoard opens one agent per task, several at once (up to the *Parallel* number), and hands each one its to-do.
4. Each task updates its own status:
   - **Queued**: waiting for its turn.
   - **Working**: an agent is on it.
   - **Needs your review**: the agent finished or asked you something. Use *Go to the agent card* to see it.
   - **Done**: finished, with a one-line summary.

**Shortcuts inside the text** (optional):
- `!` at the end = a simple task, uses a cheaper model.
- `!!` = a hard task, uses the most capable model.
- `@claude` = have that specific subscription do it.
- `#name` = open the agent inside that board group.

**What did each agent change?** The **Work** button lists the tasks in progress and, for each finished one, the files it touched (with lines added and removed), the commits it made and its branch. Files that already had changes before the task started are marked *pre-existing*.

> **Not sure how to split the work?** With **Route** on (the default), just write everything, even in one paragraph, and press **Add**: Claude's cheapest model breaks it into tasks, picks who does each one and they run in parallel.

---

## 9. Organize the work: groups and projects

**Projects (tabs at the top).** If you work on several projects, each one has its tab. Switching tabs shows only that project's agents, but **the others keep working**. The number on each tab is how many agents it has, and a blue dot means one of them is working. *All* shows the whole board.

**Groups (frames on the board).** Inside a project you can separate teams: press **Group** in the bottom bar, name it (double-click the title) and drag cards into it. Moving the group moves its cards. If you write a task with `#Backend`, its agent opens inside the *Backend* group.

**Arrange.** The grid button in the bottom bar lays out all the cards at once, keeping the groups.

---

## 10. See everything at a glance: the Diagram

The **Diagram** button (⇧⌘D) shows a tidy summary: each project with its groups, and in each group its agents with their task, status, the code branch they work on and the last thing they wrote. It tells you where everything stands without checking card by card.

![Diagram](images/diagram.png)

Clicking any agent takes you to its card. *Back to Board* (or Esc) closes the diagram.

---

## 11. Automate: your first flow

An **automation** is a recipe of steps that runs by itself. It is drawn as a diagram: each box is a step and the arrows show the order.

![Automations](images/automations.png)

**The easiest way: ask the AI for it.**

1. Open **Automations** (⇧⌘F).
2. Press **Design with AI**.
3. Describe what you want in your own words, for example:
   *"Every day at 9: one agent reviews the code and proposes 3 improvements; another implements them; the tests run; if they pass, notify me, and if not, have an agent fix it."*
4. Claude draws the flow. Check it: click each box to see or change what it does.
5. Press **Explain Run** and the AI tells you what will happen step by step, what could fail and how to improve it.
6. Press **Run** to try it now. Each step lights up while it runs.

**Step types:**

| Step | What for |
|---|---|
| **Trigger** | When it starts: by hand, every so often or every day at a set time. |
| **Agent** | An agent does a piece of work you describe. |
| **Command** | Runs a command, for example the tests. |
| **Decision** | The AI answers yes or no to a question, and the flow follows that path. |
| **Notify** | Sends you a notification. |
| **Concept** | A note or idea on the diagram; it does nothing, it is there to think with. |

**By hand:** use the buttons at the top to add steps and connect them by dragging from the circle on the right of one step onto another.

> Scheduled automations run while AgentBoard is open, even with the window closed (the app keeps running in the background).

---

## 12. Customize the app

Open **Settings** with the gear button (or ⌘,).

![Settings](images/settings.png)

- **Appearance**: light or dark mode, accent color, text and terminal size. Changes show immediately; press *Save* to keep them.
- **Shortcuts**: click a shortcut and press the combination you prefer.
- **General**: whether the app keeps running in the background when you close the window, and the shortcut to add tasks from anywhere (⌃⌥Space by default).
  - *Stop idle agents after*: agent cards with no task in progress stop after that many minutes without input or output (0, the default, never stops them). Plain terminals are never stopped, and *Restart* on the card resumes the session.
  - *Notifications*: desktop notifications when a task starts, is done, is blocked or needs your review, and when an agent without a task finishes working. Choose which ones, whether they play a sound and whether they only appear while AgentBoard is in the background. *Test* shows one right away; on macOS, allow notifications for AgentBoard in System Settings first.
- **Tasks**: how many tasks run at once.
- **Advanced**: for experienced users, every setting as JSON.

---

## 13. Look after your tokens

Your subscription has a usage limit. These habits make it go further:

1. **Install the token-saving skills**: *Skills and Agents* → *Token Saving* tab → *Install or Update in All*. They teach the agents to read only what is needed and to answer briefly.
2. **One task, one concrete to-do.** "Add validation to the email field of the payment form" costs less than "improve the form".
3. **Use `!` for simple tasks** (text, renaming, questions): they use a cheaper model.
4. **Prefer Tasks over long conversations**: each task starts with a clean memory.
5. **If you have two Claude accounts**, add them under *Subscriptions*: the queue spreads work across both and, if one hits its limit, carries on with the other.

---

## 14. Frequently asked questions

**Are my sessions closed when I close the app?**
No. Each agent keeps its session on your computer. When you open AgentBoard again, each card resumes its conversation.

**Do the agents keep working if I close the window?**
Yes. The app stays in the background (menu bar icon). They only stop if you quit with ⌘Q or from that icon.

**Does AgentBoard see my passwords or my code?**
It sends nothing to any server of its own. Your code is read by the agents you open, just as if you used them in the Terminal.

**Do I need to pay for anything else?**
No. AgentBoard is free and open source (MIT license). You only use your agent subscriptions.

**Can I use it with Claude only?**
Yes. Everything works with a single subscription. The others are optional.

**What is the "Do you trust this folder?" question?**
It is a Claude safety check the first time it opens a folder. If the project is yours, answer yes. In the Tasks panel, the *Trust and Continue* button answers it without going to the card.

---

## 15. If something does not work

| Problem | Fix |
|---|---|
| A card says *"Could not start the shell"* | Update AgentBoard to the latest version. |
| The agent says the command is not found (`command not found`) | The agent is not installed. See step 5 or *Subscriptions → Install*. |
| Claude says the session expired (`OAuth token has expired`) | Type `/login` in a Claude card and sign in again. |
| The Mac says the app "is damaged", "can't be opened" or "could not verify" | In the Terminal: *System Settings → Privacy & Security → Open Anyway*, or in the Terminal `xattr -cr /Applications/AgentBoard.app`, then open it again. |
| A task is stuck in *Needs your review* | The agent finished or asked you something. Use *Go to the agent card* to see what it needs. |
| Windows will not run the agents (`cannot be loaded`) | In PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or in *Settings → General → Shell* type `cmd.exe`. |

Another problem? Open a report in [Issues](https://github.com/scortes5/agentboard/issues).

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **CLI** | A program used from the terminal (Claude Code, Codex and Gemini are CLIs). |
| **Git** | A system that keeps the history of changes to your code. |
| **Branch** | A separate line of work in git, for making changes without touching the main version. |
| **Commit** | A saved point in git's history, with a description of what changed. |
| **Worktree** | An extra working copy of the project, on its own branch. AgentBoard can give one to each task so agents do not step on each other. |
| **Merge** | Bringing one branch's changes into another. |
| **MCP** | A standard that lets agents use external tools. AgentBoard uses it so your agents can talk to each other. |
| **Skill** | A file of instructions an agent consults to do a certain kind of work better. |
| **Model** | The AI "version" the agent uses. Some are faster and cheaper (haiku), others more capable (opus). |
| **Session** | A conversation with an agent. Each task opens a new session. |
