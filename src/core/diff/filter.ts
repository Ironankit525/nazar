import { minimatch } from 'minimatch';
import { DEFAULT_IGNORE, type NazarConfig } from '../config.js';
import type { ParsedFile, SkippedFile } from '../types.js';

const DOC_EXT = /\.(md|mdx|rst|txt|adoc)$/i;
const TEST_PATH = /(^|\/)(__tests__|tests?|spec|e2e|fixtures?)\/|\.(test|spec)\.[a-z0-9]+$/i;
const CONFIG_EXT = /\.(json|ya?ml|toml|ini|cfg|lock|xml|csv)$/i;

export function isIgnored(path: string, patterns: string[]): boolean {
  return patterns.some((p) => minimatch(path, p, { dot: true, matchBase: !p.includes('/') }));
}

/** Higher = reviewed first when a change is too big to review entirely. */
export function riskScore(path: string): number {
  if (DOC_EXT.test(path)) return 0;
  if (TEST_PATH.test(path)) return 1;
  if (CONFIG_EXT.test(path)) return 2;
  return 3;
}

export interface FilterResult {
  reviewable: ParsedFile[];
  skipped: SkippedFile[];
}

export function filterFiles(files: ParsedFile[], config: NazarConfig): FilterResult {
  const skipped: SkippedFile[] = [];
  const candidates: ParsedFile[] = [];
  const ignore = [...DEFAULT_IGNORE, ...config.ignore];

  for (const file of files) {
    if (file.status === 'removed') skipped.push({ path: file.path, reason: 'deleted' });
    else if (!file.patch) skipped.push({ path: file.path, reason: 'binary or too large to diff' });
    else if (file.addedLines.size === 0) skipped.push({ path: file.path, reason: 'no added lines' });
    else if (isIgnored(file.path, ignore)) skipped.push({ path: file.path, reason: 'ignored' });
    else candidates.push(file);
  }

  // Stable sort: riskiest first, then larger changes first.
  candidates.sort((a, b) => riskScore(b.path) - riskScore(a.path) || b.additions - a.additions);

  const reviewable: ParsedFile[] = [];
  let lines = 0;
  for (const file of candidates) {
    if (reviewable.length >= config.max_files) {
      skipped.push({ path: file.path, reason: `over max_files (${config.max_files})` });
    } else if (lines + file.additions > config.max_lines && reviewable.length > 0) {
      skipped.push({ path: file.path, reason: `over max_lines (${config.max_lines})` });
    } else {
      reviewable.push(file);
      lines += file.additions;
    }
  }
  return { reviewable, skipped };
}
