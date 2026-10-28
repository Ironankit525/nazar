import type { NazarConfig } from '../config.js';
import { type Finding, type ParsedFile, severityRank } from '../types.js';
import type { RawFinding } from './schema.js';

/** Max distance from an added line for a finding anchored on a context line. */
const CONTEXT_SLACK = 2;

export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^`|`$/g, '')
    .replace(/^\.\//, '')
    .replace(/^[ab]\//, '');
}

function newLineContent(file: ParsedFile): Map<number, string> {
  const map = new Map<number, string>();
  for (const h of file.hunks)
    for (const l of h.lines) if (l.newLine !== undefined) map.set(l.newLine, l.content);
  return map;
}

function hunkRange(file: ParsedFile, line: number): [number, number] | undefined {
  for (const h of file.hunks) {
    const nums = h.lines.filter((l) => l.newLine !== undefined).map((l) => l.newLine!);
    if (nums.length && line >= nums[0]! && line <= nums[nums.length - 1]!)
      return [nums[0]!, nums[nums.length - 1]!];
  }
  return undefined;
}

function nearAddedLine(file: ParsedFile, line: number): boolean {
  for (let d = -CONTEXT_SLACK; d <= CONTEXT_SLACK; d++) if (file.addedLines.has(line + d)) return true;
  return false;
}

export function cleanSuggestion(s: string): string {
  let out = s.replace(/^\s*```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '');
  const lines = out.split('\n');
  // Undo the diff annotation if the model copied it ("L41 + code").
  if (lines.every((l) => /^L\d+ [+ ] /.test(l) || l.trim() === '')) {
    out = lines.map((l) => l.replace(/^L\d+ [+ ] /, '')).join('\n');
  }
  return out.replace(/\s+$/, '');
}

/**
 * Turns raw model output into findings we can safely post. Drops anything anchored to a line that is not
 * part of the diff (GitHub rejects those with 422, and they are usually hallucinations).
 */
export function validateFinding(raw: RawFinding, files: Map<string, ParsedFile>): Finding | undefined {
  const file = files.get(normalizePath(raw.path));
  if (!file) return undefined;
  const line = raw.line;
  if (!file.addedLines.has(line) && !(file.commentableLines.has(line) && nearAddedLine(file, line)))
    return undefined;

  let endLine = raw.end_line ?? undefined;
  let suggestion = raw.suggestion?.trim() ? cleanSuggestion(raw.suggestion) : undefined;

  if (endLine !== undefined) {
    const range = hunkRange(file, line);
    const valid = endLine > line && range !== undefined && endLine <= range[1] && endLine - line <= 30;
    if (!valid) {
      // end_line === line just means "single line"; any other bad range makes the replacement unreliable.
      if (endLine !== line) suggestion = undefined;
      endLine = undefined;
    }
  }

  if (suggestion !== undefined) {
    const content = newLineContent(file);
    const original: string[] = [];
    for (let n = line; n <= (endLine ?? line); n++) {
      const c = content.get(n);
      if (c === undefined) {
        suggestion = undefined;
        break;
      }
      original.push(c);
    }
    if (suggestion !== undefined && original.join('\n').trim() === suggestion.trim()) suggestion = undefined;
  }

  return {
    path: file.path,
    line,
    endLine,
    severity: raw.severity,
    category: raw.category,
    title: raw.title.trim(),
    explanation: raw.explanation.trim(),
    suggestion,
    confidence: raw.confidence,
    source: 'ai',
  };
}

const sourceRank = (f: Finding) => (f.source === 'secrets' ? 1 : 0);

function compareFindings(a: Finding, b: Finding): number {
  return (
    severityRank(b.severity) - severityRank(a.severity) ||
    sourceRank(b) - sourceRank(a) ||
    b.confidence - a.confidence ||
    a.path.localeCompare(b.path) ||
    a.line - b.line
  );
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const sorted = [...findings].sort(compareFindings);
  const kept: Finding[] = [];
  for (const f of sorted) {
    const dup = kept.some((k) => {
      if (k.path !== f.path) return false;
      // The AI often re-reports a leaked key the scanner already caught; keep the scanner's version.
      if (k.source !== f.source)
        return k.line === f.line && k.category === 'security' && f.category === 'security';
      return Math.abs(k.line - f.line) <= 2 && k.category === f.category;
    });
    if (!dup) kept.push(f);
  }
  return kept;
}

export function finalizeFindings(findings: Finding[], config: NazarConfig): Finding[] {
  const minRank = severityRank(config.min_severity);
  return dedupeFindings(findings)
    .filter(
      (f) =>
        f.source === 'secrets' ||
        (severityRank(f.severity) >= minRank && f.confidence >= config.min_confidence),
    )
    .sort(compareFindings)
    .slice(0, config.max_comments);
}
