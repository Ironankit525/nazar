import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  BharatCodeClient,
  explainChange,
  mergeConfig,
  parseFile,
  parseSummarySha,
  REPO_URL,
  renderSummary,
  runReview,
  sanitizeMarkdown,
  severityRank,
  type ChangedFile,
  type Logger,
  type NazarConfig,
  type ReviewResult,
} from '../core/index.js';
import {
  compareCommits,
  fileExists,
  getCommitFiles,
  getFileText,
  isFromMergedPullRequest,
  listPullRequestFiles,
  loadRepoConfig,
  type Octokit,
  type Repo,
} from './github.js';
import { readInputs, type ActionInputs } from './inputs.js';
import {
  blobLink,
  findStickyComment,
  postCommitComment,
  postReview,
  truncateBody,
  upsertStickyComment,
} from './publish.js';

const ZERO_SHA = /^0+$/;
const COMMAND = /^\s*[@/]nazar\s+(explain|review)\b/i;
const TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

const log: Logger = { info: core.info, warn: core.warning, debug: core.debug };

interface RunContext {
  inputs: ActionInputs;
  octokit: Octokit;
  repo: Repo;
  serverUrl: string;
}

function makeClient(inputs: ActionInputs, config: NazarConfig): BharatCodeClient | undefined {
  if (!inputs.apiKey) {
    core.notice(
      'No BharatCode API key available (missing secret, or a PR from a fork). Running secret and repo checks only. ' +
        'Add a BHARATCODE_API_KEY repository secret to enable AI review.',
    );
    return undefined;
  }
  return new BharatCodeClient({
    apiKey: inputs.apiKey,
    baseUrl: config.base_url,
    model: config.model,
    deadline: Date.now() + config.time_budget_seconds * 1000,
    logger: log,
  });
}

function setOutputs(result: ReviewResult): void {
  core.setOutput('findings-count', result.findings.length);
  core.setOutput('critical-count', result.findings.filter((f) => f.severity === 'critical').length);
  core.setOutput('ai-status', result.aiStatus);
}

function enforceFailOn(inputs: ActionInputs, result: ReviewResult): void {
  if (inputs.failOn === 'none') return;
  const threshold = severityRank(inputs.failOn);
  const blocking = result.findings.filter((f) => severityRank(f.severity) >= threshold);
  const errors = result.checks.filter((c) => c.level === 'error');
  if (blocking.length || (threshold >= severityRank('high') && errors.length)) {
    core.setFailed(
      `Nazar found ${blocking.length} finding(s) at or above "${inputs.failOn}" and ${errors.length} failing repo check(s).`,
    );
  }
}

async function writeJobSummary(body: string): Promise<void> {
  try {
    await core.summary.addRaw(body).write();
  } catch (err) {
    core.debug(`Could not write job summary: ${(err as Error).message}`);
  }
}

async function reviewPullRequest(ctx: RunContext, opts: { forceFull?: boolean } = {}): Promise<void> {
  const { octokit, repo, inputs } = ctx;
  const payload = github.context.payload;
  const prNumber: number | undefined = payload.pull_request?.number ?? payload.issue?.number;
  if (!prNumber) throw new Error('Could not determine the pull request number for this event.');
  const { data: pr } = await octokit.rest.pulls.get({ ...repo, pull_number: prNumber });
  const headSha = pr.head.sha;

  const config = mergeConfig(
    await loadRepoConfig(octokit, repo, inputs.configPath, headSha, log),
    inputs.overrides,
  );
  if (pr.draft && config.skip_drafts && !opts.forceFull) {
    core.info('Pull request is a draft; skipping (set skip_drafts: false to review drafts).');
    return;
  }
  if (pr.state !== 'open') {
    core.info('Pull request is not open; skipping.');
    return;
  }

  const sticky = await findStickyComment(octokit, repo, prNumber);
  const lastSha = sticky ? parseSummarySha(sticky.body) : undefined;
  let files: ChangedFile[] | undefined;
  let incrementalFrom: string | undefined;
  if (config.incremental && !opts.forceFull && lastSha && lastSha !== headSha) {
    const cmp = await compareCommits(octokit, repo, lastSha, headSha);
    if (cmp?.status === 'ahead') {
      files = cmp.files;
      incrementalFrom = lastSha;
      core.info(`Incremental review: ${files.length} file(s) changed since ${lastSha.slice(0, 7)}.`);
    }
  }
  files ??= await listPullRequestFiles(octokit, repo, prNumber);
  if (files.length === 0) {
    core.info('No changed files to review.');
    return;
  }

  const result = await runReview({
    files,
    config,
    llm: makeClient(inputs, config),
    meta: { title: pr.title, description: pr.body ?? undefined },
    getFileContent: (path) => getFileText(octokit, repo, path, headSha),
    fileExists: (path) => fileExists(octokit, repo, path, headSha),
    logger: log,
  });

  const { orphaned } = await postReview(octokit, repo, prNumber, headSha, result.findings, log);
  const body = renderSummary(result, {
    sha: headSha,
    linkFor: (f) => blobLink(ctx.serverUrl, repo, headSha, f),
    orphaned,
    incrementalFrom,
  });
  await upsertStickyComment(octokit, repo, prNumber, body, sticky);
  await writeJobSummary(body);
  setOutputs(result);
  core.info(
    `Done in ${Math.round(result.durationMs / 1000)}s: ${result.findings.length} finding(s), AI status ${result.aiStatus}.`,
  );
  enforceFailOn(inputs, result);
}

