# FAQ

**Is AgentBoard free?**
Yes, MIT-licensed and open source. You only pay for the agent subscriptions you already use.

**Does it need API keys?**
No. It runs the CLIs you have installed with the session you already signed in to.

**Does it send my code anywhere?**
AgentBoard itself sends nothing. Your code is read by the agents you open, as it would be in a normal terminal.

**Can I use only Claude?**
Yes. Everything works with a single subscription; the others are optional.

**Do agents keep working if I close the window?**
Yes. The app stays in the background. They only stop when you quit (⌘Q or the tray icon).

**Do I lose my conversations when I restart?**
No. Each Claude card resumes its own session.

**How do several agents work on the same repo without conflicts?**
Turn on **Worktree per task**: each task gets its own branch and working copy; you merge or discard it at the end.

**Linux?**
Not officially packaged yet. `npm start` may work from source; reports and pull requests are welcome.

**How is this different from running agents in tmux or several terminal tabs?**
You get the terminals plus a task queue spread across subscriptions, usage-limit failover, per-task worktrees with review/merge, a project/group overview, automations, and an MCP bridge so agents can coordinate.
