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
    .refine((url) => /^https?:\/\//i.test(url), '仅支持 HTTP/HTTPS 网页'),
  folder: z.string().max(1000).optional(),
});
export type Bookmark = z.infer<typeof bookmarkSchema>;
export interface Source extends Bookmark {
  status: 'full' | 'excerpt' | 'metadata' | 'unavailable';
  content?: string;
  summary?: string;
  ideas?: string[];
  error?: string;
  wordCount?: number;
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
  id: string;
  title: string;
  subtitle: string;
  description: string;
  theme: string;
  palette: Palette;
  createdAt: string;
  chapters: Chapter[];
  sources: Source[];
  readingMinutes: number;
  isDemo?: boolean;
  model?: string;
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
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: string;
  bookmarks: Bookmark[];
  sources: Source[];
  palette: Palette;
  direction: string;
  collectionTitle?: string;
  model?: string;
  outline?: Outline;
  bookId?: string;
  error?: string;
}
export const createJobSchema = z.object({
  bookmarks: z.array(bookmarkSchema).min(1).max(500),
  palette: paletteSchema.default('forest'),
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
    throw new Error('模型返回了不存在的来源，请重试生成目录。');
  }
  const used = new Set(outline.chapters.flatMap((chapter) => chapter.sourceIds));
  if (sources.some((source) => !used.has(source.id)))
    throw new Error('目录遗漏了部分素材，请重试生成目录。');
}
export function validateChapterReferences(
  chapter: z.infer<typeof chapterContentSchema>,
  allowed: string[],
) {
  const ids = new Set(allowed);
  for (const section of chapter.sections)
    for (const paragraph of section.paragraphs) {
      if (paragraph.sourceIds.some((id) => !ids.has(id))) throw new Error('章节包含无效来源。');
      if (!paragraph.sourceIds.length) throw new Error('章节段落缺少来源。');
    }
}
export function publicSource(source: Source): Source {
  const { content: _content, ...rest } = source;
  return rest;
}
