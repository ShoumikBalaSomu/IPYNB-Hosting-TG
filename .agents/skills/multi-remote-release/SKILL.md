---
name: multi-remote-release
description: Protocol for synchronizing code, tags, and production releases across multiple Git hosting remotes (GitHub, GitLab, Codeberg) without destructive force pushes or secret leakage.
---

# Multi-Remote Release Synchronization Protocol (`multi-remote-release`)

## 1. Overview
TeleBook is built with sovereignty in mind. Code repositories should support multi-homed remotes (e.g., GitHub, GitLab, Codeberg, or private Gitea instances). This skill governs safe, non-destructive synchronization across multiple remotes.

## 2. Pre-Release Verification Protocol

Before synchronizing any commit or release to remote repositories:

### 2.1 Clean Working Tree & Secret Auditing
- Verify that `git status --porcelain` is empty.
- Run automated secret detection across the staging index:
  ```bash
  # Check for uncommitted .env, .dev.vars, credentials, or private keys
  git diff --cached --name-only | grep -E '\.(env|dev\.vars|pem|key)$' && exit 1 || true
  ```
- Ensure no Telegram bot tokens (`[0-9]{8,10}:[a-zA-Z0-9_-]{35}`) exist in staged diffs.

### 2.2 Verification of Tests & Builds
- Run all monorepo typechecks and test suites:
  ```bash
  npm run typecheck
  npm test
  ```
- Ensure zero errors or unhandled warnings before tagging.

## 3. Remote Management Architecture

### 3.1 Remote Topology
Configure standard named remotes:
- `origin`: Primary repository (e.g. GitHub)
- `gitlab`: Secondary mirror (e.g. GitLab)
- `codeberg`: Sovereign mirror (e.g. Codeberg)
- `all`: Umbrella push remote combining all configured endpoints:
  ```bash
  git remote set-url --add --push all git@github.com:owner/telebook.git
  git remote set-url --add --push all git@gitlab.com:owner/telebook.git
  git remote set-url --add --push all git@codeberg.org:owner/telebook.git
  ```

### 3.2 Non-Destructive Push Rules
- **NEVER use `git push --force` or `--force-with-lease`** on release branches (`main`, `master`, `release/*`).
- Always pull and rebase before pushing if a remote has advanced:
  ```bash
  git fetch <remote>
  git merge --ff-only <remote>/main
  ```
- If a divergence occurs across mirrors, investigate and resolve via explicit merge commits or rebase, never by overwriting history.

## 4. Release Tagging & Dispatch
- Use Semantic Versioning (`vMAJOR.MINOR.PATCH`).
- Create annotated or GPG-signed git tags:
  ```bash
  git tag -a v1.0.0 -m "Release v1.0.0: Initial TeleBook zero-knowledge release"
  ```
- Push tags to all remotes:
  ```bash
  git push all --tags
  ```
