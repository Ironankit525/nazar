export interface SecretRule {
  id: string;
  name: string;
  pattern: RegExp;
  /** Capture group holding the secret value; defaults to the whole match. */
  group?: number;
  /** Only report when the captured value looks random enough. */
  minEntropy?: number;
  /** Extra plausibility check for broad rules. */
  generic?: boolean;
}

export const SECRET_RULES: SecretRule[] = [
  {
    id: 'private-key',
    name: 'Private key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/,
  },
  { id: 'github-token', name: 'GitHub token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/ },
  { id: 'github-pat', name: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: 'anthropic-key', name: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  {
    id: 'openai-key',
    name: 'OpenAI-style API key',
    pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/,
  },
  { id: 'aws-access-key', name: 'AWS access key ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'google-api-key', name: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'slack-token', name: 'Slack token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: 'stripe-live-key', name: 'Stripe live key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}/ },
  { id: 'razorpay-key', name: 'Razorpay key', pattern: /\brzp_(?:live|test)_[A-Za-z0-9]{14,}\b/ },
  { id: 'huggingface-token', name: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{34,}\b/ },
  { id: 'groq-key', name: 'Groq API key', pattern: /\bgsk_[A-Za-z0-9]{40,}\b/ },
  { id: 'telegram-bot-token', name: 'Telegram bot token', pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  {
    id: 'discord-webhook',
    name: 'Discord webhook URL',
    pattern: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/,
  },
  {
    id: 'jwt',
    name: 'JSON Web Token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    id: 'db-url-password',
    name: 'Database URL with password',
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/[^\s:@/'"]+:([^\s@/'"]+)@/,
    group: 1,
  },
  {
    id: 'generic-secret',
    name: 'Hard-coded secret',
    pattern:
      /(?:api[_-]?key|apikey|secret|token|passwd|password|access[_-]?key|auth[_-]?key|client[_-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/i,
    group: 1,
    minEntropy: 3.5,
    generic: true,
  },
  {
    // Unquoted env-file style: API_KEY=abc123...
    id: 'env-secret',
    name: 'Hard-coded secret',
    pattern:
      /^\s*(?:export\s+)?[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD)[A-Z0-9_]*\s*=\s*([^\s"'`#]{12,})\s*$/,
    group: 1,
    minEntropy: 3,
    generic: true,
  },
];

const PLACEHOLDER =
  /x{4,}|\*{3,}|your[_-]?|example|sample|changeme|change[_-]me|placeholder|dummy|redacted|replace|insert|<[^>]*>|\$\{|\{\{|process\.env|os\.environ|getenv|import\.meta\.env|^test|fake|^password$|^secret$|^(.)\1+$/i;

export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value);
}

/** Generic matches must look like key material, not identifiers like "MY_SECRET_NAME" or sentences. */
export function looksLikeKeyMaterial(value: string): boolean {
  if (/^[A-Z][A-Z0-9_]*$/.test(value) || /^[a-z]+([_.-][a-z]+)+$/.test(value)) return false;
  return (/\d/.test(value) && /[A-Za-z]/.test(value)) || value.length >= 32;
}

export function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
