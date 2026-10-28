import * as core from '@actions/core';
import { SEVERITIES, type PartialConfig, type Severity } from '../core/index.js';

export interface ActionInputs {
  apiKey: string;
  githubToken: string;
  mode: 'auto' | 'pr' | 'push';
  failOn: 'none' | Severity;
  configPath: string;
  /** Only inputs the user actually set; they override the config file. */
  overrides: PartialConfig;
}

function optional(name: string): string | undefined {
  const v = core.getInput(name).trim();
  return v === '' ? undefined : v;
}

function optionalInt(name: string): number | undefined {
  const v = optional(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`Input "${name}" must be an integer, got "${v}"`);
  return n;
}

function optionalBool(name: string): boolean | undefined {
  const v = optional(name)?.toLowerCase();
  if (v === undefined) return undefined;
  if (['true', 'yes', '1', 'on'].includes(v)) return true;
  if (['false', 'no', '0', 'off'].includes(v)) return false;
  throw new Error(`Input "${name}" must be true or false, got "${v}"`);
}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback?: T): T | undefined {
  const v = optional(name)?.toLowerCase();
  if (v === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(v))
    throw new Error(`Input "${name}" must be one of ${allowed.join(', ')}, got "${v}"`);
  return v as T;
}

export function readInputs(): ActionInputs {
  const apiKey = core.getInput('bharatcode-api-key').trim();
  if (apiKey) core.setSecret(apiKey);
  const githubToken = core.getInput('github-token').trim() || process.env.GITHUB_TOKEN || '';
  if (!githubToken)
    throw new Error(
      'No GitHub token available. Pass `github-token` or keep the default `${{ github.token }}`.',
    );

  const ignore = optional('ignore')
    ?.split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    apiKey,
    githubToken,
    mode: oneOf('mode', ['auto', 'pr', 'push'] as const, 'auto')!,
    failOn: oneOf('fail-on', ['none', ...SEVERITIES] as const, 'none')!,
    configPath: optional('config-path') ?? '.github/nazar.yml',
    overrides: {
      model: optional('model'),
      base_url: optional('base-url'),
      language: oneOf('language', ['en', 'hinglish'] as const),
      max_comments: optionalInt('max-comments'),
      min_severity: oneOf('min-severity', SEVERITIES),
      verify: optionalBool('verify'),
      summary: optionalBool('summary'),
      hackathon_checks: optionalBool('hackathon-checks'),
      incremental: optionalBool('incremental'),
      ignore,
    },
  };
}