async function reviewPush(ctx: RunContext): Promise<void> {
  const { octokit, repo, inputs } = ctx;
  const payload = github.context.payload;
  if (payload.deleted) {
    core.info('Branch deletion; nothing to review.');
    return;
  }
  const after: string = payload.after ?? github.context.sha;
  const before: string | undefined = payload.before;

  if (await isFromMergedPullRequest(octokit, repo, after)) {
    core.info('This push comes from a merged pull request that Nazar already reviewed; skipping.');
    return;
  }

  const config = mergeConfig(
    await loadRepoConfig(octokit, repo, inputs.configPath, after, log),
    inputs.overrides,
  );
  let files: ChangedFile[] | undefined;
  if (before && !ZERO_SHA.test(before)) files = (await compareCommits(octokit, repo, before, after))?.files;
  files ??= await getCommitFiles(octokit, repo, after);
  if (files.length === 0) {
    core.info('No changed files to review.');
    return;
  }

  const message: string = payload.head_commit?.message ?? '';
  const [title, ...rest] = message.split('\n');
  const result = await runReview({
    files,
    config,
    llm: makeClient(inputs, config),
    meta: { title, description: rest.join('\n').trim() || undefined },
    getFileContent: (path) => getFileText(octokit, repo, path, after),
    fileExists: (path) => fileExists(octokit, repo, path, after),
    logger: log,
  });

  const body = renderSummary(result, {
    sha: after,
    detailed: true,
    linkFor: (f) => blobLink(ctx.serverUrl, repo, after, f),
  });
  // Only comment on the commit when there is something to act on; clean pushes just get a job summary.
  if (result.findings.length || result.checks.some((c) => c.level !== 'info')) {
    await postCommitComment(octokit, repo, after, body);
  }
  await writeJobSummary(body);
  setOutputs(result);
  core.info(
    `Done in ${Math.round(result.durationMs / 1000)}s: ${result.findings.length} finding(s), AI status ${result.aiStatus}.`,
  );
  enforceFailOn(inputs, result);
}

async function handleCommand(ctx: RunContext): Promise<void> {
  const { octokit, repo, inputs } = ctx;
  const { comment, issue } = github.context.payload;
  if (!issue?.pull_request || !comment) return;
  const match = COMMAND.exec(comment.body ?? '');
  if (!match) return;
  if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
    core.info(`Ignoring command from ${comment.user?.login} (${comment.author_association}).`);
    return;
  }
  await octokit.rest.reactions
    .createForIssueComment({ ...repo, comment_id: comment.id, content: 'eyes' })
    .catch(() => {});

  const command = match[1]!.toLowerCase();
  if (command === 'review') {
    await reviewPullRequest(ctx, { forceFull: true });
    return;
  }

  const { data: pr } = await octokit.rest.pulls.get({ ...repo, pull_number: issue.number });
  const config = mergeConfig(
    await loadRepoConfig(octokit, repo, inputs.configPath, pr.head.sha, log),
    inputs.overrides,
  );
  const llm = makeClient(inputs, config);
  if (!llm) return;
  const files = (await listPullRequestFiles(octokit, repo, issue.number))
    .map(parseFile)
    .filter((f) => f.patch);
  const explanation = await explainChange(
    files,
    { title: pr.title, description: pr.body ?? undefined },
    llm,
    config,
  );
  const body = `### 👁️ Nazar explains this PR\n\n${sanitizeMarkdown(explanation)}\n\n---\n<sub>Asked by @${comment.user?.login} · [Nazar](${REPO_URL}) · powered by [BharatCode](https://bharatcode.ai)</sub>`;
  await octokit.rest.issues.createComment({ ...repo, issue_number: issue.number, body: truncateBody(body) });
}

export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const ctx: RunContext = {
      inputs,
      octokit: github.getOctokit(inputs.githubToken),
      repo: github.context.repo,
      serverUrl: github.context.serverUrl,
    };
    const event = github.context.eventName;
    const isPrEvent = event === 'pull_request' || event === 'pull_request_target';

    if (event === 'issue_comment') await handleCommand(ctx);
    else if (inputs.mode === 'pr' || (inputs.mode === 'auto' && isPrEvent)) await reviewPullRequest(ctx);
    else if (inputs.mode === 'push' || (inputs.mode === 'auto' && event === 'push')) await reviewPush(ctx);
    else core.warning(`Nazar does not handle the "${event}" event. Use pull_request, push or issue_comment.`);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 403) {
      core.setFailed(
        `GitHub refused the request (403): ${e.message}. Make sure the workflow has \`permissions: pull-requests: write\` (and \`contents: write\` for push mode).`,
      );
    } else {
      core.setFailed(`Nazar failed: ${e.message}`);
    }
  }
}

void run();
