import { z } from 'zod';
import type { Source } from './types';
import { defaultLocale, translate, type Locale } from './i18n';

export const pageTypes = [
  'article',
  'documentation',
  'tool',
  'repository',
  'video',
  'audio',
  'course',
  'product',
  'discussion',
  'resource',
  'website',
  'profile',
  'event',
  'other',
  'unknown',
] as const;

export const pageAnalysisSchema = z.object({
  type: z.enum(pageTypes),
  subject: z.string().trim().min(1).max(160),
  confidence: z.enum(['high', 'medium', 'low']),
  basis: z.enum(['content', 'metadata', 'title', 'blocked']),
});
export type PageAnalysis = z.infer<typeof pageAnalysisSchema>;

// A model cannot upgrade the evidence available to the extractor.
export function normalizePageAnalysis(source: Source, analysis: PageAnalysis): PageAnalysis {
  if (analysis.basis === 'blocked') return { ...analysis, type: 'unknown', confidence: 'low' };
  const hasMetadata = Boolean(
    source.pageMetadata?.title ||
    source.pageMetadata?.description ||
    source.pageMetadata?.headings.length ||
    (source.status === 'metadata' && source.content?.trim()),
  );
  let basis = analysis.basis;
  if (source.status === 'unavailable') basis = 'title';
  else if (basis === 'content' && (source.status === 'metadata' || !source.content?.trim()))
    basis = hasMetadata ? 'metadata' : 'title';
  else if (basis === 'metadata' && !hasMetadata) basis = 'title';
  const confidence =
    basis === 'title' || analysis.type === 'unknown'
      ? 'low'
      : basis === 'metadata' && analysis.confidence === 'high'
        ? 'medium'
        : analysis.confidence;
  return { ...analysis, basis, confidence };
}

export function qualifySummary(
  source: Source,
  summary: string,
  locale: Locale = defaultLocale,
): string {
  const prefix = {
    content: '',
    metadata: translate(locale, 'evidence.metadata'),
    title: translate(locale, 'evidence.title'),
    blocked: translate(locale, 'evidence.blocked'),
  }[source.pageAnalysis?.basis || 'title'];
  return `${prefix}${summary}`;
}
