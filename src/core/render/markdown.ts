import type { ChangeSummary, Finding, RepoCheck, ReviewResult, Severity } from '../types.js';

export const REPO_URL = 'https://github.com/Ironankit525/nazar';
export const SUMMARY_MARKER = '<!-- nazar:summary';

const SEVERITY_ICON: Record<Severity, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' };
const RISK_ICON: Record<ChangeSummary['risk'], string> = { low: '🟢', medium: '🟡', high: '🔴' };
const CHECK_ICON: Record<RepoCheck['level'], string> = { error: '❌', warning: '⚠️', info: 'ℹ️' };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Model output is untrusted: stop it from pinging people, injecting HTML, or closing our markers.
 * Inline `code` spans are kept intact.
 */
export function sanitize(text: string): string {
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/<!--|-->/g, '')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/@(?=[A-Za-z0-9-])/g, '@​'),
    )
    .join('');
}

/** For model-written Markdown we want to keep (explanations): only defuse mentions, comments and raw HTML. */
export function sanitizeMarkdown(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/<!--|-->/g, '')
            .replace(/<(\/?[A-Za-z][^>]*)>/g, '&lt;$1&gt;')
            .replace(/@(?=[A-Za-z0-9-])/g, '@​'),
    )
    .join('');
}

/** Fence long enough that the content cannot close it. */
export function fence(content: string, info = ''): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${info}\n${content}\n${ticks}`;
}

export function renderInlineComment(f: Finding): string {
  const parts = [
    `**${SEVERITY_ICON[f.severity]} ${cap(f.severity)} · ${f.category}** — ${sanitize(f.title)}`,
    '',
    sanitize(f.explanation),
  ];
  if (f.suggestion !== undefined) parts.push('', fence(f.suggestion, 'suggestion'));
  parts.push(
    '',
    `<sub>👁️ Nazar${f.source === 'ai' ? ` · confidence ${Math.round(f.confidence * 100)}%` : ' · secret scanner'}</sub>`,
  );
  return parts.join('\n');
}

/** Full finding as a standalone block (push mode, CLI-less views, comments GitHub refused inline). */
export function renderFindingBlock(f: Finding, link?: string): string {
  const loc = `${f.path}:${f.line}${f.endLine ? `-${f.endLine}` : ''}`;
  const parts = [
    `#### ${SEVERITY_ICON[f.severity]} ${sanitize(f.title)}`,
    `${link ? `[\`${loc}\`](${link})` : `\`${loc}\``} · ${cap(f.severity)} · ${f.category}`,
    '',
    sanitize(f.explanation),
  ];
  if (f.suggestion !== undefined) parts.push('', '**Suggested fix:**', fence(f.suggestion));
  return parts.join('\n');
}

export interface SummaryOptions {
  sha?: string;
  /** Builds a link to a file line, e.g. a blob URL. */
  linkFor?: (f: Finding) => string | undefined;
  /** Render every finding in full (push mode); otherwise a table pointing at inline comments. */
  detailed?: boolean;
  /** Findings GitHub would not accept inline; shown in full. */
  orphaned?: Finding[];
  incrementalFrom?: string;
}

function countBySeverity(findings: Finding[]): string {
  const counts = (['critical', 'high', 'medium', 'low'] as Severity[])
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${SEVERITY_ICON[s]} ${n} ${s}`);
  return counts.length ? counts.join(' · ') : '✅ none';
}

export function renderSummary(result: ReviewResult, opts: SummaryOptions = {}): string {
  const out: string[] = [];
  out.push(`${SUMMARY_MARKER}${opts.sha ? ` sha=${opts.sha}` : ''} -->`);
  out.push('## 👁️ Nazar Review', '');

  if (result.summary) out.push(`> ${sanitize(result.summary.overview).replace(/\n+/g, ' ')}`, '');

  const facts = [
    result.summary ? `**Risk:** ${RISK_ICON[result.summary.risk]} ${cap(result.summary.risk)}` : undefined,
    `**Findings:** ${countBySeverity(result.findings)}`,
    `**Files reviewed:** ${result.reviewedFiles.length}`,
  ].filter(Boolean);
  out.push(facts.join(' &nbsp;|&nbsp; '), '');
  if (opts.incrementalFrom)
    out.push(
      `<sub>Incremental review of new commits since \`${opts.incrementalFrom.slice(0, 7)}\`.</sub>`,
      '',
    );

  if (result.aiStatus === 'unavailable') {
    out.push(
      '> [!WARNING]',
      '> AI review was skipped because BharatCode was busy or unreachable. Secret and repo checks still ran. Re-run the job to retry.',
      '',
    );
  } else if (result.aiStatus === 'partial') {
    out.push(
      '> [!NOTE]',
      '> Some files could not be AI-reviewed because BharatCode was busy. Re-run the job to review them.',
      '',
    );
  }

  if (result.checks.length) {
    out.push('### 🔐 Repository checks');
    for (const c of result.checks) out.push(`- ${CHECK_ICON[c.level]} ${c.message}`);
    out.push('');
  }

  if (result.findings.length) {
    if (opts.detailed) {
      out.push('### Findings', '');
      for (const f of result.findings) out.push(renderFindingBlock(f, opts.linkFor?.(f)), '');
    } else {
      out.push('### Findings', '', '| | Location | Issue |', '|---|---|---|');
      for (const f of result.findings) {
        const loc = `${f.path}:${f.line}`;
        const link = opts.linkFor?.(f);
        const issue = sanitize(f.title).replace(/\|/g, '\\|');
        out.push(
          `| ${SEVERITY_ICON[f.severity]} | ${link ? `[\`${loc}\`](${link})` : `\`${loc}\``} | ${issue} |`,
        );
      }
      out.push('');
    }
  } else if (result.aiStatus === 'ok' && result.reviewedFiles.length) {
    out.push('✅ No issues found in the reviewed changes. Nice work!', '');
  }

  if (opts.orphaned?.length) {
    out.push('<details><summary>Findings outside the diff view</summary>', '');
    for (const f of opts.orphaned) out.push(renderFindingBlock(f, opts.linkFor?.(f)), '');
    out.push('</details>', '');
  }

  if (result.summary?.changes.length) {
    out.push('<details><summary>📂 Changes walkthrough</summary>', '', '| File | Change |', '|---|---|');
    for (const c of result.summary.changes)
      out.push(`| \`${c.path}\` | ${sanitize(c.description).replace(/\|/g, '\\|')} |`);
    out.push('', '</details>', '');
  }

  if (result.skipped.length) {
    out.push(`<details><summary>Skipped files (${result.skipped.length})</summary>`, '');
    for (const s of result.skipped.slice(0, 50)) out.push(`- \`${s.path}\` — ${s.reason}`);
    if (result.skipped.length > 50) out.push(`- …and ${result.skipped.length - 50} more`);
    out.push('', '</details>', '');
  }

  const verified = result.rejectedByVerifier
    ? ` · verifier removed ${result.rejectedByVerifier} likely false positive(s)`
    : '';
  out.push(
    '---',
    `<sub>Free AI code review by [Nazar](${REPO_URL}) · powered by [BharatCode](https://bharatcode.ai)${verified} · ⭐ [Star Nazar](${REPO_URL}) if this helped</sub>`,
  );
  return out.join('\n');
}

export function parseSummarySha(body: string): string | undefined {
  return /<!-- nazar:summary sha=([0-9a-f]{7,40}) -->/.exec(body)?.[1];
}
