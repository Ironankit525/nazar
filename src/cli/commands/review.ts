import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import {
  BharatCodeClient,
  explainChange,
  mergeConfig,
  parseConfigFile,
  parseFile,
  runReview,
  SEVERITIES,
  severityRank,
  type Logger,
  type NazarConfig,
  type PartialConfig,
  type Severity,
} from '../../core/index.js';
import { collectDiff, readContent, repoRoot } from '../git.js';
import { cliLogger, printResult } from '../output.js';

export interface DiffOptions {
  staged?: boolean;
  base?: string;
  model?: string;
  lang?: string;
  verbose?: boolean;
}

export interface ReviewOptions extends DiffOptions {
  verify?: boolean;
  ai?: boolean;
  json?: boolean;
  failOn?: string;
  maxComments?: string;
  minSeverity?: string;
}

function requireRoot(): string {
  const root = repoRoot();
  if (!root) {
    console.error(pc.red('Not inside a git repository.'));
    process.exit(2);
  }
  return root;
}

function loadConfig(root: string, flags: PartialConfig, log: Logger): NazarConfig {
  const path = join(root, '.github', 'nazar.yml');
  const fromFile = existsSync(path) ? parseConfigFile(readFileSync(path, 'utf8'), log) : {};
  return mergeConfig(fromFile, flags);
}

function makeClient(config: NazarConfig, log: Logger): BharatCodeClient | undefined {
  const apiKey = process.env.BHARATCODE_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new BharatCodeClient({
    apiKey,
    baseUrl: process.env.BHARATCODE_BASE_URL || config.base_url,
    model: config.model,
    deadline: Date.now() + config.time_budget_seconds * 1000,
    logger: log,
  });
}

function parseSeverity(value: string | undefined, flag: string): Severity | undefined {
  if (value === undefined) return undefined;
  if (!(SEVERITIES as readonly string[]).includes(value)) {
    console.error(pc.red(`${flag} must be one of: ${SEVERITIES.join(', ')}`));
    process.exit(2);
  }
  return value as Severity;
}

function flagsToConfig(opts: ReviewOptions): PartialConfig {
  const lang = opts.lang === 'hi' ? 'hinglish' : opts.lang;
  if (lang !== undefined && lang !== 'en' && lang !== 'hinglish') {
    console.error(pc.red('--lang must be "en" or "hinglish"'));
    process.exit(2);
  }
  return {
    model: opts.model,
    language: lang as 'en' | 'hinglish' | undefined,
    verify: opts.verify === false ? false : undefined,
    max_comments: opts.maxComments ? Number(opts.maxComments) : undefined,
    min_severity: parseSeverity(opts.minSeverity, '--min-severity'),
  };
}

const NO_KEY_HINT = `Set ${pc.cyan('BHARATCODE_API_KEY')} to enable AI review (free for students: ${pc.underline('https://bharatcode.ai')}). Running secret/repo checks only.`;

export async function reviewCommand(opts: ReviewOptions): Promise<void> {
  const root = requireRoot();
  const log = opts.json ? cliLogger(false) : cliLogger(Boolean(opts.verbose));
  const config = loadConfig(root, flagsToConfig(opts), log);
  const failOn = opts.failOn === 'none' ? undefined : parseSeverity(opts.failOn ?? 'critical', '--fail-on');

  const target = collectDiff(root, { staged: opts.staged, base: opts.base });
  if (target.files.length === 0) {
    if (opts.json) console.log(JSON.stringify({ findings: [], checks: [], message: 'no changes' }));
    else console.log(pc.dim('Nothing to review: no changes found.'));
    return;
  }

  const llm = opts.ai === false ? undefined : makeClient(config, log);
  if (!llm && opts.ai !== false && !opts.json) console.error(pc.yellow(NO_KEY_HINT));
  if (!opts.json) console.error(pc.dim(`  Reviewing ${target.label} with ${config.model}…`));

  const result = await runReview({
    files: target.files,
    config,
    llm,
    getFileContent: async (path) => readContent(root, path, target.contentRef),
    fileExists: async (path) => existsSync(join(root, path)),
    logger: log,
  });

  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else printResult(result, target.label);

  if (failOn) {
    const threshold = severityRank(failOn);
    if (result.findings.some((f) => severityRank(f.severity) >= threshold)) process.exitCode = 1;
  }
}

export async function explainCommand(opts: DiffOptions): Promise<void> {
  const root = requireRoot();
  const log = cliLogger(Boolean(opts.verbose));
  const config = loadConfig(root, flagsToConfig(opts), log);
  const llm = makeClient(config, log);
  if (!llm) {
    console.error(pc.red(`BHARATCODE_API_KEY is not set. Get a free student key at https://bharatcode.ai`));
    process.exit(2);
  }
  const target = collectDiff(root, { staged: opts.staged, base: opts.base });
  const files = target.files.map(parseFile).filter((f) => f.patch);
  if (files.length === 0) {
    console.log(pc.dim('Nothing to explain: no changes found.'));
    return;
  }
  console.error(pc.dim(`  Explaining ${target.label}…`));
  console.log(`\n${await explainChange(files, {}, llm, config)}\n`);
}
