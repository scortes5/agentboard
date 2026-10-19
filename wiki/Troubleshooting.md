# Troubleshooting

| Problem | Fix |
|---|---|
| A card says *"Could not start the shell"* | Update AgentBoard to the latest version. From source, run `npm install` again (it fixes node-pty permissions). |
| The app keeps saying a CLI (e.g. Codex) is not installed, but it works in a card | Fixed in 0.7.0: AgentBoard now reads the PATH from your shell's `~/.zshrc` (nvm, fnm, volta). Update, or open Subscriptions again after updating. |
| `command not found` for an agent | The CLI is not installed or not on your `PATH`. See [[Installation]] or *Subscriptions → Install*. |
| Claude says `OAuth token has expired` | Type `/login` in a Claude card and sign in again. |
| macOS says the app "is damaged", "can't be opened" or "could not verify" | *System Settings → Privacy & Security → Open Anyway*, or in the Terminal `xattr -cr /Applications/AgentBoard.app`, then open it again. |
| Windows: agents fail with `cannot be loaded` | In PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or set *Settings → General → Shell* to `cmd.exe`. |
| A task stays in *Needs your review* | The agent finished or asked something. Use *Go to the agent card*. |
| A task never leaves *Queued* | Turn on **Run queue** and check the *Parallel* and per-subscription limits. |
| A new folder blocks on "Do you trust this folder?" | Press **Trust and Continue** in the Tasks panel or answer in the card. |
| Agents cannot see each other | Register the bridge in *Skills and Agents → Agent Connection* and restart the agent's card. |
| Status looks wrong (*working* vs *waiting*) | It is estimated from terminal output; it can lag a few seconds. |
| Scheduled automation did not run | Automations only run while AgentBoard is open (background counts). |

Still stuck? Ask in [Discussions](https://github.com/scortes5/agentboard/discussions) or open a [bug report](https://github.com/scortes5/agentboard/issues/new?template=bug_report.yml).
