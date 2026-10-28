import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig, parseConfigFile } from '../src/core/config.js';
import {
  fence,
  parseSummarySha,
  renderInlineComment,
  renderSummary,
  sanitize,
  sanitizeMarkdown,
} from '../src/core/render/markdown.js';
import { silentLogger, type Finding, type ReviewResult } from '../src/core/types.js';

const f: Finding = {
  path: 'src/db.js',
  line: 6,
  severity: 'critical',
  category: 'security',
  title: 'SQL injection via <input>',
  explanation: 'Ping @someone about `a<b>`.',
  suggestion: 'const q = "```";',
  confidence: 0.9,
  source: 'ai',
};

const result = (over: Partial<ReviewResult> = {}): ReviewResult => ({
  findings: [f],
  checks: [{ id: 'bharatcode-txt-missing', level: 'warning', message: '`BharatCode.txt` is missing.' }],
  summary: {
    overview: 'Adds a user lookup.',
    risk: 'high',
    changes: [{ path: 'src/db.js', description: 'New | query' }],
  },
  skipped: [{ path: 'package-lock.json', reason: 'ignored' }],
  reviewedFiles: ['src/db.js'],
  aiStatus: 'ok',
  rejectedByVerifier: 2,
  durationMs: 1000,
  ...over,
});

describe('sanitize', () => {
  it('neutralises mentions, HTML and comment markers but keeps inline code', () => {
    expect(sanitize('hi @bob <img> <!-- x --> `a<b>`')).toBe('hi @​bob &lt;img&gt;  x  `a<b>`');
  });
  it('keeps Markdown structure in sanitizeMarkdown', () => {
    expect(sanitizeMarkdown('> quote\n**bold** <script>x</script>\n```\n<T>\n```')).toBe(
      '> quote\n**bold** &lt;script&gt;x&lt;/script&gt;\n```\n<T>\n```',
    );
  });
});

describe('fence', () => {
  it('uses a fence longer than any backtick run inside', () => {
    expect(fence('a ``` b', 'suggestion')).toBe('````suggestion\na ``` b\n````');
  });
});

describe('renderInlineComment', () => {
  it('renders severity, a safe title and a suggestion block', () => {
    const body = renderInlineComment(f);
    expect(body).toContain('🔴 Critical · security');
    expect(body).toContain('&lt;input&gt;');
    expect(body).toContain('@​someone');
    expect(body).toContain('````suggestion\nconst q = "```";\n````');
  });
});

describe('renderSummary', () => {
  it('includes the marker, risk, checks, table, walkthrough, skipped files and footer', () => {
    const body = renderSummary(result(), { sha: 'abc1234', linkFor: () => 'https://x/blob' });
    expect(body.startsWith('<!-- nazar:summary sha=abc1234 -->')).toBe(true);
    expect(parseSummarySha(body)).toBe('abc1234');
    expect(body).toContain('**Risk:** 🔴 High');
    expect(body).toContain('⚠️ `BharatCode.txt` is missing.');
    expect(body).toContain('| 🔴 | [`src/db.js:6`](https://x/blob) |');
    expect(body).toContain('New \\| query');
    expect(body).toContain('Skipped files (1)');
    expect(body).toContain('verifier removed 2 likely false positive(s)');
    expect(body).toContain('Star Nazar');
  });

  it('shows a warning when AI was unavailable and a clean message when nothing was found', () => {
    expect(renderSummary(result({ aiStatus: 'unavailable', summary: undefined }))).toContain(
      'BharatCode was busy',
    );
    expect(renderSummary(result({ findings: [], checks: [] }))).toContain('No issues found');
  });

  it('renders full findings in detailed (push) mode', () => {
    const body = renderSummary(result(), { detailed: true });
    expect(body).toContain('#### 🔴 SQL injection');
    expect(body).toContain('**Suggested fix:**');
  });
});

describe('config', () => {
  it('parses valid keys and warns on bad ones without failing', () => {
    const warnings: string[] = [];
    const log = { ...silentLogger, warn: (m: string) => warnings.push(m) };
    const parsed = parseConfigFile(
      'language: hinglish\nmax_comments: "lots"\ntypo_key: 1\nignore: ["docs/**"]',
      log,
    );
    expect(parsed).toEqual({ language: 'hinglish', ignore: ['docs/**'] });
    expect(warnings).toHaveLength(2);
    expect(parseConfigFile(': : :', log)).toEqual({});
  });

  it('merges layers with later layers winning and undefined ignored', () => {
    const c = mergeConfig({ language: 'hinglish', max_comments: 3 }, { max_comments: 7, model: undefined });
    expect(c).toMatchObject({ language: 'hinglish', max_comments: 7, model: DEFAULT_CONFIG.model });
  });
});
