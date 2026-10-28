import { z } from 'zod';
import { CATEGORIES, SEVERITIES } from '../types.js';

const lenientInt = z.preprocess(
  (v) => (typeof v === 'string' ? Number(v.replace(/^L/i, '')) : v),
  z.number().int().positive(),
);
const lenientConfidence = z.preprocess((v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && n > 1 && n <= 100 ? n / 100 : n;
}, z.number().min(0).max(1));
const lowercaseEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.toLowerCase().trim().replace(/[ _]/g, '-') : v),
    z.enum(values),
  );

/** Validates one finding from the model. Lenient on formatting, strict on meaning. */
export const rawFindingSchema = z.object({
  path: z.string().min(1),
  line: lenientInt,
  end_line: lenientInt.nullish(),
  severity: lowercaseEnum(SEVERITIES),
  category: lowercaseEnum(CATEGORIES).catch('bug'),
  title: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 140)),
  explanation: z
    .string()
    .min(1)
    .transform((s) => s.slice(0, 1500)),
  suggestion: z.string().nullish(),
  confidence: lenientConfidence.catch(0.5),
});
export type RawFinding = z.infer<typeof rawFindingSchema>;

/** JSON schema sent as response_format (strict mode: every key required, optional ones nullable). */
export const REVIEW_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'path',
          'line',
          'end_line',
          'severity',
          'category',
          'title',
          'explanation',
          'suggestion',
          'confidence',
        ],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer' },
          end_line: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          category: { type: 'string', enum: [...CATEGORIES] },
          title: { type: 'string' },
          explanation: { type: 'string' },
          suggestion: { type: ['string', 'null'] },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const;

export const verdictSchema = z.object({
  id: z.preprocess((v) => (typeof v === 'string' ? Number(v) : v), z.number().int()),
  keep: z.preprocess(
    (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' || v === 'keep' : v),
    z.boolean(),
  ),
  reason: z.string().optional().catch(undefined),
});

export const VERIFY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'keep', 'reason'],
        properties: { id: { type: 'integer' }, keep: { type: 'boolean' }, reason: { type: 'string' } },
      },
    },
  },
} as const;

export const summarySchema = z.object({
  overview: z.string().min(1),
  risk: lowercaseEnum(['low', 'medium', 'high'] as const).catch('medium'),
  changes: z
    .array(z.object({ path: z.string(), description: z.string() }))
    .catch([])
    .default([]),
});

export const SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overview', 'risk', 'changes'],
  properties: {
    overview: { type: 'string' },
    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'description'],
        properties: { path: { type: 'string' }, description: { type: 'string' } },
      },
    },
  },
} as const;
