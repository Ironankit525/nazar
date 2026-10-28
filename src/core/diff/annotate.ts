import type { Hunk, ParsedFile } from '../types.js';

const EXT_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript (react)',
  js: 'javascript',
  jsx: 'javascript (react)',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  java: 'java',
  kt: 'kotlin',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  cs: 'c#',
  cpp: 'c++',
  cc: 'c++',
  c: 'c',
  h: 'c/c++ header',
  swift: 'swift',
  dart: 'dart',
  scala: 'scala',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  vue: 'vue',
  svelte: 'svelte',
  html: 'html',
  css: 'css',
  scss: 'scss',
  yml: 'yaml',
  yaml: 'yaml',
  json: 'json',
  toml: 'toml',
  tf: 'terraform',
  sol: 'solidity',
  lua: 'lua',
};

export function languageOf(path: string): string {
  if (/(^|\/)Dockerfile$/.test(path)) return 'dockerfile';
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[ext] ?? 'text';
}

/**
 * Renders hunks with explicit new-file line numbers so the model cites lines we can validate:
 *   L41 + added line
 *   L42   context line
 *         - deleted line
 */
export function annotateHunk(hunk: Hunk): string {
  const out = [hunk.header];
  for (const line of hunk.lines) {
    if (line.type === 'add') out.push(`L${line.newLine} + ${line.content}`);
    else if (line.type === 'context') out.push(`L${line.newLine}   ${line.content}`);
    else out.push(`      - ${line.content}`);
  }
  return out.join('\n');
}

export function annotateFile(file: ParsedFile, hunks: Hunk[] = file.hunks, fullContent?: string): string {
  const parts = [`### File: ${file.path} (${languageOf(file.path)}, ${file.status})`];
  if (file.previousPath) parts.push(`Renamed from: ${file.previousPath}`);
  if (fullContent) {
    parts.push(
      'Full new file for context (do NOT report issues on lines that are not marked +):',
      '```',
      fullContent
        .split('\n')
        .map((l, i) => `${i + 1}: ${l}`)
        .join('\n'),
      '```',
    );
  }
  parts.push('Diff:', '```diff', ...hunks.map(annotateHunk), '```');
  return parts.join('\n');
}
