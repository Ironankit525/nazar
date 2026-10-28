import { describe, expect, it } from 'vitest';
import { annotateHunk } from '../src/core/diff/annotate.js';
import { chunkFiles } from '../src/core/diff/chunk.js';
import { filterFiles, isIgnored } from '../src/core/diff/filter.js';
import { parseFile, parsePatch } from '../src/core/diff/parse.js';
import { config, sampleFiles } from './helpers.js';

describe('parseGitDiff', () => {
  it('extracts files with status, renames, binaries and deletions', () => {
    const files = sampleFiles();
    expect(files.map((f) => [f.path, f.status])).toEqual([
      ['src/db.js', 'modified'],
      ['package-lock.json', 'modified'],
      ['new.txt', 'renamed'],
      ['logo.png', 'added'],
      ['gone.py', 'removed'],
      ['.env', 'added'],
    ]);
    expect(files[2]!.previousPath).toBe('old.txt');
    expect(files[3]!.patch).toBeUndefined();
  });
});

describe('parsePatch / parseFile', () => {
  it('tracks old and new line numbers across hunks', () => {
    const file = parseFile(sampleFiles()[0]!);
    expect(file.hunks).toHaveLength(2);
    expect([...file.addedLines]).toEqual([5, 6, 7, 24]);
    expect(file.commentableLines.has(8)).toBe(true); // context "res.json(rows)"
    expect(file.commentableLines.has(4)).toBe(true);
    expect(file.additions).toBe(4);
    expect(file.deletions).toBe(1);
  });

  it('ignores "no newline" markers and handles single-line hunks', () => {
    const hunks = parsePatch(
      '@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file',
    );
    expect(hunks[0]!.lines).toEqual([
      { type: 'del', content: 'a', oldLine: 1 },
      { type: 'add', content: 'b', newLine: 1 },
    ]);
  });
});

describe('annotateHunk', () => {
  it('prefixes added and context lines with new line numbers', () => {
    const file = parseFile(sampleFiles()[0]!);
    const text = annotateHunk(file.hunks[0]!);
    expect(text).toContain('L6 +   const rows = await db.query("SELECT');
    expect(text).toContain('L8     res.json(rows);');
    expect(text).toContain("      -   const rows = await db.query('SELECT");
  });
});

describe('filterFiles', () => {
  it('skips lockfiles, binaries, deletions and pure-deletion files', () => {
    const parsed = sampleFiles().map(parseFile);
    const { reviewable, skipped } = filterFiles(parsed, config());
    expect(reviewable.map((f) => f.path).sort()).toEqual(['.env', 'new.txt', 'src/db.js']);
    expect(skipped.map((s) => s.path).sort()).toEqual(['gone.py', 'logo.png', 'package-lock.json']);
  });

  it('applies user ignore globs and caps', () => {
    const parsed = sampleFiles().map(parseFile);
    const { reviewable } = filterFiles(parsed, config({ ignore: ['src/**'], max_files: 1 }));
    expect(reviewable).toHaveLength(1);
    expect(reviewable[0]!.path).not.toBe('src/db.js');
  });

  it('matches bare patterns against basenames', () => {
    expect(isIgnored('a/b/c.generated.ts', ['*.generated.ts'])).toBe(true);
    expect(isIgnored('docs/x.md', ['docs/**'])).toBe(true);
    expect(isIgnored('src/x.md', ['docs/**'])).toBe(false);
  });
});

describe('chunkFiles', () => {
  it('packs small files together and splits oversized files by hunk', () => {
    const big = parseFile({
      path: 'big.ts',
      status: 'modified',
      patch: Array.from({ length: 6 }, (_, h) =>
        [
          `@@ -${h * 100 + 1},1 +${h * 100 + 1},50 @@`,
          ...Array.from({ length: 50 }, (_, i) => `+const v${h}_${i} = ${'x'.repeat(60)};`),
        ].join('\n'),
      ).join('\n'),
    });
    const small = parseFile(sampleFiles()[0]!);
    const chunks = chunkFiles([small, big], 2500);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.tokens).toBeLessThanOrEqual(2500);
    const bigHunks = chunks.flatMap((c) =>
      c.parts.filter((p) => p.file.path === 'big.ts').map((p) => p.hunks.length),
    );
    expect(bigHunks.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('includes full file content for context when provided', () => {
    const small = parseFile(sampleFiles()[0]!);
    const [chunk] = chunkFiles([small], 16000, new Map([['src/db.js', 'line one\nline two']]));
    expect(chunk!.text).toContain('1: line one');
  });
});
