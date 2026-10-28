import type { NazarConfig } from '../config.js';
import type { Chunk } from '../diff/chunk.js';
import type { LLMClient } from '../llm/client.js';
import { parseJsonLoose } from '../llm/json.js';
import type { Finding, Logger } from '../types.js';
import { extractArray } from './reviewer.js';
import { verifierSystemPrompt, verifierUserPrompt } from './prompts.js';
import { VERIFY_JSON_SCHEMA, verdictSchema } from './schema.js';

export interface VerifyResult {
  kept: Finding[];
  rejected: number;
}

/**
 * Pass 2: a second, sceptical call that drops false positives. Flat-rate pricing is what makes this
 * extra call affordable on every review. Fails open: if verification errors, findings are kept.
 */
export async function verifyFindings(
  chunk: Chunk,
  findings: Finding[],
  llm: LLMClient,
  config: NazarConfig,
  log: Logger,
): Promise<VerifyResult> {
  if (findings.length === 0) return { kept: [], rejected: 0 };
  const payload = findings.map((f, id) => ({
    id,
    path: f.path,
    line: f.line,
    severity: f.severity,
    category: f.category,
    title: f.title,
    explanation: f.explanation,
  }));
  try {
    const text = await llm.complete({
      system: verifierSystemPrompt(config),
      user: verifierUserPrompt(chunk.text, JSON.stringify(payload, null, 2)),
      schema: { name: 'verdicts', schema: VERIFY_JSON_SCHEMA },
      maxOutputTokens: 4000,
    });
    const keepIds = new Set<number>();
    let valid = 0;
    for (const item of extractArray(parseJsonLoose(text), 'verdicts')) {
      const v = verdictSchema.safeParse(item);
      if (!v.success || !findings[v.data.id]) continue;
      valid++;
      if (v.data.keep) keepIds.add(v.data.id);
      else log.debug(`Verifier rejected "${findings[v.data.id]!.title}": ${v.data.reason ?? ''}`);
    }
    // A usable answer must endorse a finding explicitly; an unusable answer keeps everything (fail open).
    if (valid === 0) {
      log.warn('Verifier returned no usable verdicts, keeping unverified findings.');
      return { kept: findings, rejected: 0 };
    }
    const kept = findings.filter((_, i) => keepIds.has(i));
    return { kept, rejected: findings.length - kept.length };
  } catch (err) {
    log.warn(`Verifier pass failed, keeping unverified findings: ${(err as Error).message}`);
    return { kept: findings, rejected: 0 };
  }
}
