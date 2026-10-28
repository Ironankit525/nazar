import type * as github from '@actions/github';
import {
  parseConfigFile,
  type ChangedFile,
  type FileStatus,
  type Logger,
  type PartialConfig,
} from '../core/index.js';

export type Octokit = ReturnType<typeof github.getOctokit>;

export interface Repo {
  owner: string;
  repo: string;
}

const MAX_CONTEXT_BYTES = 60_000;

interface ApiFile {
  filename: string;
  status: string;
  patch?: string;
  previous_filename?: string;
}

export function toChangedFile(f: ApiFile): ChangedFile {
  return {
    path: f.filename,
    status: f.status as FileStatus,
    patch: f.patch,
    previousPath: f.previous_filename,
  };
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number }).status === 404;
}

export async function getFileText(
  octokit: Octokit,
  r: Repo,
  path: string,
  ref: string,
): Promise<string | undefined> {
  try {
    const { data } = await octokit.rest.repos.getContent({ ...r, path, ref });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return undefined;
    if (data.size > MAX_CONTEXT_BYTES) return undefined;
    return Buffer.from(data.content, 'base64').toString('utf8');
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

export async function fileExists(octokit: Octokit, r: Repo, path: string, ref: string): Promise<boolean> {
  try {
    await octokit.rest.repos.getContent({ ...r, path, ref });
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

export async function loadRepoConfig(
  octokit: Octokit,
  r: Repo,
  path: string,
  ref: string,
  log: Logger,
): Promise<PartialConfig> {
  try {
    const text = await getFileText(octokit, r, path, ref);
    if (text === undefined) return {};
    log.info(`Loaded config from ${path}`);
    return parseConfigFile(text, log);
  } catch (err) {
    log.warn(`Could not read ${path}: ${(err as Error).message}`);
    return {};
  }
}

export async function listPullRequestFiles(
  octokit: Octokit,
  r: Repo,
  pullNumber: number,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...r,
    pull_number: pullNumber,
    per_page: 100,
  });
  return files.map(toChangedFile);
}

export interface Comparison {
  status: string;
  files: ChangedFile[];
}

export async function compareCommits(
  octokit: Octokit,
  r: Repo,
  base: string,
  head: string,
): Promise<Comparison | undefined> {
  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      ...r,
      basehead: `${base}...${head}`,
      per_page: 100,
    });
    return { status: data.status, files: (data.files ?? []).map(toChangedFile) };
  } catch (err) {
    if (isNotFound(err)) return undefined; // e.g. base commit was force-pushed away
    throw err;
  }
}

export async function getCommitFiles(octokit: Octokit, r: Repo, sha: string): Promise<ChangedFile[]> {
  const { data } = await octokit.rest.repos.getCommit({ ...r, ref: sha, per_page: 100 });
  return (data.files ?? []).map(toChangedFile);
}

/** True when the commit belongs to an already-merged PR (Nazar reviewed it there). */
export async function isFromMergedPullRequest(octokit: Octokit, r: Repo, sha: string): Promise<boolean> {
  try {
    const { data } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({ ...r, commit_sha: sha });
    return data.some((pr) => pr.merged_at !== null);
  } catch {
    return false;
  }
}
