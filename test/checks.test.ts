import { describe, expect, it } from 'vitest';
import { maskSecret, scanDiffForSecrets, scanLine, scanText } from '../src/core/checks/secrets.js';
import { checkChangedFiles, checkSubmission, isCommittedEnvFile } from '../src/core/checks/submission.js';
import { parseFile } from '../src/core/diff/parse.js';
import { FAKE, sampleFiles } from './helpers.js';

describe('secret scanner', () => {
  const positives: [string, string][] = [
    ['github-token', `token = "${FAKE.github}"`],
    ['bharatcode-key', `BHARATCODE_API_KEY=${FAKE.bharatcode}`],
    ['aws-access-key', `AWS_ACCESS_KEY_ID=${FAKE.aws}`],
    ['google-api-key', `const key = "${FAKE.google}"`],
    ['openai-key', `OPENAI_API_KEY=${FAKE.openai}`],
    ['anthropic-key', `key: ${FAKE.anthropic}`],
    ['razorpay-key', `RAZORPAY_KEY=${FAKE.razorpay}`],
    ['private-key', FAKE.privateKey],
    ['db-url-password', `DATABASE_URL=${FAKE.dbUrl}`],
    ['generic-secret', `const apiKey = "${FAKE.generic}";`],
    ['telegram-bot-token', `BOT=${FAKE.telegram}`],
    ['env-secret', 'API_KEY=supersecretvalue123456'],
    ['env-secret', 'export JWT_SECRET=k9Xp2mQ7vR4tL8wZ'],
  ];
  it.each(positives)('detects %s', (id, line) => {
    expect(scanLine(line)?.ruleId).toBe(id);
  });

  const negatives = [
    'const apiKey = process.env.API_KEY;',
    'api_key = "your-api-key-here-please"',
    'password = "xxxxxxxxxxxxxxxxxxxx"',
    'DATABASE_URL=postgres://user:${DB_PASSWORD}@localhost/app',
    'const token = "aaaaaaaaaaaaaaaaaaaaaaa";',
    'task-list and disk-usage are words',
    'const secretName = "MY_SECRET_NAME_IN_VAULT";',
    'API_KEY=changeme_please_now',
    'TOKEN_TTL_SECONDS=3600',
    'GOOGLE_KEY_FILE=credentials/service.json',
  ];
  it.each(negatives)('ignores %s', (line) => {
    expect(scanLine(line)).toBeUndefined();
  });

  it('honours the inline nazar:allow marker', () => {
    expect(scanLine(`const demo = "${FAKE.github}"; // nazar:allow`)).toBeUndefined();
  });

  it('masks values', () => {
    expect(maskSecret('abcd_efghijklmnop')).toBe('abcd…mnop');
    expect(maskSecret('short')).toBe('sh…');
  });

  it('reports line numbers in text', () => {
    expect(scanText(`a\nb\nkey=${FAKE.aws}`)).toEqual([
      { ruleId: 'aws-access-key', name: 'AWS access key ID', line: 3, masked: 'AKIA…MPLF' },
    ]);
  });

  it('turns secrets on added diff lines into critical findings, never exposing the full value', () => {
    const findings = scanDiffForSecrets(sampleFiles().map(parseFile));
    expect(findings.map((f) => [f.path, f.line, f.severity])).toEqual([
      ['src/db.js', 7, 'critical'],
      ['.env', 1, 'critical'],
    ]);
    expect(findings[0]!.explanation).not.toContain(FAKE.github);
  });
});

describe('repo checks', () => {
  it('recognises committed env files but not templates', () => {
    expect(isCommittedEnvFile('.env')).toBe(true);
    expect(isCommittedEnvFile('server/.env.local')).toBe(true);
    expect(isCommittedEnvFile('.env.example')).toBe(false);
    expect(isCommittedEnvFile('environment.ts')).toBe(false);
  });

  it('flags .env and node_modules in changed files', () => {
    const ids = checkChangedFiles([
      ...sampleFiles(),
      { path: 'node_modules/x/index.js', status: 'added' },
    ]).map((c) => c.id);
    expect(ids).toEqual(['env-committed', 'node-modules-committed']);
  });

  it('checks Build League submission files', async () => {
    const none = await checkSubmission(async () => false);
    expect(none.map((c) => c.id)).toEqual(['bharatcode-txt-missing', 'readme-missing']);
    expect(await checkSubmission(async () => true)).toEqual([]);
  });
});
