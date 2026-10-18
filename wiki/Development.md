# Development

```bash
git clone https://github.com/scortes5/agentboard.git
cd agentboard
npm install        # dependencies + node-pty permission fix
npm start          # run in development mode
npm run check      # which agent CLIs are installed
npm run app        # build and install the app
npm run dist:mac   # .dmg files      ·  npm run dist:win  → .exe
npm run icon       # regenerate icons from src/assets/logo.svg
npm run test:e2e   # open the real app and drive a task with a fake agent
```

## Checks

CI (`.github/workflows/ci.yml`) runs on every push and pull request:

```bash
npm ci --ignore-scripts
git ls-files '*.js' | xargs -n1 node --check
```

The `e2e` job opens the real app under `xvfb` and runs `test/e2e.js` (see [[Architecture]] → Tests).

CodeQL code scanning (GitHub default setup) analyzes JavaScript and workflows on every push and pull request. Dependabot opens weekly update PRs for npm packages and GitHub Actions.

## Releasing

1. Bump `version` in `package.json` (and `VERSION` in `scripts/agentboard-mcp.js`).
2. Move *Unreleased* entries in `CHANGELOG.md` under the new version.
3. Merge to `main`. The `build` workflow notices that `vX.Y.Z` has no tag yet, builds the macOS and Windows installers and publishes the Release (creating the tag) with generated notes.

Pushes to `main` that keep the same version do not build anything. Pushing a `v*` tag by hand still works.

## Editing this wiki

Pages live in [`wiki/`](https://github.com/scortes5/agentboard/tree/main/wiki). The `wiki` workflow publishes them to the GitHub Wiki on every push to `main`. File names become page titles (`Quick-Start.md` → *Quick Start*); link between pages with `[[Page Name]]`.

See also: [CONTRIBUTING.md](https://github.com/scortes5/agentboard/blob/main/CONTRIBUTING.md) · [[Architecture]]
