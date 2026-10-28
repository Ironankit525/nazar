import { silentLogger, type Logger } from '../types.js';
import { DeadlineError, LLMError, withRetry } from './retry.js';

export interface CompletionRequest {
  system: string;
  user: string;
  /** JSON schema for structured output. The response text is then JSON (best effort; always validate). */
  schema?: { name: string; schema: Record<string, unknown> };
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LLMClient {
  complete(req: CompletionRequest): Promise<string>;
}

export interface BharatCodeClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Absolute epoch ms; calls fail fast after it. */
  deadline?: number;
  logger?: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface ChatResponse {
  choices?: {
    message?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string;
  }[];
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Minimal OpenAI-compatible Chat Completions client for BharatCode.
 * Handles BharatCode's shared-capacity behaviour: 503 "busy" retries with backoff, request timeouts,
 * truncated output, and servers that reject `response_format`/`reasoning_effort` (we degrade and retry).
 */
export class BharatCodeClient implements LLMClient {
  private structuredOutput = true;
  private reasoningParam = true;
  private readonly log: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: BharatCodeClientOptions) {
    this.log = opts.logger ?? silentLogger;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async complete(req: CompletionRequest): Promise<string> {
    return withRetry(() => this.attempt(req), {
      maxRetries: this.opts.maxRetries ?? 5,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
      deadline: this.opts.deadline,
      sleep: this.opts.sleep,
      onRetry: (n, delay, err) =>
        this.log.info(
          `BharatCode busy or unreachable (${(err as Error).message}); retry ${n} in ${Math.round(delay / 1000)}s`,
        ),
    });
  }

  private buildBody(req: CompletionRequest): Record<string, unknown> {
    let system = req.system;
    const body: Record<string, unknown> = {
      model: this.opts.model,
      max_tokens: req.maxOutputTokens ?? 8000,
      temperature: req.temperature ?? 0.1,
    };
    if (this.reasoningParam) body.reasoning_effort = 'low';
    if (req.schema) {
      if (this.structuredOutput) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: req.schema.name, schema: req.schema.schema, strict: true },
        };
      } else {
        system += `\n\nRespond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:\n${JSON.stringify(req.schema.schema)}`;
      }
    }
    body.messages = [
      { role: 'system', content: system },
      { role: 'user', content: req.user },
    ];
    return body;
  }

  private async attempt(req: CompletionRequest): Promise<string> {
    if (this.opts.deadline !== undefined && Date.now() >= this.opts.deadline) throw new DeadlineError();
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(this.buildBody(req)),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 180_000),
    });
    const requestId = res.headers.get('x-request-id') ?? undefined;
    const raw = await res.text();

    if (!res.ok) {
      const message = extractErrorMessage(raw) ?? res.statusText;
      if (res.status === 400 && (this.structuredOutput || this.reasoningParam)) {
        // Degrade gracefully: drop optional params the server may not support, then retry once more.
        this.log.debug(`BharatCode rejected request params (${message}); retrying without optional params`);
        if (this.structuredOutput && /response_format|json_schema|schema/i.test(message))
          this.structuredOutput = false;
        else if (this.reasoningParam && /reasoning/i.test(message)) this.reasoningParam = false;
        else {
          this.structuredOutput = false;
          this.reasoningParam = false;
        }
        throw new LLMError(`400 ${message}`, 400, requestId, true, 0);
      }
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new LLMError(
        `${res.status} ${message}${requestId ? ` (x-request-id: ${requestId})` : ''}`,
        res.status,
        requestId,
        RETRYABLE_STATUS.has(res.status),
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      );
    }

    let data: ChatResponse;
    try {
      data = JSON.parse(raw) as ChatResponse;
    } catch {
      throw new LLMError('BharatCode returned a non-JSON response', res.status, requestId, true);
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    if (choice?.finish_reason === 'length' && !content.trim()) {
      throw new LLMError('Model output was truncated (finish_reason: length)', res.status, requestId, false);
    }
    if (!content.trim()) throw new LLMError('Model returned an empty response', res.status, requestId, true);
    return content;
  }
}

function extractErrorMessage(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    return parsed.error?.message ?? parsed.message;
  } catch {
    return raw.slice(0, 200) || undefined;
  }
}
