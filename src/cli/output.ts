import pc from 'picocolors';
import type { Finding, Logger, RepoCheck, ReviewResult, Severity } from '../core/index.js';

const SEVERITY_STYLE: Record<Severity, (s: string) => string> = {
  critical: (s) => pc.bold(pc.red(s)),
  high: (s) => pc.red(s),
  medium: (s) => pc.yellow(s),
  low: (s) => pc.blue(s),
};

const CHECK_STYLE: Record<RepoCheck['level'], string> = {
  error: pc.red('✖'),
  warning: pc.yellow('▲'),
  info: pc.blue('ℹ'),
};

/** Strips Markdown backticks for terminal display. */
const plain = (s: string) => s.replace(/`([^`]*)`/g, (_, code: string) => pc.cyan(code));

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
}

export function cliLogger(verbose: boolean): Logger {
  return {
    info: (m) => console.error(pc.dim(`  ${m}`)),
    warn: (m) => console.error(pc.yellow(`  ⚠ ${m}`)),
    debug: (m) => {
      if (verbose) console.error(pc.dim(`  · ${m}`));
    },
  };
}

function printFinding(f: Finding): void {
  const width = Math.min(process.stdout.columns || 100, 110) - 10;
  const loc = pc.dim(`${f.line}${f.endLine ? `-${f.endLine}` : ''}`.padStart(6));
  console.log(
    `${loc}  ${SEVERITY_STYLE[f.severity](f.severity.toUpperCase())} ${pc.dim(f.category)}  ${pc.bold(f.title)}`,
  );
  console.log(pc.gray(wrap(plain(f.explanation), width, '        ')));
  if (f.suggestion !== undefined) {
    console.log(pc.dim('        suggested fix:'));
    for (const l of f.suggestion.split('\n')) console.log(pc.green(`        + ${l}`));
  }
  console.log();
}

export function printChecks(checks: RepoCheck[]): void {
  if (!checks.length) return;
  console.log(pc.bold('Repository checks'));
  for (const c of checks) console.log(`  ${CHECK_STYLE[c.level]} ${plain(c.message)}`);
  console.log();
}

export function printResult(result: ReviewResult, label: string): void {
  console.log();
  console.log(
    `${pc.bold('👁  Nazar')} ${pc.dim(`· ${label} · ${result.reviewedFiles.length} file(s) reviewed`)}`,
  );
  console.log();

  if (result.summary) {
    const width = Math.min(process.stdout.columns || 100, 110) - 4;
    console.log(wrap(result.summary.overview, width, '  '));
    console.log(pc.dim(`  Risk: ${result.summary.risk}`));
    console.log();
  }

  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) byFile.set(f.path, [...(byFile.get(f.path) ?? []), f]);
  for (const [path, findings] of byFile) {
    console.log(pc.underline(path));
    findings.sort((a, b) => a.line - b.line).forEach(printFinding);
  }

  printChecks(result.checks);

  if (result.aiStatus === 'unavailable')
    console.log(pc.yellow('AI review skipped: BharatCode was busy or unreachable. Try again in a minute.\n'));
  else if (result.aiStatus === 'partial')
    console.log(pc.yellow('Some files were not AI-reviewed because BharatCode was busy.\n'));
  else if (result.aiStatus === 'disabled')
    console.log(pc.dim('AI review disabled (no BHARATCODE_API_KEY). Only secret/repo checks ran.\n'));

  const total = result.findings.length;
  const verified = result.rejectedByVerifier
    ? pc.dim(` (verifier removed ${result.rejectedByVerifier} false positive(s))`)
    : '';
  if (total === 0 && result.aiStatus === 'ok') console.log(pc.green('✔ No issues found.') + verified);
  else
    console.log(
      `${pc.bold(String(total))} finding(s)${verified} ${pc.dim(`in ${(result.durationMs / 1000).toFixed(1)}s`)}`,
    );
  if (result.skipped.length)
    console.log(
      pc.dim(`${result.skipped.length} file(s) skipped (lockfiles, generated, binary or over limits).`),
    );
  console.log();
}
