import { describe, expect, it } from 'vitest';
import { filterAlreadyPosted } from '../src/action/publish.js';
import { renderInlineComment } from '../src/core/render/markdown.js';
import type { Finding } from '../src/core/types.js';

const f = (over: Partial<Finding> = {}): Finding => ({
  path: 'src/a.ts',
  line: 10,
  severity: 'high',
  category: 'bug',
  title: 'Missing await',
  explanation: 'e',
  confidence: 0.9,
  source: 'ai',
  ...over,
});

describe('filterAlreadyPosted', () => {
  it('skips findings Nazar already commented on the same line', () => {
    const existing = [
      { path: 'src/a.ts', line: 10, body: renderInlineComment(f({ explanation: 'reworded' })) },
    ];
    expect(
      filterAlreadyPosted([f(), f({ line: 20 }), f({ title: 'Other issue' })], existing).map((x) => [
        x.line,
        x.title,
      ]),
    ).toEqual([
      [20, 'Missing await'],
      [10, 'Other issue'],
    ]);
  });

  it('matches outdated comments by original line and multi-line findings by end line', () => {
    const multi = f({ line: 5, endLine: 7 });
    const existing = [
      { path: 'src/a.ts', line: null, original_line: 10, body: renderInlineComment(f()) },
      { path: 'src/a.ts', line: 7, body: renderInlineComment(multi) },
    ];
    expect(filterAlreadyPosted([f(), multi], existing)).toEqual([]);
  });

  it('ignores comments written by humans', () => {
    const existing = [
      { path: 'src/a.ts', line: 10, body: renderInlineComment(f()).replace(/<sub>.*<\/sub>/, '') },
    ];
    expect(filterAlreadyPosted([f()], existing)).toHaveLength(1);
  });
});
