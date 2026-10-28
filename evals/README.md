# Evals

Each case in `cases/` is a realistic change with a known answer:

- `diff.patch`: the change, in `git diff` format.
- `expected.json`: `{ "expect": [{ "path", "line", "category" }] }`. An empty `expect` means the code is clean and Nazar should stay quiet.

A finding counts as a hit when the path matches and the line is within ±3 of the expected line.

```bash
BHARATCODE_API_KEY=... npm run eval               # all cases
BHARATCODE_API_KEY=... npm run eval -- 003        # one case
BHARATCODE_API_KEY=... npm run eval -- --no-verify
NAZAR_MODEL=deepseek-v4.1-flash npm run eval      # compare models (Pro key)
```

Results are saved to `evals/results/` (git-ignored). Run evals before and after every prompt change.
