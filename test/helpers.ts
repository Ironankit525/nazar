import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeConfig, type NazarConfig, type PartialConfig } from '../src/core/config.js';
import { parseGitDiff } from '../src/core/diff/parse.js';
import type { CompletionRequest, LLMClient } from '../src/core/llm/client.js';

/**
 * Fake credentials, assembled at runtime so the repository never contains key-shaped literals
 * (keeps secret scanners, including Nazar itself and GitHub push protection, quiet).
 */
const j = (...parts: string[]) => parts.join('');
export const FAKE = {
  github: j('gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123456789'),
  bharatcode: j('bc', '_live_', '0123456789abcdef0123456789abcdef', '_', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'),
  aws: j('AK', 'IA', 'IOSFODNN7EXAMPLF'),
  google: j('AI', 'za', 'SyD3f9kLmN0pQrStUvWxYz1234567890abc'),
  openai: j('sk', '-proj-', 'abcdefghijklmnopqrstuvwxyz0123456789ABCD'),
  anthropic: j('sk', '-ant-', 'api03-abcdefghijklmnopqrstuvwxyz'),
  razorpay: j('rzp', '_live_', 'AbCdEfGhIjKlMn12'),
  privateKey: j('-----BEGIN RSA ', 'PRIVATE KEY-----'),
  dbUrl: j('postgres://admin', ':s3cretP4ss', '@db.example.com/app'),
  generic: j('q8Z2vL0x', 'R4tN7mK1pW9s'),
  telegram: j('123456789', ':AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1'),
};

export const sampleDiff = readFileSync(join(import.meta.dirname, 'fixtures', 'sample.diff'), 'utf8')
  .replace('{{GITHUB_TOKEN}}', FAKE.github)
  .replace('{{DB_URL}}', FAKE.dbUrl);
export const sampleFiles = () => parseGitDiff(sampleDiff);

export function config(overrides: PartialConfig = {}): NazarConfig {
  return mergeConfig(overrides);
}

/** Routes each request to a handler by schema name ("review", "verdicts", "summary", or "text"). */
export class FakeLLM implements LLMClient {
  calls: CompletionRequest[] = [];
  constructor(private readonly handlers: Partial<Record<string, (req: CompletionRequest) => unknown>>) {}
  async complete(req: CompletionRequest): Promise<string> {
    this.calls.push(req);
    const handler = this.handlers[req.schema?.name ?? 'text'];
    if (!handler) throw new Error(`no fake handler for ${req.schema?.name ?? 'text'}`);
    const out = handler(req);
    return typeof out === 'string' ? out : JSON.stringify(out);
  }
}
