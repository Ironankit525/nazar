<div align="center">

<img src="docs/assets/logo.svg" width="96" alt="Nazar logo" />

# BharatCode X Nazar 👁️

**Free AI code review for every Indian developer.**
One YAML file. Zero dollars. Powered by [BharatCode](https://bharatcode.ai).

[![CI](https://github.com/Ironankit525/nazar/actions/workflows/ci.yml/badge.svg)](https://github.com/Ironankit525/nazar/actions/workflows/ci.yml)
[![Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-Nazar-orange?logo=github)](https://github.com/marketplace/actions/nazar-ai-code-review)
[![npm](https://img.shields.io/npm/v/nazar-review?color=orange)](https://www.npmjs.com/package/nazar-review)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Powered by BharatCode](https://img.shields.io/badge/powered%20by-BharatCode-ff6b1a)](https://bharatcode.ai)

</div>

<!-- TODO: record docs/assets/demo.gif (see docs/demo.md) and uncomment:
<p align="center"><img src="docs/assets/demo.gif" alt="Nazar reviewing a pull request" width="760" /></p>
-->

**👉 See it live:** [demo pull requests in nazar-playground](https://github.com/Ironankit525/nazar-playground/pulls): SQL injection, a leaked key, a missing `await`, a Hinglish review, and a clean refactor that gets zero comments.

*Nazar* (नज़र) means "a watchful eye". It reads every pull request and push, catches real bugs and security holes, and suggests fixes you can apply in one click. It also stops you from leaking API keys.

AI code reviewers usually cost $15–30 a month per developer, which leaves out most students and indie developers in India. Nazar runs on BharatCode's flat-rate API, which is **free for students**, and you can host it yourself as a GitHub Action. There's no server and no subscription, and your code only goes to BharatCode.

## ✨ What it does

| | |
|---|---|
| 🐛 **Finds real bugs** | Logic errors, missing `await`, null access, off-by-one, broken error handling: problems that hurt users. It doesn't nitpick style. |
| 🔐 **Catches security holes** | SQL/command injection, path traversal, XSS, auth mistakes, unsafe defaults. |
| 🔑 **Stops leaked secrets** | A fast regex + entropy scanner (no AI, no hallucinations) for GitHub, OpenAI, Google, AWS, Razorpay, Stripe and Telegram keys, private keys, DB passwords and committed `.env` files. To silence a known false positive, add `nazar:allow` on that line. |
| ✅ **One-click fixes** | Comments include GitHub `suggestion` blocks: click **Commit suggestion** and you're done. |
| 🧠 **Two-pass review** | A second "verifier" pass checks every finding and drops false positives before you see them. Flat-rate pricing is what makes the extra pass free. |
| 📝 **PR summary** | A short overview, a risk level, and a per-file walkthrough, kept in one comment that updates instead of spamming. |
| ⚡ **Push mode** | Most students push straight to `main`. Nazar reviews those pushes too, with a commit comment and a job summary. |
| 🇮🇳 **Hinglish mode** | `language: hinglish` → *"Yahan user input seedha SQL query mein ja raha hai, isse SQL injection ho sakta hai."* |
| 💬 **Ask it** | Comment `@nazar explain` on a PR for a plain-language walkthrough, or `@nazar review` to re-run. |
| 🏁 **Build League ready** | Warns if `BharatCode.txt` is missing. `npx nazar-review check` tests whether your repo is ready to submit. |

## 🚀 Install in 2 minutes

**1. Get a BharatCode API key.** It's free for students: sign in at [bharatcode.ai](https://bharatcode.ai/account).

**2. Add it as a repository secret** named `BHARATCODE_API_KEY`:
```bash
gh secret set BHARATCODE_API_KEY        # or: Settings → Secrets and variables → Actions
```

**3. Add the workflow.** Either run `npx nazar-review init` in your repo, or create `.github/workflows/nazar.yml`:

```yaml
name: Nazar Review

on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  push:
    branches: [main, master]
  issue_comment:
    types: [created]

permissions:
  contents: write # commit comments for push reviews
  pull-requests: write # PR review comments
  issues: write # replies to @nazar commands

concurrency:
  group: nazar-${{ github.event_name == 'issue_comment' && format('comment-{0}', github.event.comment.id) || github.event.pull_request.number || github.sha }}
  cancel-in-progress: true

jobs:
  review:
    if: github.event_name != 'issue_comment' || (github.event.issue.pull_request && startsWith(github.event.comment.body, '@nazar'))
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: Ironankit525/nazar@v1
        with:
          bharatcode-api-key: ${{ secrets.BHARATCODE_API_KEY }}
```

Commit, push, and open a pull request. 🎉

> No `actions/checkout` step is needed: Nazar reads everything through the GitHub API, which keeps it fast.

## 💻 CLI: review before you push

```bash
export BHARATCODE_API_KEY=...            # same key
npx nazar-review                          # review uncommitted changes (or commits since main)
npx nazar-review --staged                 # only staged changes
npx nazar-review --base main --lang hinglish
npx nazar-review explain                  # plain-language walkthrough of your changes
npx nazar-review check --history          # Build League readiness + secrets in git history
npx nazar-review init --hook              # add the Action + a pre-push hook that blocks critical issues
```

`review` exits with code `1` when it finds critical issues (`--fail-on high|medium|low|none` to change), so it works as a git hook or in scripts. Add `--json` for machine-readable output.

## ⚙️ Configuration

Optional. Create `.github/nazar.yml`:

```yaml
language: en            # en | hinglish
max_comments: 10        # max inline comments per review
min_severity: medium    # low | medium | high | critical
focus: [security, bugs] # extra attention areas
ignore:                 # glob patterns to skip (lockfiles, dist/, *.min.js etc. are skipped already)
  - "docs/**"
instructions: |         # project context for the reviewer
  This is a Flask app using SQLAlchemy. Never use raw SQL strings.
verify: true            # second-pass verifier
summary: true           # PR summary + walkthrough
hackathon_checks: true  # BharatCode.txt / README checks
incremental: true       # on new commits, review only what changed since the last review
skip_drafts: true
```

Action inputs (`language`, `max-comments`, `min-severity`, `verify`, `ignore`, `model`…) override the file. The full reference is in [docs/configuration.md](docs/configuration.md).

| Action input | Default | |
|---|---|---|
| `bharatcode-api-key` | — | Without it, only secret/repo checks run (useful for fork PRs) |
| `fail-on` | `none` | Fail the job at or above `low`/`medium`/`high`/`critical` |
| `mode` | `auto` | `pr` / `push` to force a mode |
| `model` | `qwen-3.8-27b` | Any model id from BharatCode's `/models` |

Outputs: `findings-count`, `critical-count`, `ai-status`.

## 🏗️ How it works

```
 PR / push / @nazar ──► collect diff (GitHub API) ──► filter (lockfiles, generated, binaries, size caps)
                                                         │
                         ┌───────────────────────────────┴──────────────────────────┐
                         ▼                                                          ▼
              Deterministic checks                                  AI review on BharatCode
              • secret scanner (regex+entropy)                      • number every diff line (L41 + code)
              • .env / node_modules committed                       • pack files into token-budgeted chunks
              • BharatCode.txt / README                             • pass 1: reviewer → JSON findings
                         │                                          • pass 2: verifier drops false positives
                         │                                          • summary + walkthrough
                         └──────────────────┬───────────────────────────────────────┘
                                            ▼
              validate (line really in the diff? suggestion sane?) → dedupe → rank → cap
                                            ▼
              one PR review with inline comments + suggestion blocks, sticky summary comment,
              commit comment (push mode), job summary, outputs, optional fail-on
```

How a small, free model gets trustworthy reviews:
- **Numbered diff lines.** The model cites `L41`, and Nazar throws away any finding on a line that isn't in the diff. Those are hallucinations, and GitHub would reject them anyway.
- **Strict JSON schema output**, validated with zod and repaired with `jsonrepair` when needed.
- **A verifier pass** that has to explicitly approve each finding.
- **No style nitpicks.** The prompt only allows bugs, security, performance and error-handling issues, and the result is capped at `max_comments`.
- **It holds up when BharatCode is busy.** `503` responses are retried with exponential backoff and jitter, there's a time budget, and partial failures still post what was found. If AI is unavailable, secret and repo checks still run and your CI never breaks because of Nazar.

The code is in [`src/core`](src/core) (pure logic, no GitHub dependency), [`src/action`](src/action) and [`src/cli`](src/cli). More detail: [docs/architecture.md](docs/architecture.md).

## 📊 Accuracy

Nazar ships with an eval suite of realistic buggy and clean diffs ([`evals/cases`](evals/cases)): SQL and command injection, path traversal, missing `await`, off-by-one, null access, React state mutation, swallowed payment errors, plus clean code that should get **zero** comments.

```bash
BHARATCODE_API_KEY=... npm run eval            # precision / recall / noise on clean code
BHARATCODE_API_KEY=... npm run eval -- --no-verify
```

Latest run (`qwen-3.8-27b` on BharatCode, verifier on, 29 Oct 2026):

| Planted bugs caught | False positives | Comments on clean code | Extra real issues found |
|---|---|---|---|
| **9 / 9 (100%)**, all on the right line | **0** | **0** | 2 |

The 2 extras weren't in the answer key but are genuine: an unhandled rejection in an Express 4 async route, and a division by zero on an empty list. A typical review takes about 30–90 seconds, depending on BharatCode's queue. This is a single run, so re-run it yourself to check.

## 🔒 Security & privacy

- Diffs are sent **only to BharatCode** (`https://bharatcode.ai/api/model/v1`), using **your** key. Nazar has no server and collects no telemetry.
- Nazar **never checks out or runs** PR code. Model output only ever becomes comment text, with `@mentions`, HTML and comment markers neutralised.
- Detected secrets are always **masked** (`ghp_…6789`) in comments and logs, and the API key is masked in Action logs.
- Fork PRs: on `pull_request`, secrets aren't available, so Nazar runs secret/repo checks only. See [SECURITY.md](SECURITY.md) before using `pull_request_target`.

## 🗺️ Roadmap

- [ ] `@nazar fix` → push a commit applying a suggestion
- [ ] GitLab / Bitbucket support
- [ ] Review rules learned from 👍/👎 reactions
- [ ] VS Code extension

## 🤝 Contributing

PRs welcome! `npm ci && npm run all` runs typecheck, lint, tests and build. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

<div align="center">

Built for the [BharatCode Build League](https://bharatcode.ai/hackathon) by [Ankit Kumar](https://github.com/Ironankit525).
**If Nazar caught something for you, please ⭐ the repo.** It really helps.

Add the badge to your README: `[![Reviewed by Nazar](https://img.shields.io/badge/reviewed%20by-Nazar%20👁️-orange)](https://github.com/Ironankit525/nazar)`

</div>
