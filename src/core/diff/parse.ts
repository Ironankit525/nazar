import type { ChangedFile, FileStatus, Hunk, ParsedFile } from '../types.js';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parses the hunk section of a unified diff (what GitHub returns as `patch`). */
export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[3]);
      current = { header: raw, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    const marker = raw[0];
    const content = raw.slice(1).replace(/\r$/, '');
    if (marker === '+') {
      current.lines.push({ type: 'add', content, newLine: newLine++ });
    } else if (marker === '-') {
      current.lines.push({ type: 'del', content, oldLine: oldLine++ });
    } else if (marker === ' ') {
      current.lines.push({ type: 'context', content, oldLine: oldLine++, newLine: newLine++ });
    } else if (raw === '') {
      // Trailing newline at end of patch, or a blank context line some tools emit without the leading space.
      continue;
    }
    // '\ No newline at end of file' and anything else is ignored.
  }
  return hunks;
}

export function parseFile(file: ChangedFile): ParsedFile {
  const hunks = file.patch ? parsePatch(file.patch) : [];
  const addedLines = new Set<number>();
  const commentableLines = new Set<number>();
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') {
        additions++;
        addedLines.add(line.newLine!);
        commentableLines.add(line.newLine!);
      } else if (line.type === 'context') {
        commentableLines.add(line.newLine!);
      } else {
        deletions++;
      }
    }
  }
  return { ...file, hunks, addedLines, commentableLines, additions, deletions };
}

function stripPrefix(p: string): string {
  return p.replace(/^"|"$/g, '').replace(/^[ab]\//, '');
}

/** Parses full `git diff` output (with `diff --git` headers) into ChangedFiles. Used by the CLI and evals. */
export function parseGitDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const sections = diff.split(/^diff --git /m).slice(1);
  for (const section of sections) {
    const lines = section.split('\n');
    const headerMatch = /^(?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(lines[0] ?? '');
    let oldPath = headerMatch?.[1];
    let newPath = headerMatch?.[2];
    let status: FileStatus = 'modified';
    let binary = false;
    let i = 1;
    for (; i < lines.length; i++) {
      const l = lines[i]!;
      if (l.startsWith('@@')) break;
      if (l.startsWith('new file mode')) status = 'added';
      else if (l.startsWith('deleted file mode')) status = 'removed';
      else if (l.startsWith('rename from ')) {
        oldPath = l.slice('rename from '.length);
        status = 'renamed';
      } else if (l.startsWith('rename to ')) newPath = l.slice('rename to '.length);
      else if (l.startsWith('--- ') && l !== '--- /dev/null') oldPath = stripPrefix(l.slice(4));
      else if (l.startsWith('+++ ') && l !== '+++ /dev/null') newPath = stripPrefix(l.slice(4));
      else if (l.startsWith('Binary files') || l.startsWith('GIT binary patch')) binary = true;
    }
    const path = status === 'removed' ? oldPath : newPath;
    if (!path) continue;
    const patch = binary ? undefined : lines.slice(i).join('\n').trimEnd() || undefined;
    files.push({
      path,
      status,
      patch,
      previousPath: status === 'renamed' ? oldPath : undefined,
    });
  }
  return files;
}
