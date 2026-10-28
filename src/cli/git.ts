import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseGitDiff, type ChangedFile } from '../core/index.js';

const MAX_UNTRACKED_BYTES = 200_000;

export function git(args: string[], cwd = process.cwd()): string {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function tryGit(args: string[], cwd?: string): string | undefined {
  try {
    return git(args, cwd);
  } catch {
    return undefined;
  }
}

export function repoRoot(): string | undefined {
  return tryGit(['rev-parse', '--show-toplevel'])?.trim();
}

function hasHead(root: string): boolean {
  return tryGit(['rev-parse', '--verify', 'HEAD'], root) !== undefined;
}

export function detectBaseBranch(root: string): string | undefined {
  const originHead = tryGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root)?.trim();
  if (originHead) return originHead;
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    if (tryGit(['rev-parse', '--verify', '--quiet', candidate], root)) return candidate;
  }
  return undefined;
}

function isProbablyText(buf: Buffer): boolean {
  return !buf.subarray(0, 8000).includes(0);
}

/** Untracked files as "all lines added" diffs, so brand-new files get reviewed too. */
function untrackedFiles(root: string): ChangedFile[] {
  const out = tryGit(['ls-files', '--others', '--exclude-standard', '-z'], root) ?? '';
  const files: ChangedFile[] = [];
  for (const path of out.split('\0').filter(Boolean)) {
    try {
      const abs = join(root, path);
      if (statSync(abs).size > MAX_UNTRACKED_BYTES) {
        files.push({ path, status: 'added' });
        continue;
      }
      const buf = readFileSync(abs);
      if (!isProbablyText(buf)) {
        files.push({ path, status: 'added' });
        continue;
      }
      const lines = buf.toString('utf8').replace(/\n$/, '').split('\n');
      files.push({
        path,
        status: 'added',
        patch: [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join('\n'),
      });
    } catch {
      // unreadable; skip
    }
  }
  return files;
}

export interface DiffTarget {
  files: ChangedFile[];
  label: string;
  /** Where full file contents should be read from: working tree, index, or a commit. */
  contentRef: 'worktree' | 'index' | string;
}

const DIFF_FLAGS = ['diff', '-U3', '--no-color', '--no-ext-diff', '--find-renames'];

export function collectDiff(root: string, opts: { staged?: boolean; base?: string }): DiffTarget {
  if (opts.staged) {
    return {
      files: parseGitDiff(git([...DIFF_FLAGS, '--cached'], root)),
      label: 'staged changes',
      contentRef: 'index',
    };
  }
  if (!hasHead(root)) {
    const files = [...parseGitDiff(git([...DIFF_FLAGS, '--cached'], root)), ...untrackedFiles(root)];
    return { files, label: 'all files (no commits yet)', contentRef: 'worktree' };
  }
  if (opts.base) {
    const mergeBase = git(['merge-base', 'HEAD', opts.base], root).trim();
    const files = [...parseGitDiff(git([...DIFF_FLAGS, mergeBase], root)), ...untrackedFiles(root)];
    return { files, label: `changes since ${opts.base}`, contentRef: 'worktree' };
  }
  const uncommitted = [...parseGitDiff(git([...DIFF_FLAGS, 'HEAD'], root)), ...untrackedFiles(root)];
  if (uncommitted.length) return { files: uncommitted, label: 'uncommitted changes', contentRef: 'worktree' };

  const base = detectBaseBranch(root);
  if (base) {
    const mergeBase = tryGit(['merge-base', 'HEAD', base], root)?.trim();
    const head = git(['rev-parse', 'HEAD'], root).trim();
    if (mergeBase && mergeBase !== head) {
      return {
        files: parseGitDiff(git([...DIFF_FLAGS, mergeBase, 'HEAD'], root)),
        label: `commits since ${base}`,
        contentRef: 'HEAD',
      };
    }
  }
  if (tryGit(['rev-parse', '--verify', '--quiet', 'HEAD~1'], root)) {
    return {
      files: parseGitDiff(git([...DIFF_FLAGS, 'HEAD~1', 'HEAD'], root)),
      label: 'last commit',
      contentRef: 'HEAD',
    };
  }
  return {
    files: parseGitDiff(git([...DIFF_FLAGS, '--root', 'HEAD'], root)),
    label: 'first commit',
    contentRef: 'HEAD',
  };
}

export function readContent(root: string, path: string, ref: DiffTarget['contentRef']): string | undefined {
  try {
    if (ref === 'worktree') return readFileSync(join(root, path), 'utf8');
    return git(['show', `${ref === 'index' ? '' : ref}:${path}`], root);
  } catch {
    return undefined;
  }
}

export function trackedFiles(root: string): string[] {
  return (tryGit(['ls-files', '-z'], root) ?? '').split('\0').filter(Boolean);
}
