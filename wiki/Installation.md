# Installation

## Option 1: installer (recommended)

Download from [Releases](https://github.com/scortes5/agentboard/releases/latest):

| System | File |
|---|---|
| Mac with Apple Silicon (M1–M4) | `AgentBoard-x.y.z-arm64.dmg` |
| Mac with Intel | `AgentBoard-x.y.z.dmg` |
| Windows (x64) | `AgentBoard.Setup.x.y.z.exe` |

- **Mac**: open the `.dmg` and drag AgentBoard into *Applications*.
- **Windows**: run the `.exe` and follow the installer (you can pick the folder).

### First launch of an unsigned app

The app is not signed with an Apple or Microsoft certificate. That does not mean it is dangerous; the source is all here.

- **Mac**: open AgentBoard once, press *Done* in the warning, then go to **System Settings → Privacy & Security**, scroll to *Security* and press **Open Anyway**. Or, in Terminal: `xattr -cr /Applications/AgentBoard.app`. Never choose *Move to Trash*. Each version installed from a `.dmg` asks once.
- **Windows**: in the SmartScreen warning, *More info* → *Run anyway*.

## Option 2: from source

Requirements: [Node.js 20+](https://nodejs.org) and [git](https://git-scm.com).

```bash
git clone https://github.com/scortes5/agentboard.git
cd agentboard
npm install
npm run app     # builds and installs it (Applications on Mac, installer on Windows)
# or
npm start       # run without installing
```

## Install at least one agent

AgentBoard runs the CLIs you already have. Install one and sign in once:

```bash
npm i -g @anthropic-ai/claude-code   # then: claude   (Claude Pro or Max)
npm i -g @openai/codex               # then: codex    (ChatGPT Plus or Pro)
npm i -g @google/gemini-cli          # then: gemini   (Google account)
```

Also supported: Copilot CLI, Cursor CLI, Qwen Code, OpenCode, Aider, Amp, and local models through Ollama or LM Studio. `npm run check` (from source) lists what is found. You can also install and sign in from the **Subscriptions** button inside the app.

## Updating

Download the new installer and install it over the old one. Your board, tasks and settings live outside the app (see [[Privacy and Security]]) and are kept.

Next: [[Quick Start]]
