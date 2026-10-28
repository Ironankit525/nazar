import type { ChangedFile, RepoCheck } from '../types.js';

const ENV_FILE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;
const ENV_TEMPLATE = /\.(example|sample|template|dist|defaults?)$/i;

export function isCommittedEnvFile(path: string): boolean {
  return ENV_FILE.test(path) && !ENV_TEMPLATE.test(path);
}

/** Checks that only need the list of changed files. */
export function checkChangedFiles(files: ChangedFile[]): RepoCheck[] {
  const checks: RepoCheck[] = [];
  for (const f of files) {
    if (f.status === 'removed') continue;
    if (isCommittedEnvFile(f.path)) {
      checks.push({
        id: 'env-committed',
        level: 'error',
        path: f.path,
        message: `\`${f.path}\` is part of this change. Env files usually hold secrets: keep it out of git (add it to \`.gitignore\`), rotate any keys inside, and commit a \`.env.example\` instead.`,
      });
    }
  }
  if (files.some((f) => f.status !== 'removed' && /(^|\/)node_modules\//.test(f.path))) {
    checks.push({
      id: 'node-modules-committed',
      level: 'warning',
      message:
        '`node_modules/` files are part of this change. Add `node_modules/` to `.gitignore` and remove them with `git rm -r --cached node_modules`.',
    });
  }
  return checks;
}

/** BharatCode Build League submission requirements, checked against the repo at the reviewed commit. */
export async function checkSubmission(fileExists: (path: string) => Promise<boolean>): Promise<RepoCheck[]> {
  const checks: RepoCheck[] = [];
  const [hasMarker, hasReadme] = await Promise.all([fileExists('BharatCode.txt'), fileExists('README.md')]);
  if (!hasMarker) {
    checks.push({
      id: 'bharatcode-txt-missing',
      level: 'warning',
      message:
        '`BharatCode.txt` is missing from the repo root. It is required for BharatCode Build League submissions (set `hackathon_checks: false` to silence this).',
    });
  }
  if (!hasReadme) {
    checks.push({
      id: 'readme-missing',
      level: 'info',
      message:
        'No `README.md` at the repo root. A short README with a demo GIF and setup steps helps people (and judges) try your project.',
    });
  }
  return checks;
}
