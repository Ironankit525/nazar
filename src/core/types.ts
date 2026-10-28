export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ['bug', 'security', 'performance', 'error-handling', 'maintainability'] as const;
export type Category = (typeof CATEGORIES)[number];

export type FileStatus = 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

/** A changed file as delivered by GitHub (pulls.listFiles / compareCommits) or by `git diff`. */
export interface ChangedFile {
  path: string;
  status: FileStatus;
  /** Unified diff hunks for this file (no `diff --git` header). Missing for binary/huge files. */
  patch?: string;
  previousPath?: string;
}

export interface DiffLine {
  type: 'add' | 'del' | 'context';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedFile extends ChangedFile {
  hunks: Hunk[];
  /** New-file line numbers of added lines. */
  addedLines: Set<number>;
  /** New-file line numbers GitHub accepts review comments on (added + context). */
  commentableLines: Set<number>;
  additions: number;
  deletions: number;
}

export interface Finding {
  path: string;
  line: number;
  endLine?: number;
  severity: Severity;
  category: Category;
  title: string;
  explanation: string;
  suggestion?: string;
  confidence: number;
  source: 'ai' | 'secrets';
}

export interface RepoCheck {
  id: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  path?: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ChangeSummary {
  overview: string;
  risk: 'low' | 'medium' | 'high';
  changes: { path: string; description: string }[];
}

export type AiStatus = 'ok' | 'partial' | 'unavailable' | 'disabled';

export interface ReviewResult {
  findings: Finding[];
  checks: RepoCheck[];
  summary?: ChangeSummary;
  skipped: SkippedFile[];
  reviewedFiles: string[];
  aiStatus: AiStatus;
  /** Findings dropped by the verifier pass. */
  rejectedByVerifier: number;
  /** Set when the API key or plan was rejected, so users see the real reason instead of "busy". */
  aiError?: string;
  durationMs: number;
}

export interface ReviewMeta {
  title?: string;
  description?: string;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  debug(msg: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, debug() {} };

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}
