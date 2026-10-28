# Architecture

Nazar is one TypeScript package with three layers. Only the outer two know about GitHub or git.

```
src/
├── core/            pure review logic: data in, findings out (no GitHub, no git, no process.env)
│   ├── types.ts         ChangedFile, ParsedFile, Finding, RepoCheck, ReviewResult
│   ├── config.ts        zod schema, defaults, YAML parsing, layered merge
│   ├── pipeline.ts      runReview(): parse → filter → checks → chunk → review → verify → summarize → finalize
│   ├── diff/            parse.ts (unified diff → hunks with line numbers), filter.ts, annotate.ts, chunk.ts
│   ├── checks/          secret-rules.ts, secrets.ts, submission.ts (deterministic, no AI)
│   ├── llm/             client.ts (BharatCode, OpenAI-compatible), retry.ts, json.ts, tokens.ts
│   ├── review/          prompts.ts, schema.ts, reviewer.ts, verifier.ts, summarizer.ts, postprocess.ts
│   └── render/          markdown.ts (inline comments, summary, sanitising)
├── action/          GitHub Action entry (bundled to dist/index.js)
│   ├── main.ts          event routing: pull_request · push · issue_comment (@nazar)
│   ├── inputs.ts        action inputs → config overrides
│   ├── github.ts        Octokit reads: PR files, compare, contents, config
│   └── publish.ts       review + inline comments, sticky summary, commit comments
└── cli/             `nazar` CLI (bundled to dist/cli.js, published as nazar-review)
    ├── index.ts         commander setup
    ├── git.ts           local diffs (uncommitted / staged / vs base / last commit, untracked files)
    ├── output.ts        terminal rendering
    ├── templates.ts     workflow/config/hook templates used by `init`
    └── commands/        review.ts (review + explain), check.ts, init.ts
```

## Review pipeline

1. **Collect.** The Action uses `pulls.listFiles` (PRs), `compareCommitsWithBasehead` (pushes and incremental PR reviews) or `getCommit` (first push). The CLI uses `git diff`, and untracked files become "all added" diffs.
2. **Parse.** Each patch becomes hunks where every line knows its old/new line number. `addedLines` and `commentableLines` (added + context, the lines GitHub accepts comments on) are precomputed.
3. **Filter.** Deleted, binary, unchanged and ignored files are skipped (lockfiles, `dist/`, minified, maps, notebooks, generated code, plus user globs). The rest is ranked by risk (source > config > tests > docs) and capped by `max_files` / `max_lines`.
4. **Deterministic checks** run on all files, including ignored ones, since a key in `dist/` still leaks:
   - Secret rules on added lines only. Specific formats first, then generic `key = "..."` with entropy + placeholder + "looks like key material" checks.
   - Committed `.env` / `node_modules`.
   - Build League checks: `BharatCode.txt`, `README.md`.
5. **Chunk.** Files are rendered with line labels (`L41 + code`, `L42   context`, `      - deleted`). Small files also get their full content (≤ 400 lines) for context. Files are packed into chunks under `chunk_tokens` and only split by hunk when one file alone exceeds the budget.
6. **Review (pass 1).** For each chunk, with `concurrency` parallel calls: a strict system prompt (report only bugs/security/perf/error-handling, never style) and a JSON-schema `response_format`. Output is parsed leniently (fences, prose, `<think>`, trailing commas, `jsonrepair`) and then validated strictly:
   - The path must be in the chunk.
   - The line must be added, or context within 2 lines of an added line.
   - `end_line` must stay in the same hunk.
   - Suggestions must differ from the original and be cleaned of fences and copied labels.
7. **Verify (pass 2).** A sceptical second call must explicitly `keep` each finding. Missing verdicts count as rejections. A totally unusable answer, or an error, fails open.
8. **Summarize.** One call with a token-budgeted digest of the whole change returns an overview, a risk level and a per-file walkthrough.
9. **Finalize.** Merge the scanner and AI findings. Dedupe nearby same-category findings, and AI re-reports of scanner secrets. Apply `min_severity` / `min_confidence` (scanner findings are always kept), sort, and cap at `max_comments`.

## Publishing

- **PR:**
  - One `pulls.createReview` (`event: COMMENT`) with every inline comment, so people get one notification. If GitHub rejects the batch, comments are posted one by one, and failures are listed in the summary.
  - The summary is a single issue comment found by its hidden marker `<!-- nazar:summary sha=… -->` and updated in place.
  - The stored SHA enables **incremental** reviews of only the new commits, falling back to a full review after force-pushes.
- **Push:**
  - Skipped when the commit belongs to an already-merged PR, since it was already reviewed.
  - Otherwise a detailed commit comment (only when there's something to act on) plus a job summary.
- **`@nazar explain` / `@nazar review`:** only from `OWNER` / `MEMBER` / `COLLABORATOR`. Nazar reacts with 👀, then replies.

## Resilience

`BharatCodeClient`:
- Retries `408/409/425/429/5xx`, network errors and timeouts with "equal jitter" backoff (2s → 30s, 5 retries), and honours `Retry-After`.
- Has a 180s per-request timeout and a global deadline (`time_budget_seconds`).
- Treats empty or truncated output as an error.
- On a `400` caused by optional parameters (`response_format`, `reasoning_effort`), it switches them off for the rest of the session and asks for JSON in the prompt instead.

`runReview` never throws because of the model. Failed chunks lower `aiStatus` to `partial` / `unavailable`, and the deterministic results are still published.
