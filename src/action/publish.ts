import { renderInlineComment, SUMMARY_MARKER, type Finding, type Logger } from '../core/index.js';
import type { Octokit, Repo } from './github.js';

const MAX_BODY = 65_000;

export function truncateBody(body: string): string {
  return body.length <= MAX_BODY ? body : `${body.slice(0, MAX_BODY)}\n\n…(truncated)`;
}

export function blobLink(serverUrl: string, r: Repo, sha: string, f: Finding): string {
  const path = f.path.split('/').map(encodeURIComponent).join('/');
  return `${serverUrl}/${r.owner}/${r.repo}/blob/${sha}/${path}#L${f.line}${f.endLine ? `-L${f.endLine}` : ''}`;
}

export interface StickyComment {
  id: number;
  body: string;
}

export async function findStickyComment(
  octokit: Octokit,
  r: Repo,
  issueNumber: number,
): Promise<StickyComment | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    ...r,
    issue_number: issueNumber,
    per_page: 100,
  });
  const mine = comments.filter((c) => c.body?.includes(SUMMARY_MARKER));
  const last = mine[mine.length - 1];
  return last ? { id: last.id, body: last.body ?? '' } : undefined;
}

export async function upsertStickyComment(
  octokit: Octokit,
  r: Repo,
  issueNumber: number,
  body: string,
  existing?: StickyComment,
): Promise<void> {
  if (existing)
    await octokit.rest.issues.updateComment({ ...r, comment_id: existing.id, body: truncateBody(body) });
  else await octokit.rest.issues.createComment({ ...r, issue_number: issueNumber, body: truncateBody(body) });
}

function toReviewComment(f: Finding) {
  return {
    path: f.path,
    line: f.endLine ?? f.line,
    side: 'RIGHT' as const,
    ...(f.endLine ? { start_line: f.line, start_side: 'RIGHT' as const } : {}),
    body: renderInlineComment(f),
  };
}

/** Every inline comment ends with this signature; its first line identifies the finding. */
const INLINE_SIGNATURE = '<sub>👁️ Nazar';
const headline = (body: string) => body.split('\n')[0]!.trim();

export interface ExistingComment {
  path: string;
  line?: number | null;
  original_line?: number | null;
  body: string;
}

/** Drops findings Nazar already posted on this PR (re-runs, `@nazar review`), matched by file, line and headline. */
export function filterAlreadyPosted(findings: Finding[], existing: ExistingComment[]): Finding[] {
  const seen = new Set(
    existing
      .filter((c) => c.body.includes(INLINE_SIGNATURE))
      .map((c) => `${c.path}:${c.line ?? c.original_line}:${headline(c.body)}`),
  );
  return findings.filter(
    (f) => !seen.has(`${f.path}:${f.endLine ?? f.line}:${headline(renderInlineComment(f))}`),
  );
}

export interface ReviewPostResult {
  posted: Finding[];
  orphaned: Finding[];
}

/**
 * Posts all findings as one PR review (one notification). If GitHub rejects the batch (usually one bad
 * line anchor), falls back to posting comments one by one and returns the ones that still fail.
 */
export async function postReview(
  octokit: Octokit,
  r: Repo,
  pullNumber: number,
  commitId: string,
  findings: Finding[],
  log: Logger,
): Promise<ReviewPostResult> {
  if (findings.length === 0) return { posted: [], orphaned: [] };
  try {
    const existing = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
      ...r,
      pull_number: pullNumber,
      per_page: 100,
    });
    const fresh = filterAlreadyPosted(findings, existing);
    if (fresh.length < findings.length)
      log.info(`Skipping ${findings.length - fresh.length} comment(s) already posted.`);
    findings = fresh;
  } catch (err) {
    log.debug(`Could not list existing review comments: ${(err as Error).message}`);
  }
  if (findings.length === 0) return { posted: [], orphaned: [] };
  const body = `👁️ **Nazar** found ${findings.length} issue${findings.length === 1 ? '' : 's'} worth a look. Details are inline; the summary comment has the full picture.`;
  try {
    await octokit.rest.pulls.createReview({
      ...r,
      pull_number: pullNumber,
      commit_id: commitId,
      event: 'COMMENT',
      body,
      comments: findings.map(toReviewComment),
    });
    return { posted: findings, orphaned: [] };
  } catch (err) {
    log.warn(`Batch review was rejected (${(err as Error).message}); posting comments individually.`);
  }
  const posted: Finding[] = [];
  const orphaned: Finding[] = [];
  for (const f of findings) {
    try {
      await octokit.rest.pulls.createReviewComment({
        ...r,
        pull_number: pullNumber,
        commit_id: commitId,
        ...toReviewComment(f),
      });
      posted.push(f);
    } catch (err) {
      log.debug(`Could not post inline comment on ${f.path}:${f.line}: ${(err as Error).message}`);
      orphaned.push(f);
    }
  }
  return { posted, orphaned };
}

export async function postCommitComment(octokit: Octokit, r: Repo, sha: string, body: string): Promise<void> {
  await octokit.rest.repos.createCommitComment({ ...r, commit_sha: sha, body: truncateBody(body) });
}
