import { defaultLocale, jobMessage, translate, type Locale } from './i18n';
import { z } from 'zod';
import { outlineSchema, type Bookmark, type Job, type Outline, type Source } from './types';
import { createModelClient } from './model';
import { normalizePageAnalysis, pageAnalysisSchema, qualifySummary } from './page-analysis';
import {
  classificationPrompt,
  pageIntroductionPrompt,
  collectionTitlePrompt,
  introductionMaxLength,
} from './prompts';

export interface AnalysisDependencies {
  extractSource: (bookmark: Bookmark, signal: AbortSignal, locale?: Locale) => Promise<Source>;
  askModel: ReturnType<typeof createModelClient>;
  update: (job: Job, change: Partial<Job>) => Promise<void>;
}

function batchSchema<T extends { id: string }>(itemSchema: z.ZodType<T>, sources: Source[]) {
  const ids = new Set(sources.map((source) => source.id));
  return z
    .object({
      sources: z.array(itemSchema).length(sources.length),
    })
    .refine(
      ({ sources: values }) =>
        new Set(values.map((value) => value.id)).size === ids.size &&
        values.every((value) => ids.has(value.id)),
      'Each input ID must appear exactly once, without additions or omissions',
    );
}

async function processBatches(
  batches: Source[][],
  signal: AbortSignal,
  process: (batch: Source[]) => Promise<void>,
) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (next < batches.length) {
        signal.throwIfAborted();
        await process(batches[next++]!);
      }
    }),
  );
}

export async function analyzeCollection(
  job: Job,
  signal: AbortSignal,
  dependencies: AnalysisDependencies,
) {
  const controller = new AbortController();
  try {
    await runAnalysis(job, AbortSignal.any([signal, controller.signal]), dependencies);
  } catch (error) {
    controller.abort(error);
    throw error;
  }
}

async function runAnalysis(job: Job, signal: AbortSignal, dependencies: AnalysisDependencies) {
  const { extractSource, askModel, update } = dependencies;
  const locale = job.locale || defaultLocale;
  let next = 0,
    done = 0;
  const results: Source[] = new Array(job.bookmarks.length);
  await Promise.all(
    Array.from({ length: Math.min(4, job.bookmarks.length) }, async () => {
      while (next < job.bookmarks.length) {
        signal.throwIfAborted();
        const index = next++;
        const bookmark = job.bookmarks[index]!;
        const source = await extractSource(bookmark, signal, locale);
        signal.throwIfAborted();
        const parsed = new URL(bookmark.url);
        const autoTitle = parsed.hostname + parsed.pathname.slice(0, 100);
        if (bookmark.title !== autoTitle && bookmark.title !== bookmark.url)
          source.title = bookmark.title;
        results[index] = source;
        done++;
        await update(job, {
          progress: Math.round((done / job.bookmarks.length) * 30),
          ...jobMessage(locale, 'job.readingCount', { done, total: job.bookmarks.length }),
          sources: results.filter(Boolean),
        });
      }
    }),
  );
  job.sources = results;
  await update(job, {
    status: 'analyzing',
    progress: 32,
    ...jobMessage(locale, 'job.classifying'),
  });
  const batches: Source[][] = [];
  for (let i = 0; i < results.length; i += 5) batches.push(results.slice(i, i + 5));
  let classified = 0;
  await processBatches(batches, signal, async (batch) => {
    const response = await askModel(
      classificationPrompt(batch, job.direction, locale),
      batchSchema(z.object({ id: z.string(), analysis: pageAnalysisSchema }), batch),
      signal,
      2500,
    );
    signal.throwIfAborted();
    for (const source of batch) {
      const item = response.sources.find((item) => item.id === source.id)!;
      source.pageAnalysis = normalizePageAnalysis(source, item.analysis);
    }
    classified += batch.length;
    await update(job, {
      progress: 32 + Math.round((classified / results.length) * 18),
      ...jobMessage(locale, 'job.classifyingCount', { done: classified, total: results.length }),
    });
  });
  let introduced = 0;
  await update(job, { progress: 50, ...jobMessage(locale, 'job.introducing') });
  await processBatches(batches, signal, async (batch) => {
    const response = await askModel(
      pageIntroductionPrompt(batch, job.direction, locale),
      batchSchema(
        z.object({
          id: z.string(),
          summary: z.string().trim().min(1).max(introductionMaxLength(locale)),
        }),
        batch,
      ),
      signal,
      6000,
    );
    signal.throwIfAborted();
    for (const source of batch) {
      const item = response.sources.find((item) => item.id === source.id)!;
      source.summary = qualifySummary(source, item.summary, locale);
    }
    introduced += batch.length;
    await update(job, {
      progress: 50 + Math.round((introduced / results.length) * 35),
      ...jobMessage(locale, 'job.introducingCount', { done: introduced, total: results.length }),
    });
  });
  await update(job, { status: 'outlining', progress: 90, ...jobMessage(locale, 'job.naming') });
  const metadata = job.collectionTitle?.trim()
    ? { title: job.collectionTitle.trim() }
    : await askModel(
        collectionTitlePrompt(results, job.direction, locale),
        outlineSchema.pick({ title: true }),
        signal,
        1000,
      );
  const outline: Outline = {
    title: metadata.title,
    subtitle: '',
    description: '',
    theme: '',
    chapters: [
      {
        title: translate(locale, 'studio.includedPages'),
        description: '',
        sourceIds: results.map((source) => source.id),
      },
    ],
  };
  signal.throwIfAborted();
  await update(job, {
    status: 'outline_ready',
    progress: 100,
    ...jobMessage(locale, 'job.ready'),
    outline,
  });
}
