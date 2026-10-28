import { describe, expect, it, vi } from 'vitest';
import { BharatCodeClient } from '../src/core/llm/client.js';
import { backoffDelay, DeadlineError, LLMError, withRetry } from '../src/core/llm/retry.js';

const noSleep = async () => {};

function response(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

const ok = (content: string, finish = 'stop') =>
  response(200, { choices: [{ message: { content }, finish_reason: finish }] });

describe('withRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        if (n++ < 2) throw new LLMError('503', 503, undefined, true);
        return 'done';
      },
      { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep },
    );
    expect(out).toBe('done');
    expect(n).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(async () => {
      throw new LLMError('401', 401, undefined, false);
    });
    await expect(
      withRetry(fn, { maxRetries: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: noSleep }),
    ).rejects.toThrow('401');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops at the deadline', async () => {
    await expect(
      withRetry(async () => 'x', { maxRetries: 1, baseDelayMs: 1, maxDelayMs: 1, deadline: Date.now() - 1 }),
    ).rejects.toBeInstanceOf(DeadlineError);
  });

  it('uses bounded exponential backoff with jitter', () => {
    expect(backoffDelay(0, 2000, 30000, () => 0)).toBe(1000);
    expect(backoffDelay(3, 2000, 30000, () => 1)).toBe(16000);
    expect(backoffDelay(10, 2000, 30000, () => 1)).toBe(30000);
  });
});

describe('BharatCodeClient', () => {
  const make = (fetchImpl: typeof fetch) =>
    new BharatCodeClient({
      apiKey: 'k',
      baseUrl: 'https://x.test/v1/',
      model: 'qwen-3.8-27b',
      fetch: fetchImpl,
      sleep: noSleep,
    });

  it('sends an OpenAI-compatible request with structured output', async () => {
    const fetchImpl = vi.fn(async () => ok('{"findings":[]}'));
    const out = await make(fetchImpl as unknown as typeof fetch).complete({
      system: 's',
      user: 'u',
      schema: { name: 'review', schema: { type: 'object' } },
    });
    expect(out).toBe('{"findings":[]}');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://x.test/v1/chat/completions');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'qwen-3.8-27b',
      response_format: { type: 'json_schema' },
      reasoning_effort: 'low',
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('retries 503 busy responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(503, { error: { message: 'busy' } }))
      .mockResolvedValueOnce(ok('hi'));
    expect(await make(fetchImpl).complete({ system: 's', user: 'u' })).toBe('hi');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('falls back to prompt-only JSON when response_format is rejected', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        response(400, { error: { message: 'response_format json_schema not supported' } }),
      )
      .mockResolvedValueOnce(ok('{"a":1}'));
    await make(fetchImpl).complete({
      system: 's',
      user: 'u',
      schema: { name: 'x', schema: { type: 'object' } },
    });
    const second = JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(second.response_format).toBeUndefined();
    expect(second.messages[0].content).toContain('Respond with ONLY a JSON object');
  });

  it('fails fast on auth errors with the request id', async () => {
    const fetchImpl = vi.fn(async () =>
      response(401, { error: { message: 'Missing BharatCode bearer token.' } }, { 'x-request-id': 'req_1' }),
    );
    await expect(
      make(fetchImpl as unknown as typeof fetch).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/401 Missing BharatCode bearer token.*req_1/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats empty truncated output as an error', async () => {
    const fetchImpl = vi.fn(async () => ok('', 'length'));
    await expect(
      make(fetchImpl as unknown as typeof fetch).complete({ system: 's', user: 'u' }),
    ).rejects.toThrow(/truncated/);
  });
});
