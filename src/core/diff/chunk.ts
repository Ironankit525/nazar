import { estimateTokens } from '../llm/tokens.js';
import type { Hunk, ParsedFile } from '../types.js';
import { annotateFile } from './annotate.js';

export interface ChunkPart {
  file: ParsedFile;
  hunks: Hunk[];
  text: string;
}

export interface Chunk {
  parts: ChunkPart[];
  text: string;
  tokens: number;
}

const MAX_CONTEXT_LINES = 400;

/**
 * Packs files into chunks under a token budget. A file is only split (by hunk) when it alone exceeds the
 * budget, so the model normally sees whole-file diffs.
 */
export function chunkFiles(
  files: ParsedFile[],
  budgetTokens: number,
  contents: Map<string, string> = new Map(),
): Chunk[] {
  const parts: ChunkPart[] = [];
  for (const file of files) {
    let content = contents.get(file.path);
    if (content && content.split('\n').length > MAX_CONTEXT_LINES) content = undefined;
    const whole = annotateFile(file, file.hunks, content);
    if (estimateTokens(whole) <= budgetTokens) {
      parts.push({ file, hunks: file.hunks, text: whole });
      continue;
    }
    // Too big: split into hunk groups without full-file context.
    let group: Hunk[] = [];
    for (const hunk of file.hunks) {
      const candidate = [...group, hunk];
      if (group.length > 0 && estimateTokens(annotateFile(file, candidate)) > budgetTokens) {
        parts.push({ file, hunks: group, text: annotateFile(file, group) });
        group = [hunk];
      } else {
        group = candidate;
      }
    }
    if (group.length > 0) parts.push({ file, hunks: group, text: annotateFile(file, group) });
  }

  const chunks: Chunk[] = [];
  let current: ChunkPart[] = [];
  let tokens = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ parts: current, text: current.map((p) => p.text).join('\n\n'), tokens });
    current = [];
    tokens = 0;
  };
  for (const part of parts) {
    const t = estimateTokens(part.text);
    if (tokens + t > budgetTokens) flush();
    current.push(part);
    tokens += t;
  }
  flush();
  return chunks;
}
