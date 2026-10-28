import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { SEVERITIES, type Logger } from './types.js';

export const DEFAULT_IGNORE = [
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/bun.lock',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/uv.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap',
  '**/*.ipynb',
  '**/*.svg',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/*.generated.*',
  '**/*.pb.go',
];

export const configSchema = z.object({
  model: z.string().min(1),
  base_url: z.string().url(),
  language: z.enum(['en', 'hinglish']),
  max_comments: z.number().int().min(0).max(50),
  min_severity: z.enum(SEVERITIES),
  min_confidence: z.number().min(0).max(1),
  focus: z.array(z.string()),
  ignore: z.array(z.string()),
  instructions: z.string(),
  verify: z.boolean(),
  summary: z.boolean(),
  hackathon_checks: z.boolean(),
  max_files: z.number().int().min(1),
  max_lines: z.number().int().min(1),
  chunk_tokens: z.number().int().min(1000),
  concurrency: z.number().int().min(1).max(8),
  skip_drafts: z.boolean(),
  incremental: z.boolean(),
  time_budget_seconds: z.number().int().min(30),
});

export type NazarConfig = z.infer<typeof configSchema>;

export const DEFAULT_CONFIG: NazarConfig = {
  model: 'qwen-3.8-27b',
  base_url: 'https://bharatcode.ai/api/model/v1',
  language: 'en',
  max_comments: 10,
  min_severity: 'medium',
  min_confidence: 0.6,
  focus: [],
  ignore: [],
  instructions: '',
  verify: true,
  summary: true,
  hackathon_checks: true,
  max_files: 40,
  max_lines: 4000,
  chunk_tokens: 16000,
  concurrency: 2,
  skip_drafts: true,
  incremental: true,
  time_budget_seconds: 480,
};

export type PartialConfig = Partial<NazarConfig>;

/**
 * Parses a user's .github/nazar.yml. Invalid keys are dropped with a warning instead of failing the run,
 * so a typo in config never blocks someone's CI.
 */
export function parseConfigFile(text: string, log: Logger): PartialConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    log.warn(`Could not parse Nazar config file: ${(err as Error).message}. Using defaults.`);
    return {};
  }
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    log.warn('Nazar config file must be a YAML mapping. Using defaults.');
    return {};
  }
  const out: Record<string, unknown> = {};
  const shape = configSchema.shape as Record<string, z.ZodType>;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[key];
    if (!field) {
      log.warn(`Unknown Nazar config key "${key}" ignored.`);
      continue;
    }
    const parsed = field.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else log.warn(`Invalid value for "${key}" in Nazar config ignored: ${parsed.error.issues[0]?.message}`);
  }
  return out as PartialConfig;
}

/** Later layers win: defaults < config file < explicit inputs/flags. */
export function mergeConfig(...layers: PartialConfig[]): NazarConfig {
  const merged = { ...DEFAULT_CONFIG };
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
    }
  }
  return configSchema.parse(merged);
}
