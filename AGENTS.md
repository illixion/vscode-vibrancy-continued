# Agent & contributor guide

This file is read by AI coding assistants (Cursor, GitHub Copilot, Codex, Aider,
Claude Code, and similar) and by human contributors. Follow it when opening pull
requests against this repository.

## ⚠️ Pull requests MUST target the `development` branch — never `main`

`main` is the **release branch**. It only receives changes through the
maintainer's release process. **Do not open a pull request against `main`.**

- Base branch for every PR: **`development`**
- A PR opened against `main` will be asked to re-target or closed.

If your tool defaulted the base branch to `main`, change it to `development`
before opening the PR. On GitHub the base branch is the left-hand dropdown in
the "Open a pull request" / "Comparing changes" view.

## Branches

- `main` — release branch. Protected. Do not target with PRs.
- `development` — active development branch. **Target this with all PRs.**

## How to contribute

1. Fork the repository.
2. Create your feature branch off `development`
   (`git checkout development && git checkout -b feature/AmazingFeature`).
3. Commit your changes.
4. Push to your fork.
5. Open a pull request **with `development` as the base branch**.

## Project notes

- This is a VSCode extension — no build step is required.
- After changes, run the unit/integration tests: `npm install && npm test`
  (runs `vitest run`).
- Do **not** run the E2E suite (`npm run test:e2e`) locally; it needs
  platform-specific setup and is handled by CI.
- The extension modifies VSCode's own installation files, so test with care.
