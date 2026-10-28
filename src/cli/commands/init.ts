import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import pc from 'picocolors';
import { git, repoRoot } from '../git.js';
import { configTemplate, PRE_PUSH_HOOK, workflowTemplate } from '../templates.js';

export interface InitOptions {
  force?: boolean;
  lang?: string;
  hook?: boolean;
  setSecret?: boolean;
}

function writeIfAbsent(root: string, path: string, content: string, force: boolean, mode?: number): boolean {
  const rel = relative(root, path);
  if (existsSync(path) && !force) {
    console.log(`  ${pc.yellow('•')} ${rel} already exists ${pc.dim('(use --force to overwrite)')}`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  if (mode) chmodSync(path, mode);
  console.log(`  ${pc.green('✔')} wrote ${rel}`);
  return true;
}

function setSecretWithGh(root: string): boolean {
  const key = process.env.BHARATCODE_API_KEY?.trim();
  if (!key) {
    console.log(
      `  ${pc.yellow('•')} BHARATCODE_API_KEY is not set in your shell, so the secret was not uploaded.`,
    );
    return false;
  }
  // Key goes through stdin, never argv, so it does not show up in process listings.
  const res = spawnSync('gh', ['secret', 'set', 'BHARATCODE_API_KEY'], {
    cwd: root,
    input: key,
    encoding: 'utf8',
  });
  if (res.status === 0) {
    console.log(`  ${pc.green('✔')} set repository secret BHARATCODE_API_KEY`);
    return true;
  }
  console.log(`  ${pc.red('✖')} gh secret set failed: ${(res.stderr || res.error?.message || '').trim()}`);
  return false;
}

export async function initCommand(opts: InitOptions): Promise<void> {
  const root = repoRoot();
  if (!root) {
    console.error(pc.red('Run this inside a git repository.'));
    process.exit(2);
  }
  const lang = opts.lang === 'hinglish' || opts.lang === 'hi' ? 'hinglish' : 'en';
  const force = Boolean(opts.force);

  console.log(`\n${pc.bold('👁  Setting up Nazar')}\n`);
  writeIfAbsent(root, join(root, '.github', 'workflows', 'nazar.yml'), workflowTemplate(), force);
  writeIfAbsent(root, join(root, '.github', 'nazar.yml'), configTemplate(lang), force);

  if (opts.hook) {
    const hooksDir = git(['rev-parse', '--git-path', 'hooks'], root).trim();
    writeIfAbsent(root, join(root, hooksDir, 'pre-push'), PRE_PUSH_HOOK, force, 0o755);
  }

  const secretSet = opts.setSecret ? setSecretWithGh(root) : false;

  console.log(`\n${pc.bold('Next steps')}`);
  let step = 1;
  if (!secretSet) {
    console.log(
      `  ${step++}. Get a BharatCode API key (free for students): ${pc.underline('https://bharatcode.ai/account')}`,
    );
    console.log(`  ${step++}. Add it as a repo secret named ${pc.cyan('BHARATCODE_API_KEY')}:`);
    console.log(
      pc.dim(
        `       gh secret set BHARATCODE_API_KEY   ${pc.italic('(or: repo Settings → Secrets and variables → Actions)')}`,
      ),
    );
  }
  console.log(`  ${step++}. Commit and push:`);
  console.log(pc.dim('       git add .github && git commit -m "Add Nazar AI code review" && git push'));
  console.log(`  ${step}. Open a pull request (or push to main) and Nazar will review it.\n`);
  console.log(pc.dim(`  Like it? ⭐ https://github.com/Ironankit525/nazar\n`));
}
