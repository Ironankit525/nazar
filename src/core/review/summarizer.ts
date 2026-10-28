import type { NazarConfig } from '../config.js';
import type { LLMClient } from '../llm/client.js';
import { parseJsonLoose } from '../llm/json.js';
import { estimateTokens } from '../llm/tokens.js';
import type { ChangeSummary, ParsedFile, ReviewMeta } from '../types.js';
import { explainSystemPrompt, summarizerSystemPrompt, summarizerUserPrompt } from './prompts.js';
import { SUMMARY_JSON_SCHEMA, summarySchema } from './schema.js';

/** A compact view of the whole change: file list plus as much of the diff as fits the budget. */
export function buildDigest(files: ParsedFile[], budgetTokens: number): string {
  const list = files.map((f) => `- ${f.path} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n');
  const parts = [`Files:\n${list}`];
  let used = estimateTokens(parts[0]!);
  for (const f of files) {
    const body = f.hunks
      .map((h) =>
        [
          h.header,
          ...h.lines
            .filter((l) => l.type !== 'context')
            .map((l) => (l.type === 'add' ? '+' : '-') + l.content),
        ].join('\n'),
      )
      .join('\n');
    const block = `\n### ${f.path}\n${body}`;
    const t = estimateTokens(block);
    if (used + t > budgetTokens) {
      parts.push(`\n### ${f.path}\n(diff omitted for length)`);
      continue;
    }
    parts.push(block);
    used += t;
  }
  return parts.join('\n');
}

export async function summarizeChange(
  files: ParsedFile[],
  meta: ReviewMeta,
  llm: LLMClient,
  config: NazarConfig,
): Promise<ChangeSummary> {
  const text = await llm.complete({
    system: summarizerSystemPrompt(config),
    user: summarizerUserPrompt(meta, buildDigest(files, config.chunk_tokens)),
    schema: { name: 'summary', schema: SUMMARY_JSON_SCHEMA },
    maxOutputTokens: 3000,
  });
  const parsed = summarySchema.parse(parseJsonLoose(text));
  const known = new Set(files.map((f) => f.path));
  return { ...parsed, changes: parsed.changes.filter((c) => known.has(c.path)).slice(0, 15) };
}

/** Free-form Markdown walkthrough for `@nazar explain` and `nazar explain`. */
export async function explainChange(
  files: ParsedFile[],
  meta: ReviewMeta,
  llm: LLMClient,
  config: NazarConfig,
): Promise<string> {
  const text = await llm.complete({
    system: explainSystemPrompt(config),
    user: summarizerUserPrompt(meta, buildDigest(files, config.chunk_tokens)),
    maxOutputTokens: 3000,
    temperature: 0.3,
  });
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
