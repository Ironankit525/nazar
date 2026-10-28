# Security

## How Nazar handles your code

- Diffs (and the full content of small changed files, for context) are sent to the BharatCode API using **your** key. Nothing is sent anywhere else. Nazar has no backend and no telemetry.
- Nazar never checks out, builds or runs the code under review. It reads diffs through the GitHub API.
- Model output is untrusted. It only ever becomes comment text, and `@mentions`, raw HTML and HTML comment markers are neutralised before posting.
- Detected secrets are masked (`ghp_…6789`) everywhere. The API key is registered with `core.setSecret` so it never appears in logs.

## Fork pull requests

With the recommended `pull_request` trigger, GitHub doesn't give secrets to workflows triggered from forks, so Nazar runs secret and repo checks only.

You *can* use `pull_request_target` to AI-review fork PRs, because Nazar itself never executes PR code. But **never add an `actions/checkout` of the PR head, or any build step, to that workflow**: that would run untrusted code with your secrets. Also remember that diff text can contain prompt-injection attempts. The worst case is a misleading review comment, but treat AI reviews as advice, not approval.

## Reporting a vulnerability

Please open a [private security advisory](https://github.com/Ironankit525/nazar/security/advisories/new) rather than a public issue. I'll respond within 72 hours.
