# Contributing to AgentBoard

Thanks for wanting to help! Bug reports, ideas, docs fixes and code are all welcome.

## Ways to help

- **Star the repo and tell someone about it.** It is the easiest way to help the project grow.
- **Report a bug** with the [bug template](https://github.com/scortes5/agentboard/issues/new?template=bug_report.yml).
- **Propose a feature** with the [feature template](https://github.com/scortes5/agentboard/issues/new?template=feature_request.yml), or start a thread in [Discussions](https://github.com/scortes5/agentboard/discussions) if it is still an idea.
- **Improve the docs**: the README, [the guide](docs/GUIDE.md) and the [wiki](wiki/) live in this repository, so a pull request is all it takes.
- **Pick an issue** labeled [`good first issue`](https://github.com/scortes5/agentboard/labels/good%20first%20issue) or [`help wanted`](https://github.com/scortes5/agentboard/labels/help%20wanted).

## Development setup

Requirements: Node.js 20+ (22 recommended), git, and on Windows the build tools that `node-pty` needs.

```bash
git clone https://github.com/scortes5/agentboard.git
cd agentboard
npm install     # also fixes node-pty permissions (scripts/fix-pty.js)
npm start       # runs the app in development mode
```

Install at least one agent CLI (`claude`, `codex` or `gemini`) to try real cards; `npm run check` lists which ones are found.

See the [Architecture](wiki/Architecture.md) wiki page for how the code is organized and how to extend it by adding files (a new CLI, bridge tool, watcher or task step).

## Pull requests

1. Create a branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Keep the change focused: one pull request, one topic.
3. Follow the style of the surrounding code: plain JavaScript, no build step, one folder per area, a class for each process with its dependencies passed in, `'use strict'`, short comments explaining *why*. Extend through the extension points instead of editing the code that uses them.
4. Run the same checks as CI:
   ```bash
   git ls-files '*.js' | xargs -n1 node --check
   npm test
   npm run test:e2e        # on Linux without a display: xvfb-run -a npm run test:e2e
   ```
5. Try it with `npm start` on your system and say which one in the pull request.
6. Add a line to `CHANGELOG.md` under **Unreleased** if users will notice the change.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat(tasks): …`, `fix(flows): …`, `docs: …`, `chore(deps): …`.

## Releases

Versions are `MAJOR.MINOR.PATCH`:

| Change | Bump | Example |
|---|---|---|
| A large set of features (a milestone) | **MAJOR** | `1.9.0` → `2.0.0` |
| New features | **MINOR** | `1.4.2` → `1.5.0` |
| Fixes and small changes (docs, tweaks, dependencies) | **PATCH** | `1.4.2` → `1.4.3` |

MAJOR is decided by the maintainer once enough features have piled up. Maintainers bump `version` in `package.json` (and `VERSION` in `scripts/agentboard-mcp.js`) and move the *Unreleased* changelog entries under the new version. When that change reaches `main`, the `build` workflow sees a version without a tag, builds the macOS and Windows installers and publishes the GitHub Release with its `v<version>` tag.

## Code of conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
