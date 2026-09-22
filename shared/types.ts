import { AppError, locales, defaultLocale, type Locale, type MessageDescriptor } from './i18n';
import { z } from 'zod';

export const paletteSchema = z.enum(['forest', 'vermilion', 'sand', 'ink']);
export type Palette = z.infer<typeof paletteSchema>;
export interface BookmarkNode {
  id: string;
  title: string;
  url?: string;
  children?: BookmarkNode[];
}
export const bookmarkSchema = z.object({
  id: z.string().max(200),
  title: z.string().min(1).max(500),
  url: z
    .string()
    .url()
    .max(4000)
    .refine((url) => /^https?:\/\//i.test(url), 'error.httpOnly'),
  folder: z.string().max(1000).optional(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;
export interface Source extends Bookmark {
  status: 'full' | 'excerpt' | 'metadata' | 'unavailable';
  content?: string;
  summary?: string;
  ideas?: string[];
  error?: string;
  errorDetails?: MessageDescriptor;
  wordCount?: number;
  pageMetadata?: import('./page-metadata').PageMetadata;
  pageAnalysis?: import('./page-analysis').PageAnalysis;
  imageCandidates?: import('./page-images').ImageCandidate[];
  images?: import('./page-images').SourceImages;
}
export const outlineSchema = z.object({
  title: z.string().min(1).max(60),
  subtitle: z.string().max(160),
  description: z.string().max(1000),
  theme: z.string().max(100),
  chapters: z
    .array(
      z.object({
        title: z.string().min(1).max(100),
        description: z.string().max(800),
        sourceIds: z.array(z.string()).min(1),
      }),
    )
    .min(1)
    .max(8),
});
export type Outline = z.infer<typeof outlineSchema>;
export const paragraphSchema = z.object({
  text: z.string().min(1).max(5000),
  sourceIds: z.array(z.string()),
});
export const chapterContentSchema = z.object({
  introduction: z.string().max(1500),
  sections: z
    .array(
      z.object({
        heading: z.string().max(120),
        paragraphs: z.array(paragraphSchema).min(1).max(8),
      }),
    )
    .min(1)
    .max(6),
  takeaway: z.string().max(600),
});
export type Chapter = z.infer<typeof chapterContentSchema> & {
  id: string;
  title: string;
  sourceIds: string[];
};
export interface Book {
  locale?: Locale;
  id: string;
  title: string;
  subtitle: string;
  description: string;
  theme: string;
  palette: Palette;
  coverImage?: string;
  createdAt: string;
  chapters: Chapter[];
  sources: Source[];
  readingMinutes: number;
  model?: string;
  pinned?: boolean;
  featured?: boolean;
  featuredMedal?: import('./featured-medals').MedalTier;
  editorial?: {
    status: 'pending' | 'approved';
    reason: string;
    introduction: string;
    submittedAt: string;
  };
}
export type JobStatus =
  | 'extracting'
  | 'analyzing'
  | 'outlining'
  | 'outline_ready'
  | 'writing'
  | 'completed'
  | 'failed'
  | 'cancelled';
export interface Job {
  locale?: Locale;
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  messageDetails?: MessageDescriptor;
  createdAt: string;
  bookmarks: Bookmark[];
  sources: Source[];
  palette: Palette;
  coverImage?: string;
  direction: string;
  collectionTitle?: string;
  model?: string;
  outline?: Outline;
  bookId?: string;
  error?: string;
  errorDetails?: MessageDescriptor;
}
export const createJobSchema = z.object({
  locale: z.enum(locales).default(defaultLocale),
  bookmarks: z.array(bookmarkSchema).min(1).max(500),
  palette: paletteSchema.default('forest'),
  coverImage: z
    .string()
    .max(1_500_000, 'error.coverSize')
    .refine((value) => value.startsWith('data:image/'), 'error.coverFormat')
    .optional(),
  direction: z.string().max(1000).default(''),
  collectionTitle: z.string().trim().max(60).optional(),
});
export const articleEditSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(2000),
});
export type ArticleEdit = z.infer<typeof articleEditSchema>;
export const writeJobSchema = z.object({
  outline: outlineSchema,
  articles: z.array(articleEditSchema).min(1).max(500).optional(),
});

export function validateReferences(outline: Outline, sources: Source[]) {
  const known = new Set(sources.map((source) => source.id));
  if (outline.chapters.some((chapter) => chapter.sourceIds.some((id) => !known.has(id)))) {
    throw new AppError('error.references');
  }
  const used = new Set(outline.chapters.flatMap((chapter) => chapter.sourceIds));
  if (sources.some((source) => !used.has(source.id))) throw new AppError('error.missingReferences');
}
export function validateChapterReferences(
  chapter: z.infer<typeof chapterContentSchema>,
  allowed: string[],
) {
  const ids = new Set(allowed);
  for (const section of chapter.sections)
    for (const paragraph of section.paragraphs) {
      if (paragraph.sourceIds.some((id) => !ids.has(id)))
        throw new AppError('error.chapterReferences');
      if (!paragraph.sourceIds.length) throw new AppError('error.paragraphReferences');
    }
}
export function publicSource(source: Source): Source {
  const { content: _content, pageMetadata: _pageMetadata, ...rest } = source;
  return rest;
}
