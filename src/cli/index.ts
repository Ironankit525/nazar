import { Command } from 'commander';
import pc from 'picocolors';
import { checkCommand } from './commands/check.js';
import { initCommand } from './commands/init.js';
import { explainCommand, reviewCommand } from './commands/review.js';

declare const __NAZAR_VERSION__: string | undefined;
const version = typeof __NAZAR_VERSION__ === 'string' ? __NAZAR_VERSION__ : '0.0.0-dev';

const program = new Command()
  .name('nazar')
  .description('👁  Free AI code review for every Indian developer, powered by BharatCode.')
  .version(version);

const diffOptions = (cmd: Command) =>
  cmd
    .option('--staged', 'only staged changes')
    .option('--base <ref>', 'compare against a branch or commit (e.g. main)')
    .option('--model <id>', 'BharatCode model id')
    .option('--lang <lang>', 'en | hinglish')
    .option('-v, --verbose', 'show debug output');

diffOptions(
  program
    .command('review', { isDefault: true })
    .description('review your local changes (uncommitted, else commits since the base branch)'),
)
  .option('--fail-on <severity>', 'exit 1 at or above: low | medium | high | critical | none', 'critical')
  .option('--min-severity <severity>', 'hide findings below this severity')
  .option('--max-comments <n>', 'maximum findings to show')
  .option('--no-verify', 'skip the second-pass verifier (faster, noisier)')
  .option('--no-ai', 'only run secret and repo checks')
  .option('--json', 'print machine-readable JSON')
  .action(reviewCommand);

diffOptions(program.command('explain').description('explain your changes in plain language')).action(
  explainCommand,
);

program
  .command('check')
  .description('check your repo is ready to submit to the BharatCode Build League')
  .option('--history [commits]', 'also scan git history for leaked secrets (default 500 commits)')
  .action(checkCommand);

program
  .command('init')
  .description('add the Nazar GitHub Action to this repo')
  .option('--lang <lang>', 'review language: en | hinglish', 'en')
  .option('--hook', 'also install a git pre-push hook that blocks critical findings')
  .option('--set-secret', 'upload $BHARATCODE_API_KEY as a repo secret using the gh CLI')
  .option('-f, --force', 'overwrite existing files')
  .action(initCommand);

program.parseAsync().catch((err: Error) => {
  console.error(pc.red(`✖ ${err.message}`));
  process.exit(1);
});
