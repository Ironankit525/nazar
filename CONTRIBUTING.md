# Contributing

Thanks for helping! 🙏

```bash
npm ci
npm run all        # typecheck + lint + tests + build
npm test -- --watch
```

- `src/core` must stay free of GitHub/git/process dependencies, so it's easy to test.
- New behaviour needs a test in `test/`. Use `FakeLLM` from `test/helpers.ts`, because tests never call the network.
- Changing prompts? Run the evals before and after (`BHARATCODE_API_KEY=... npm run eval`) and include the numbers in your PR.
- New eval case: add `evals/cases/NNN-name/diff.patch` (git diff format) and `expected.json`.
- **Commit `dist/`** after `npm run build`. GitHub Actions runs the bundled file, and CI fails if it's stale.

## Releasing

```bash
npm version minor   # bumps package.json and creates a vX.Y.Z tag
npm run build && git add dist && git commit --amend --no-edit && git tag -f "v$(node -p 'require(`./package.json`).version')"
git push --follow-tags
```

The release workflow moves the major tag (`v1`), creates a GitHub release and publishes the CLI to npm (needs an `NPM_TOKEN` secret).
