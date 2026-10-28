import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import {
  DEFAULT_IGNORE,
  isCommittedEnvFile,
  maskSecret,
  scanText,
  type RepoCheck,
} from '../../core/index.js';
import { isIgnored } from '../../core/diff/filter.js';
import { scanLine } from '../../core/checks/secrets.js';
import { git, repoRoot, trackedFiles, tryGit } from '../git.js';
import { printChecks } from '../output.js';

const MAX_SCAN_BYTES = 1_000_000;
// Lockfiles are full of hashes that look like secrets.
const SCAN_SKIP = DEFAULT_IGNORE.filter((p) => /lock|\.sum|\.map|\.min\./.test(p));

function scanWorkingTree(root: string, files: string[]): RepoCheck[] {
  const checks: RepoCheck[] = [];
  for (const path of files) {
    if (isIgnored(path, SCAN_SKIP)) continue;
    const abs = join(root, path);
    try {
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_SCAN_BYTES) continue;
      const buf = readFileSync(abs);
      if (buf.subarray(0, 8000).includes(0)) continue;
      for (const m of scanText(buf.toString('utf8'))) {
        checks.push({
          id: 'secret',
          level: 'error',
          path,
          message: `${m.name} in \`${path}:${m.line}\` (\`${m.masked}\`). Revoke it and load it from an environment variable.`,
        });
      }
    } catch {
      // deleted or unreadable
    }
  }
  return checks;
}

/** Scans added lines across recent history: a deleted secret is still public in git history. */
function scanHistory(root: string, maxCommits: number): RepoCheck[] {
  const log = tryGit(
    ['log', '-p', '-U0', '--no-color', '--no-ext-diff', `--max-count=${maxCommits}`, '--format=commit %H'],
    root,
  );
  if (!log) return [];
  const seen = new Set<string>();
  const checks: RepoCheck[] = [];
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 14);
    else if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+') && !isIgnored(file, SCAN_SKIP) && line.length < 2000) {
      const hit = scanLine(line.slice(1));
      if (!hit) continue;
      const key = `${hit.ruleId}:${hit.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      checks.push({
        id: 'secret-history',
        level: 'error',
        path: file,
        message: `${hit.name} in git history (commit ${commit}, \`${file}\`, \`${maskSecret(hit.value)}\`). Rotate it: removing it from the latest commit does not remove it from history.`,
      });
    }
  }
  return checks;
}

function ghVisibility(root: string): string | undefined {
  try {
    const out = execFileSync('gh', ['repo', 'view', '--json', 'visibility', '-q', '.visibility'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim().toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

export interface CheckOptions {
  history?: string | boolean;
}

export async function checkCommand(opts: CheckOptions): Promise<void> {
  const root = repoRoot();
  if (!root) {
    console.error(pc.red('Not inside a git repository.'));
    process.exit(2);
  }
  const tracked = trackedFiles(root);
  const checks: RepoCheck[] = [];
  const passed: string[] = [];

  if (existsSync(join(root, 'BharatCode.txt'))) passed.push('BharatCode.txt present at repo root');
  else
    checks.push({
      id: 'bharatcode-txt',
      level: 'error',
      message: '`BharatCode.txt` is missing from the repo root (required for Build League submissions).',
    });

  if (existsSync(join(root, 'README.md'))) passed.push('README.md present');
  else
    checks.push({
      id: 'readme',
      level: 'warning',
      message: 'No `README.md`. Add what it does, a demo GIF, and setup steps.',
    });

  const envFiles = tracked.filter(isCommittedEnvFile);
  for (const f of envFiles)
    checks.push({
      id: 'env',
      level: 'error',
      path: f,
      message: `\`${f}\` is committed. Remove it (\`git rm --cached ${f}\`), add it to .gitignore, rotate keys inside.`,
    });
  if (!envFiles.length) passed.push('No .env files committed');

  if (tracked.some((f) => f.startsWith('node_modules/') || f.includes('/node_modules/'))) {
    checks.push({
      id: 'node-modules',
      level: 'warning',
      message:
        '`node_modules/` is committed. Run `git rm -r --cached node_modules` and add it to .gitignore.',
    });
  }

  const secretChecks = scanWorkingTree(root, tracked);
  checks.push(...secretChecks);
  if (!secretChecks.length) passed.push(`No secrets found in ${tracked.length} tracked file(s)`);

  if (opts.history) {
    const n = typeof opts.history === 'string' ? Number(opts.history) || 500 : 500;
    const historyChecks = scanHistory(root, n);
    checks.push(...historyChecks);
    if (!historyChecks.length) passed.push(`No secrets in the last ${n} commit(s)`);
  }

  const remote = tryGit(['remote', 'get-url', 'origin'], root)?.trim();
  if (!remote)
    checks.push({
      id: 'remote',
      level: 'warning',
      message: 'No `origin` remote. Push the repo to GitHub before submitting.',
    });
  else {
    const visibility = ghVisibility(root);
    if (visibility === 'public') passed.push('GitHub repo is public');
    else if (visibility)
      checks.push({
        id: 'visibility',
        level: 'error',
        message: `GitHub repo is ${visibility}. Submissions must be public.`,
      });
    else
      checks.push({
        id: 'visibility',
        level: 'info',
        message:
          'Could not verify repo visibility (install and log in to the `gh` CLI to check). It must be public.',
      });
  }

  if (git(['status', '--porcelain'], root).trim()) {
    checks.push({
      id: 'dirty',
      level: 'info',
      message: 'You have uncommitted changes. Commit and push before submitting.',
    });
  }

  console.log(`\n${pc.bold('👁  Nazar submission check')}\n`);
  for (const p of passed) console.log(`  ${pc.green('✔')} ${p}`);
  if (passed.length) console.log();
  printChecks(checks);

  const errors = checks.filter((c) => c.level === 'error').length;
  if (errors) {
    console.log(pc.red(`${errors} problem(s) to fix before submitting.\n`));
    process.exitCode = 1;
  } else {
    console.log(pc.green('Ready to submit! 🚀\n'));
  }
}
