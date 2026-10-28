# Configuration

Settings are merged in this order (later wins): **built-in defaults → `.github/nazar.yml` → Action inputs / CLI flags**.
Unknown or invalid keys in the config file are ignored with a warning, so a typo never breaks your CI.

## `.github/nazar.yml`

| Key | Default | Description |
|---|---|---|
| `model` | `qwen-3.8-27b` | BharatCode model id (`GET https://bharatcode.ai/api/model/v1/models`). |
| `base_url` | `https://bharatcode.ai/api/model/v1` | OpenAI-compatible API base URL. |
| `language` | `en` | `en` or `hinglish`. |
| `max_comments` | `10` | Max findings per review (0–50). |
| `min_severity` | `medium` | Hide AI findings below `low` / `medium` / `high` / `critical`. Secret findings always show. |
| `min_confidence` | `0.6` | Hide AI findings below this model confidence (0–1). |
| `focus` | `[]` | Areas to emphasise, e.g. `[security, performance]`. |
| `ignore` | `[]` | Extra glob patterns to skip. Patterns without `/` match file names anywhere. |
| `instructions` | `""` | Project context for the reviewer (max 2,000 chars). |
| `verify` | `true` | Run the second-pass verifier. |
| `summary` | `true` | Generate the overview, risk level and walkthrough. |
| `hackathon_checks` | `true` | Check for `BharatCode.txt` and `README.md`. |
| `max_files` | `40` | Max files to AI-review per run (riskiest first). |
| `max_lines` | `4000` | Max added lines to AI-review per run. |
| `chunk_tokens` | `16000` | Token budget per model request. |
| `concurrency` | `2` | Parallel model requests (1–8). Be kind to shared capacity. |
| `skip_drafts` | `true` | Don't review draft PRs. |
| `incremental` | `true` | On new commits, review only what changed since the last review. |
| `time_budget_seconds` | `480` | Stop starting new model calls after this long. |

Always skipped: lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`…), `dist/`, `build/`, `out/`, `.next/`, `coverage/`, `node_modules/`, `vendor/`, `*.min.js`, `*.min.css`, `*.map`, `*.snap`, `*.ipynb`, `*.svg`, `*.generated.*`, `*.pb.go`, binaries and deleted files.

### Silencing a secret false positive

Add `nazar:allow` in a comment on that line (for example `const demoKey = "..."; // nazar:allow`). The scanner skips it.

## Action inputs

| Input | Default | Description |
|---|---|---|
| `bharatcode-api-key` | — | Your key, from a secret. Without it only secret/repo checks run. |
| `github-token` | `${{ github.token }}` | Token for reading diffs and posting comments. |
| `mode` | `auto` | `auto` (from the event), `pr` or `push`. |
| `fail-on` | `none` | Fail the job on findings at or above this severity. At `high`/`critical`, failing repo checks (e.g. committed `.env`) also fail it. |
| `config-path` | `.github/nazar.yml` | Where to read the config file. |
| `model`, `base-url`, `language`, `max-comments`, `min-severity`, `verify`, `summary`, `hackathon-checks`, `incremental`, `ignore` | — | Override the config file. `ignore` is comma- or newline-separated. |

Outputs: `findings-count`, `critical-count`, `ai-status` (`ok` · `partial` · `unavailable` · `disabled`).

### Permissions

```yaml
permissions:
  contents: write       # push mode: commit comments (use `read` if you only review PRs)
  pull-requests: write  # PR reviews and inline comments
  issues: write         # summary comment + @nazar replies
```

## CLI

```
nazar-review [review] [--staged] [--base <ref>] [--model <id>] [--lang en|hinglish]
                      [--fail-on <severity|none>] [--min-severity <s>] [--max-comments <n>]
                      [--no-verify] [--no-ai] [--json] [-v]
nazar-review explain  [--staged] [--base <ref>]
nazar-review check    [--history [commits]]
nazar-review init     [--lang hinglish] [--hook] [--set-secret] [--force]
```

Environment: `BHARATCODE_API_KEY` (required for AI), `BHARATCODE_BASE_URL` (optional override).
The CLI reads `.github/nazar.yml` from the repo root too.
