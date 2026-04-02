---
description: Automate a release from development to main with changelog, version bump, squash merge, and publish
allowed-tools: Bash, Read, Edit, Write, AskUserQuestion
---

You are performing a release for the vscode-vibrancy-continued extension. The user may optionally provide a version bump type as an argument: $ARGUMENTS (defaults to "minor" if empty or not one of: major, minor, patch).

Follow these steps exactly, stopping on any error:

## 1. Ensure clean working tree

Run `git status --porcelain`. If there are uncommitted changes, stop and tell the user to commit or stash first.

## 2. Pull latest for both branches

```
git checkout main && git pull origin main
git checkout development && git pull origin development
```

## 3. Determine commits to release

Run `git log main..development --oneline --no-merges` to get the list of commits in development that are not yet in main. Show this list to the user. If there are no commits, stop — nothing to release.

## 4. Bump version

Determine the bump type from $ARGUMENTS (default: minor). Run:

```
npm version <bump_type> --no-git-tag-version
```

Read the new version from package.json after bumping.

## 5. Update CHANGELOG.md

Read the current CHANGELOG.md. Prepend a new section at the very top of the file with the format:

```
# <new_version>

* Category:
  * Change summary
```

Categorize changes using the same categories seen in the existing changelog (Core, Themes, Tests, Contributors, etc.). Summarize each commit concisely — do not just paste the raw commit message. Group related commits under one bullet where appropriate. Reference PR numbers with markdown links in the format `(PR [#NNN](https://github.com/illixion/vscode-vibrancy-continued/pull/NNN))` when the commit message contains a PR reference.

Show the user the draft changelog entry and ask them to confirm or request edits before proceeding.

## 6. Commit the version bump and changelog

Stage `package.json`, `package-lock.json` (if changed), and `CHANGELOG.md`, then commit:

```
git add package.json package-lock.json CHANGELOG.md
git commit -m "<new_version>"
```

Do NOT include a Co-Authored-By trailer.

## 7. Switch to main and squash merge

```
git checkout main
git merge --squash development
git commit -m "<new_version>"
```

Do NOT include a Co-Authored-By trailer.

## 8. Verify GitHub CLI auth

Run `gh auth status` and check that the authenticated account is **illixion**. If not, stop and tell the user to authenticate as illixion first (`gh auth login`).

## 9. Push both branches

```
git push origin main
git push origin development
```

## 10. Trigger the publish workflow

Ask the user whether this should be a pre-release. Then run:

```
gh workflow run publish.yml --ref main -f prerelease=<true|false> -f package_only=false
```

Confirm to the user that the workflow has been triggered and provide a link: `https://github.com/illixion/vscode-vibrancy-continued/actions/workflows/publish.yml`
