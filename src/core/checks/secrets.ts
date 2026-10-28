import type { Finding, ParsedFile } from '../types.js';
import { isPlaceholder, looksLikeKeyMaterial, SECRET_RULES, shannonEntropy } from './secret-rules.js';

export interface SecretMatch {
  ruleId: string;
  name: string;
  line: number;
  masked: string;
}

export function maskSecret(value: string): string {
  if (value.length <= 10) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** Put this in a comment on a line to silence a known false positive (like gitleaks:allow). */
export const ALLOW_MARKER = 'nazar:allow';

/** Scans one line of text. Returns at most one match (the most specific rule wins, by rule order). */
export function scanLine(text: string): { ruleId: string; name: string; value: string } | undefined {
  if (text.includes(ALLOW_MARKER)) return undefined;
  for (const rule of SECRET_RULES) {
    const m = rule.pattern.exec(text);
    if (!m) continue;
    const value = m[rule.group ?? 0] ?? m[0];
    if (rule.group !== undefined && isPlaceholder(value)) continue;
    if (rule.minEntropy !== undefined && shannonEntropy(value) < rule.minEntropy) continue;
    if (rule.generic && !looksLikeKeyMaterial(value)) continue;
    return { ruleId: rule.id, name: rule.name, value };
  }
  return undefined;
}

export function scanText(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  text.split('\n').forEach((line, i) => {
    if (line.length > 2000) return; // minified blobs
    const hit = scanLine(line);
    if (hit) matches.push({ ruleId: hit.ruleId, name: hit.name, line: i + 1, masked: maskSecret(hit.value) });
  });
  return matches;
}

/** Scans only lines added in this change and turns hits into inline findings. */
export function scanDiffForSecrets(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.type !== 'add' || line.content.length > 2000) continue;
        const hit = scanLine(line.content);
        if (!hit) continue;
        findings.push({
          path: file.path,
          line: line.newLine!,
          severity: 'critical',
          category: 'security',
          title: `${hit.name} committed to the repository`,
          explanation:
            `This line contains a likely secret (${hit.name}: \`${maskSecret(hit.value)}\`). ` +
            'Anyone who can read this repo, or its git history, can use it. Revoke/rotate the key now, ' +
            'then load it from an environment variable or a secret manager instead of hard-coding it. ' +
            'Deleting the line in a later commit does not remove it from git history.',
          confidence: 0.95,
          source: 'secrets',
        });
      }
    }
  }
  return findings;
}
