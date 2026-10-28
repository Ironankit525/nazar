export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export class DeadlineError extends Error {
  constructor() {
    super('Review time budget exhausted');
    this.name = 'DeadlineError';
  }
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Absolute epoch ms after which no new attempt starts. */
  deadline?: number;
  onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRetryable(err: unknown): boolean {
  if (err instanceof LLMError) return err.retryable;
  if (err instanceof DeadlineError) return false;
  // fetch network failures and our own timeouts
  return (
    err instanceof Error &&
    (err.name === 'TypeError' || err.name === 'AbortError' || err.name === 'TimeoutError')
  );
}

export function backoffDelay(attempt: number, base: number, max: number, random = Math.random): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2)); // "equal jitter"
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) throw new DeadlineError();
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.maxRetries || !isRetryable(err)) throw err;
      let delay = backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      if (err instanceof LLMError && err.retryAfterMs !== undefined) {
        delay = Math.min(Math.max(delay, err.retryAfterMs), opts.maxDelayMs * 2);
      }
      if (opts.deadline !== undefined && Date.now() + delay >= opts.deadline) throw err;
      opts.onRetry?.(attempt + 1, delay, err);
      await sleep(delay);
    }
  }
}
