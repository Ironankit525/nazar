import type { NazarConfig } from '../config.js';
import type { Chunk } from '../diff/chunk.js';
import type { LLMClient } from '../llm/client.js';
import { parseJsonLoose } from '../llm/json.js';
import type { Finding, Logger, ParsedFile, ReviewMeta } from '../types.js';
import { validateFinding } from './postprocess.js';
import { reviewerSystemPrompt, reviewerUserPrompt } from './prompts.js';
import { REVIEW_JSON_SCHEMA, rawFindingSchema } from './schema.js';

export function extractArray(data: unknown, key: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** Pass 1: ask the model for findings on one chunk, then keep only well-formed findings on real diff lines. */
export async function reviewChunk(
  chunk: Chunk,
  llm: LLMClient,
  config: NazarConfig,
  meta: ReviewMeta,
  log: Logger,
): Promise<Finding[]> {
  const text = await llm.complete({
    system: reviewerSystemPrompt(config),
    user: reviewerUserPrompt(chunk.text, meta),
    schema: { name: 'review', schema: REVIEW_JSON_SCHEMA },
    maxOutputTokens: 8000,
  });
  const items = extractArray(parseJsonLoose(text), 'findings');
  const files = new Map<string, ParsedFile>(chunk.parts.map((p) => [p.file.path, p.file]));
  const findings: Finding[] = [];
  let dropped = 0;
  for (const item of items) {
    const parsed = rawFindingSchema.safeParse(item);
    const finding = parsed.success ? validateFinding(parsed.data, files) : undefined;
    if (finding) findings.push(finding);
    else dropped++;
  }
  if (dropped) log.debug(`Dropped ${dropped} malformed or out-of-diff finding(s)`);
  return findings;
}
