import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/core/diff/parse.js';
import { parseJsonLoose } from '../src/core/llm/json.js';
import {
  cleanSuggestion,
  dedupeFindings,
  finalizeFindings,
  validateFinding,
} from '../src/core/review/postprocess.js';
import { rawFindingSchema } from '../src/core/review/schema.js';
import type { Finding, ParsedFile } from '../src/core/types.js';
import { config, sampleFiles } from './helpers.js';

const db = () => {
  const f = parseFile(sampleFiles()[0]!);
  return new Map<string, ParsedFile>([[f.path, f]]);
};

const raw = (over: Record<string, unknown> = {}) =>
  rawFindingSchema.parse({
    path: 'src/db.js',
    line: 6,
    end_line: null,
    severity: 'critical',
    category: 'security',
    title: 'SQL injection',
    explanation: 'User input is concatenated into SQL.',
    suggestion: "  const rows = await db.query('SELECT * FROM users WHERE name = $1', [name]);",
    confidence: 0.9,
    ...over,
  });

const finding = (over: Partial<Finding>): Finding => ({
  path: 'a.ts',
  line: 1,
  severity: 'medium',
  category: 'bug',
  title: 't',
  explanation: 'e',
  confidence: 0.8,
  source: 'ai',
  ...over,
});

describe('rawFindingSchema', () => {
  it('is lenient about formatting', () => {
    const r = rawFindingSchema.parse({
      path: 'x',
      line: 'L12',
      severity: 'HIGH',
      category: 'Error Handling',
      title: 't',
      explanation: 'e',
      confidence: 85,
    });
    expect(r).toMatchObject({ line: 12, severity: 'high', category: 'error-handling', confidence: 0.85 });
  });

  it('falls back to bug for unknown categories', () => {
    expect(
      rawFindingSchema.parse({
        path: 'x',
        line: 1,
        severity: 'low',
        category: 'style',
        title: 't',
        explanation: 'e',
        confidence: 1,
      }).category,
    ).toBe('bug');
  });
});

describe('validateFinding', () => {
  it('accepts findings on added lines and keeps a valid suggestion', () => {
    const f = validateFinding(raw(), db());
    expect(f).toMatchObject({ path: 'src/db.js', line: 6, suggestion: expect.stringContaining('$1') });
  });

  it('normalises paths the model decorates', () => {
    expect(validateFinding(raw({ path: './src/db.js' }), db())).toBeDefined();
    expect(validateFinding(raw({ path: 'b/src/db.js' }), db())).toBeDefined();
  });

  it('drops findings on unknown files or lines outside the diff', () => {
    expect(validateFinding(raw({ path: 'other.js' }), db())).toBeUndefined();
    expect(validateFinding(raw({ line: 15 }), db())).toBeUndefined();
  });

  it('accepts context lines only when next to an added line', () => {
    expect(validateFinding(raw({ line: 8, suggestion: null }), db())).toBeDefined(); // 1 below added line 7
    expect(validateFinding(raw({ line: 1, suggestion: null }), db())).toBeUndefined(); // far from changes
  });

  it('drops suggestions that change nothing or have a bad range', () => {
    const same = validateFinding(raw({ suggestion: '  const name = req.query.name;', line: 5 }), db());
    expect(same?.suggestion).toBeUndefined();
    const badRange = validateFinding(raw({ end_line: 40 }), db());
    expect(badRange).toMatchObject({ endLine: undefined, suggestion: undefined });
  });

  it('keeps valid multi-line ranges', () => {
    expect(validateFinding(raw({ line: 5, end_line: 6 }), db())).toMatchObject({ line: 5, endLine: 6 });
  });
});

describe('cleanSuggestion', () => {
  it('strips fences and copied annotations', () => {
    expect(cleanSuggestion('```js\nfoo();\n```')).toBe('foo();');
    expect(cleanSuggestion('L6 +   foo();\nL7     bar();')).toBe('  foo();\n  bar();');
  });
});

describe('dedupe + finalize', () => {
  it('dedupes nearby findings in the same category, keeping the most severe', () => {
    const out = dedupeFindings([
      finding({ line: 10 }),
      finding({ line: 11, severity: 'high' }),
      finding({ line: 30 }),
    ]);
    expect(out.map((f) => [f.line, f.severity])).toEqual([
      [11, 'high'],
      [30, 'medium'],
    ]);
  });

  it('applies severity/confidence thresholds and the comment cap, but always keeps secrets', () => {
    const out = finalizeFindings(
      [
        finding({ line: 1, severity: 'low' }),
        finding({ line: 10, confidence: 0.3 }),
        finding({ line: 20, severity: 'high' }),
        finding({ line: 30, severity: 'critical', source: 'secrets', confidence: 0.1 }),
      ],
      config({ min_severity: 'medium', max_comments: 5 }),
    );
    expect(out.map((f) => f.line)).toEqual([30, 20]);
    expect(
      finalizeFindings([finding({ line: 1 }), finding({ line: 9 })], config({ max_comments: 1 })),
    ).toHaveLength(1);
  });

  it('collapses an AI re-report of a scanner secret, but not a different issue nearby', () => {
    const secret = finding({ line: 7, severity: 'critical', category: 'security', source: 'secrets' });
    const aiSame = finding({ line: 7, severity: 'critical', category: 'security' });
    const aiNearby = finding({ line: 6, severity: 'critical', category: 'security', title: 'SQL injection' });
    expect(dedupeFindings([aiSame, aiNearby, secret]).map((f) => [f.line, f.source])).toEqual([
      [7, 'secrets'],
      [6, 'ai'],
    ]);
  });
});

describe('parseJsonLoose', () => {
  it('handles fences, prose, think blocks and trailing commas', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a": [1, 2,], } hope it helps')).toEqual({ a: [1, 2] });
    expect(parseJsonLoose('<think>hmm {no}</think>{"findings":[]}')).toEqual({ findings: [] });
  });
});
