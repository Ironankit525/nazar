import { describe, expect, it } from 'vitest';
import { runReview } from '../src/core/pipeline.js';
import { config, FakeLLM, sampleFiles } from './helpers.js';

const sqlFinding = {
  path: 'src/db.js',
  line: 6,
  end_line: null,
  severity: 'critical',
  category: 'security',
  title: 'SQL injection',
  explanation: 'User input concatenated into SQL.',
  suggestion: "  const rows = await db.query('SELECT * FROM users WHERE name = $1', [name]);",
  confidence: 0.95,
};
const noise = {
  ...sqlFinding,
  line: 24,
  severity: 'medium',
  category: 'maintainability',
  title: 'Prefer ESM exports',
  suggestion: null,
  confidence: 0.7,
};
const hallucinated = { ...sqlFinding, line: 99, title: 'Made-up line' };

describe('runReview', () => {
  it('combines secret findings, verified AI findings, checks and a summary', async () => {
    const llm = new FakeLLM({
      review: (req) =>
        req.user.includes('src/db.js') ? { findings: [sqlFinding, noise, hallucinated] } : { findings: [] },
      verdicts: () => ({
        verdicts: [
          { id: 0, keep: true, reason: 'real' },
          { id: 1, keep: false, reason: 'style' },
        ],
      }),
      summary: () => ({
        overview: 'Refactors user lookup.',
        risk: 'high',
        changes: [
          { path: 'src/db.js', description: 'Builds SQL by hand.' },
          { path: 'nope.js', description: 'x' },
        ],
      }),
    });
    const result = await runReview({
      files: sampleFiles(),
      config: config(),
      llm,
      fileExists: async (p) => p === 'README.md',
    });

    expect(result.aiStatus).toBe('ok');
    expect(result.rejectedByVerifier).toBe(1);
    expect(result.findings.map((f) => [f.path, f.line, f.source])).toEqual([
      ['.env', 1, 'secrets'],
      ['src/db.js', 7, 'secrets'],
      ['src/db.js', 6, 'ai'],
    ]);
    expect(result.checks.map((c) => c.id)).toEqual(['env-committed', 'bharatcode-txt-missing']);
    expect(result.summary).toEqual({
      overview: 'Refactors user lookup.',
      risk: 'high',
      changes: [{ path: 'src/db.js', description: 'Builds SQL by hand.' }],
    });
    expect(llm.calls.filter((c) => c.schema?.name === 'verdicts')).toHaveLength(1); // only chunks with findings get verified
  });

  it('degrades to deterministic checks when BharatCode is unavailable', async () => {
    const llm = new FakeLLM({
      review: () => {
        throw new Error('503 busy');
      },
    });
    const result = await runReview({ files: sampleFiles(), config: config(), llm });
    expect(result.aiStatus).toBe('unavailable');
    expect(result.findings.every((f) => f.source === 'secrets')).toBe(true);
    expect(result.findings).toHaveLength(2);
    expect(result.summary).toBeUndefined();
  });

  it('reports a rejected key/plan clearly and stops calling the API', async () => {
    const { LLMError } = await import('../src/core/llm/retry.js');
    const llm = new FakeLLM({
      review: () => {
        throw new LLMError('402 subscription required', 402);
      },
    });
    const files = [...sampleFiles(), { path: 'b.ts', status: 'added' as const, patch: '@@ -0,0 +1 @@\n+x' }];
    const result = await runReview({ files, config: config({ chunk_tokens: 1000, concurrency: 1 }), llm });
    expect(result.aiStatus).toBe('unavailable');
    expect(result.aiError).toContain('verify your student email');
    expect(llm.calls).toHaveLength(1);
  });

  it('runs without an LLM at all', async () => {
    const result = await runReview({ files: sampleFiles(), config: config() });
    expect(result.aiStatus).toBe('disabled');
    expect(result.findings).toHaveLength(2);
  });

  it('keeps findings when the verifier errors (fail open) and can skip verification', async () => {
    const llm = new FakeLLM({
      review: () => ({ findings: [sqlFinding] }),
      summary: () => ({ overview: 'x', risk: 'low', changes: [] }),
    });
    const result = await runReview({ files: sampleFiles(), config: config(), llm });
    expect(result.findings.some((f) => f.source === 'ai')).toBe(true);

    const llm2 = new FakeLLM({
      review: () => ({ findings: [sqlFinding] }),
      summary: () => ({ overview: 'x', risk: 'low', changes: [] }),
    });
    await runReview({ files: sampleFiles(), config: config({ verify: false }), llm: llm2 });
    expect(llm2.calls.some((c) => c.schema?.name === 'verdicts')).toBe(false);
  });

  it('drops findings the verifier does not explicitly keep', async () => {
    const llm = new FakeLLM({
      review: () => ({ findings: [sqlFinding, noise] }),
      verdicts: () => ({ verdicts: [{ id: 0, keep: true, reason: 'real' }] }),
      summary: () => ({ overview: 'x', risk: 'low', changes: [] }),
    });
    const result = await runReview({ files: sampleFiles(), config: config(), llm });
    expect(result.findings.filter((f) => f.source === 'ai').map((f) => f.line)).toEqual([6]);
    expect(result.rejectedByVerifier).toBe(1);
  });

  it('fails open when the verifier answer is unusable', async () => {
    const llm = new FakeLLM({
      review: () => ({ findings: [sqlFinding] }),
      verdicts: () => ({ verdicts: [{ id: 42, keep: false }] }),
      summary: () => ({ overview: 'x', risk: 'low', changes: [] }),
    });
    const result = await runReview({ files: sampleFiles(), config: config(), llm });
    expect(result.findings.some((f) => f.source === 'ai')).toBe(true);
  });

  it('survives junk model output', async () => {
    const llm = new FakeLLM({
      review: () => 'I think the code looks fine!',
      summary: () => 'not json at all',
    });
    const result = await runReview({ files: sampleFiles(), config: config(), llm });
    expect(result.aiStatus).toBe('ok');
    expect(result.findings.every((f) => f.source === 'secrets')).toBe(true);
  });

  it('passes repo instructions and language into the prompt', async () => {
    const llm = new FakeLLM({
      review: () => ({ findings: [] }),
      summary: () => ({ overview: 'x', risk: 'low', changes: [] }),
    });
    await runReview({
      files: sampleFiles(),
      config: config({ language: 'hinglish', instructions: 'We use Postgres.' }),
      llm,
    });
    expect(llm.calls[0]!.system).toContain('Hinglish');
    expect(llm.calls[0]!.system).toContain('We use Postgres.');
  });
});
