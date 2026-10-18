# Subscriptions and Accounts

Open the **Subscriptions** button.

## Supported CLIs

Claude Code, Codex, Gemini CLI, Copilot CLI, Cursor CLI, Qwen Code, OpenCode, Aider and Amp. The panel shows which are installed and signed in, and offers *Install* and *Sign In* buttons. Any other CLI can be added as a **custom agent** in *Settings → Agents*.

## Several Claude accounts

If you have more than one plan (e.g. personal and work), add each account. Each one gets its own config folder (`~/.claude-<name>`) with its login, history and skills, and the task queue spreads work across them. When one hits its usage limit, tasks move to another until it resets.

## Local models

AgentBoard detects [Ollama](https://ollama.com) and [LM Studio](https://lmstudio.ai) and opens their models as a chat, with Codex or with Aider.

## Are my sessions closed when I quit?

No. Each CLI keeps its login where it always does (macOS Keychain, `~/.codex`, `~/.gemini`…). AgentBoard only checks that it exists; it never reads, copies or sends credentials.
