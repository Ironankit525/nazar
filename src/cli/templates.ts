export const ACTION_REF = 'Ironankit525/nazar@v1';

export function workflowTemplate(): string {
  return `name: Nazar Review

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
  group: nazar-\${{ github.event.pull_request.number || github.sha }}
  cancel-in-progress: true

jobs:
  review:
    # Skip comments that are not "@nazar ..." commands on pull requests.
    if: github.event_name != 'issue_comment' || (github.event.issue.pull_request && startsWith(github.event.comment.body, '@nazar'))
    runs-on: ubuntu-latest
    timeout-minutes: 12
    steps:
      - uses: ${ACTION_REF}
        with:
          bharatcode-api-key: \${{ secrets.BHARATCODE_API_KEY }}
`;
}

export function configTemplate(language: 'en' | 'hinglish'): string {
  return `# Nazar configuration: https://github.com/Ironankit525/nazar#configuration
language: ${language} # en | hinglish
max_comments: 10
min_severity: medium # low | medium | high | critical
# focus: [security, bugs]
# ignore:
#   - "docs/**"
# instructions: |
#   This is a Flask app using SQLAlchemy. Never use raw SQL strings.
`;
}

export const PRE_PUSH_HOOK = `#!/bin/sh
# Installed by \`nazar init --hook\`: blocks pushes with critical findings. Bypass with: git push --no-verify
npx --yes nazar-review review --fail-on critical
`;
