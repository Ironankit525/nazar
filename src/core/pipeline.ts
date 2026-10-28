import { checkChangedFiles, checkSubmission } from './checks/submission.js';
import { scanDiffForSecrets } from './checks/secrets.js';
import type { NazarConfig } from './config.js';
import { chunkFiles } from './diff/chunk.js';
import { filterFiles } from './diff/filter.js';
import { parseFile } from './diff/parse.js';
import type { LLMClient } from './llm/client.js';
import { DeadlineError, LLMError } from './llm/retry.js';
import { finalizeFindings } from './review/postprocess.js';
import { reviewChunk } from './review/reviewer.js';
import { summarizeChange } from './review/summarizer.js';
import { verifyFindings } from './review/verifier.js';
import {
  type AiStatus,
  type ChangedFile,
  type ChangeSummary,
  type Finding,
  type Logger,
  type ReviewMeta,
  type ReviewResult,
  silentLogger,
} from './types.js';

export interface ReviewInput {
  files: ChangedFile[];
  config: NazarConfig;
  /** Omit to run only the deterministic checks. */
  llm?: LLMClient;
  meta?: ReviewMeta;
  /** Full new content of a file, used as extra context for small files. */
  getFileContent?: (path: string) => Promise<string | undefined>;
  /** Whether a path exists at the reviewed commit (for submission checks). */
  fileExists?: (path: string) => Promise<boolean>;
  logger?: Logger;
}

/** Runs async tasks with a concurrency cap, preserving order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

const CONTEXT_FILE_LIMIT = 12;

/** Key/plan problems (401/402/403) will fail every request the same way, unlike "busy" errors. */
function isAccessError(err: unknown): boolean {
  return err instanceof LLMError && (err.status === 401 || err.status === 402 || err.status === 403);
}

function accessErrorMessage(err: LLMError): string {
  if (err.status === 402) {
    return `BharatCode API access needs an active plan: verify your student email for free access at https://bharatcode.ai/account, or subscribe to Lite. (${err.message})`;
  }
  return `BharatCode rejected the API key (${err.message}). Check the BHARATCODE_API_KEY secret.`;
}

export async function runReview(input: ReviewInput): Promise<ReviewResult> {
  const started = Date.now();
  const { config, llm } = input;
  const log = input.logger ?? silentLogger;
  const meta = input.meta ?? {};

  const parsed = input.files.map(parseFile);
  const { reviewable, skipped } = filterFiles(parsed, config);
  log.info(`Reviewing ${reviewable.length} file(s); skipped ${skipped.length}.`);

  // Deterministic checks run on every file with a diff (even ignored ones: a leaked key in dist/ still leaks).
  const secretFindings = scanDiffForSecrets(parsed.filter((f) => f.patch && f.status !== 'removed'));
  const checks = checkChangedFiles(input.files);
  if (config.hackathon_checks && input.fileExists) {
    try {
      checks.push(...(await checkSubmission(input.fileExists)));
    } catch (err) {
      log.warn(`Submission checks failed: ${(err as Error).message}`);
    }
  }

  let aiFindings: Finding[] = [];
  let aiStatus: AiStatus = 'disabled';
  let rejectedByVerifier = 0;
  let summary: ChangeSummary | undefined;
  let aiError: string | undefined;

  if (llm && reviewable.length > 0) {
    const contents = new Map<string, string>();
    if (input.getFileContent) {
      const small = reviewable.filter((f) => f.status !== 'removed').slice(0, CONTEXT_FILE_LIMIT);
      await mapLimit(small, 4, async (f) => {
        try {
          const c = await input.getFileContent!(f.path);
          if (c !== undefined) contents.set(f.path, c);
        } catch {
          // Context is optional.
        }
      });
    }

    const chunks = chunkFiles(reviewable, config.chunk_tokens, contents);
    log.info(`Split into ${chunks.length} chunk(s) for review.`);
    let failed = 0;
    const perChunk = await mapLimit(chunks, config.concurrency, async (chunk, i) => {
      if (aiError) {
        failed++; // the key was rejected; don't burn more requests
        return [];
      }
      try {
        const found = await reviewChunk(chunk, llm, config, meta, log);
        if (!config.verify || found.length === 0) return found;
        const { kept, rejected } = await verifyFindings(chunk, found, llm, config, log);
        rejectedByVerifier += rejected;
        return kept;
      } catch (err) {
        failed++;
        if (isAccessError(err)) aiError ??= accessErrorMessage(err as LLMError);
        else log.warn(`Chunk ${i + 1}/${chunks.length} could not be reviewed: ${(err as Error).message}`);
        return [];
      }
    });
    if (aiError) log.warn(aiError);
    aiFindings = perChunk.flat();
    aiStatus = failed === 0 ? 'ok' : failed === chunks.length ? 'unavailable' : 'partial';

    if (config.summary && aiStatus !== 'unavailable') {
      try {
        summary = await summarizeChange(reviewable, meta, llm, config);
      } catch (err) {
        if (!(err instanceof DeadlineError)) log.warn(`Summary failed: ${(err as Error).message}`);
      }
    }
  } else if (llm) {
    aiStatus = 'ok';
  }

  return {
    findings: finalizeFindings([...secretFindings, ...aiFindings], config),
    checks,
    summary,
    skipped,
    reviewedFiles: reviewable.map((f) => f.path),
    aiStatus,
    rejectedByVerifier,
    aiError,
    durationMs: Date.now() - started,
  };
}
