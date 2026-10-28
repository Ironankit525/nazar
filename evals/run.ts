/**
 * Runs Nazar's real AI pipeline on known-buggy (and known-clean) diffs and reports precision/recall.
 *   BHARATCODE_API_KEY=... npm run eval            # all cases
 *   BHARATCODE_API_KEY=... npm run eval -- 003     # cases whose name contains "003"
 *   ... npm run eval -- --no-verify                # measure without the verifier pass
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BharatCodeClient, mergeConfig, parseGitDiff, runReview, type Finding } from '../src/core/index.js';

interface Expected {
  description: string;
  expect: { path: string; line: number; category?: string }[];
  /** Real issues outside the answer key: neither required nor counted as false positives. */
  acceptable?: { path: string; line: number; note?: string }[];
}

const LINE_TOLERANCE = 3;
const casesDir = join(import.meta.dirname, 'cases');
const args = process.argv.slice(2);
const verify = !args.includes('--no-verify');
const filter = args.find((a) => !a.startsWith('--'));

const apiKey = process.env.BHARATCODE_API_KEY;
if (!apiKey) {
  console.error('Set BHARATCODE_API_KEY to run evals.');
  process.exit(2);
}

const config = mergeConfig({
  summary: false,
  verify,
  hackathon_checks: false,
  min_severity: 'low',
  min_confidence: 0.5,
});
const llm = new BharatCodeClient({
  apiKey,
  baseUrl: config.base_url,
  model: process.env.NAZAR_MODEL ?? config.model,
});

let tp = 0;
let fp = 0;
let fn = 0;
let extra = 0;
let cleanNoise = 0;
const rows: string[] = [];
const report: unknown[] = [];

for (const name of readdirSync(casesDir).sort()) {
  if (filter && !name.includes(filter)) continue;
  const dir = join(casesDir, name);
  const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as Expected;
  const files = parseGitDiff(readFileSync(join(dir, 'diff.patch'), 'utf8'));
  const started = Date.now();
  const result = await runReview({ files, config, llm });
  const ai = result.findings.filter((f) => f.source === 'ai');
  if (result.aiError) {
    console.error(result.aiError);
    process.exit(1);
  }

  const matched = new Set<Finding>();
  let caseTp = 0;
  for (const e of expected.expect) {
    const hit = ai.find(
      (f) => !matched.has(f) && f.path === e.path && Math.abs(f.line - e.line) <= LINE_TOLERANCE,
    );
    if (hit) {
      matched.add(hit);
      caseTp++;
    }
  }
  const near = (f: Finding, e: { path: string; line: number }) =>
    f.path === e.path && Math.abs(f.line - e.line) <= LINE_TOLERANCE;
  const accepted = ai.filter((f) => !matched.has(f) && (expected.acceptable ?? []).some((e) => near(f, e)));
  accepted.forEach((f) => matched.add(f));
  extra += accepted.length;
  const caseFn = expected.expect.length - caseTp;
  const caseFp = ai.length - matched.size;
  tp += caseTp;
  fn += caseFn;
  fp += caseFp;
  if (expected.expect.length === 0) cleanNoise += ai.length;

  const status =
    result.aiStatus !== 'ok'
      ? `AI ${result.aiStatus}`
      : caseFn === 0 && caseFp === 0
        ? 'PASS'
        : caseFn === 0
          ? 'PASS (noisy)'
          : 'MISS';
  rows.push(
    `${status.padEnd(13)} ${name.padEnd(28)} found ${String(ai.length).padStart(2)}  tp ${caseTp}  fp ${caseFp}  fn ${caseFn}  verifier -${result.rejectedByVerifier}  ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(rows[rows.length - 1]);
  for (const f of ai)
    console.log(
      `               ${matched.has(f) ? '✓' : '✗'} ${f.path}:${f.line} [${f.severity}/${f.category}] ${f.title}`,
    );
  report.push({
    name,
    expected: expected.expect,
    findings: ai,
    aiStatus: result.aiStatus,
    rejectedByVerifier: result.rejectedByVerifier,
  });
}

const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
console.log('\n──────────────────────────────────────────');
console.log(`Model: ${process.env.NAZAR_MODEL ?? config.model}  verifier: ${verify ? 'on' : 'off'}`);
console.log(
  `Precision: ${(precision * 100).toFixed(0)}%   Recall: ${(recall * 100).toFixed(0)}%   Findings on clean code: ${cleanNoise}   Extra real issues: ${extra}`,
);

mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
const out = join(import.meta.dirname, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(out, JSON.stringify({ precision, recall, cleanNoise, extra, verify, cases: report }, null, 2));
console.log(`Saved ${out}`);
