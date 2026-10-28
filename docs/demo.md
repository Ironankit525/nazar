# Recording the demo

1. Create a public playground repo (e.g. `nazar-playground`) and run `npx nazar-review init --set-secret` in it.
2. Open these PRs. They stay open as a permanent live demo:
   - `demo/sql-injection`: an Express route that builds SQL with string concatenation.
   - `demo/leaked-key`: a config file with a hard-coded API key and a committed `.env`.
   - `demo/missing-await`: an async function that forgets `await`.
   - `demo/hinglish`: any buggy change, with `language: hinglish` in `.github/nazar.yml`.
   - `demo/clean-refactor`: a safe refactor, which should get "✅ No issues found".
   The files in `evals/cases/*/diff.patch` are ready-made examples (`git apply` them).
3. Record the screen (QuickTime → File → New Screen Recording) while you:
   - scroll the PR summary,
   - open an inline comment,
   - click **Commit suggestion**.
   Keep it under 30 seconds.
4. Convert it to a GIF: `ffmpeg -i demo.mov -vf "fps=12,scale=900:-1" -f yuv4mpegpipe - | gifski -o docs/assets/demo.gif -`
5. Uncomment the GIF line at the top of the README.
