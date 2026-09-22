import { AppError, defaultLocale, errorResponse, jobMessage } from '../shared/i18n';
import { z } from 'zod';
import { config } from './config';
import { createModelClient } from '../shared/model';
import { analyzeCollection } from '../shared/analysis';
import { readSettings } from './settings';
import { extractSource } from './extract';
import { assembleCollection } from '../shared/collection';
import { readRecords, saveRecord } from './store';
import {
  validateReferences,
  publicSource,
  type ArticleEdit,
  type Job,
  type Outline,
  type createJobSchema,
} from '../shared/types';

export const jobs = new Map<string, Job>();
const controllers = new Map<string, AbortController>();
const recordWrites = new Map<string, Promise<void>>();
export function publicJob(job: Job) {
  return { ...job, sources: job.sources.map(publicSource) };
}
async function persist(job: Job) {
  const snapshot = structuredClone(job);
  const previous = recordWrites.get(job.id) || Promise.resolve();
  const write = previous.catch(() => {}).then(() => saveRecord('jobs', snapshot));
  recordWrites.set(job.id, write);
  try {
    await write;
  } finally {
    if (recordWrites.get(job.id) === write) recordWrites.delete(job.id);
  }
}
async function update(job: Job, change: Partial<Job>) {
  Object.assign(job, change);
  await persist(job);
}
export async function restoreJobs() {
  for (const job of await readRecords<Job>('jobs')) {
    if (['extracting', 'analyzing', 'outlining', 'writing'].includes(job.status)) {
      job.status = 'failed';
      Object.assign(
        job,
        jobMessage(job.locale, 'error.serverRestart'),
        errorResponse(new AppError('error.serverRestart'), job.locale),
      );
      await persist(job);
    }
    jobs.set(job.id, job);
  }
}
export function activeCount() {
  return controllers.size;
}
export async function createJob(input: z.infer<typeof createJobSchema>): Promise<Job> {
  const settings = await readSettings();
  const seen = new Set<string>();
  const bookmarks = input.bookmarks
    .filter((item) => {
      const url = new URL(item.url);
      url.hash = '';
      if (seen.has(url.href)) return false;
      seen.add(url.href);
      return true;
    })
    .map((item, index) => ({ ...item, id: `s${index + 1}` }));
  const job: Job = {
    id: crypto.randomUUID(),
    locale: input.locale,
    bookmarks,
    sources: [],
    palette: input.palette,
    coverImage: input.coverImage,
    direction: input.direction,
    collectionTitle: input.collectionTitle,
    model: settings.model,
    status: 'extracting',
    progress: 0,
    ...jobMessage(input.locale, 'job.reading'),
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  await persist(job);
  launch(job, (signal) =>
    analyzeCollection(job, signal, {
      extractSource,
      askModel: createModelClient(settings),
      update,
    }),
  );
  return job;
}
function launch(job: Job, work: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  void work(controller.signal)
    .catch(async (error) => {
      const cancelled = controller.signal.aborted;
      const failure = errorResponse(cancelled ? new AppError('job.stopped') : error, job.locale);
      await update(job, {
        status: cancelled ? 'cancelled' : 'failed',
        ...jobMessage(job.locale, failure.errorDetails.key, failure.errorDetails.params),
        ...failure,
      });
    })
    .catch(() => console.error('Unable to save job state.'))
    .finally(() => {
      if (controllers.get(job.id) === controller) controllers.delete(job.id);
    });
}
export async function writeBook(job: Job, outline: Outline, articles?: ArticleEdit[]) {
  if (job.status !== 'outline_ready') throw new AppError('error.notReady');
  validateReferences(outline, job.sources);
  const book = assembleCollection(
    {
      id: crypto.randomUUID(),
      palette: job.palette,
      locale: job.locale || defaultLocale,
      coverImage: job.coverImage,
      createdAt: new Date().toISOString(),
      model: job.model || config.model,
    },
    outline,
    job.sources,
    articles,
  );
  await update(job, {
    outline,
    status: 'writing',
    progress: 95,
    ...jobMessage(job.locale, 'job.saving'),
  });
  launch(job, async (signal) => {
    signal.throwIfAborted();
    await saveRecord('books', book);
    await update(job, {
      status: 'completed',
      progress: 100,
      ...jobMessage(job.locale, 'job.saved'),
      bookId: book.id,
    });
  });
}
export async function cancelJob(job: Job) {
  controllers.get(job.id)?.abort();
  if (job.status === 'outline_ready')
    await update(job, { status: 'cancelled', ...jobMessage(job.locale, 'job.draftCancelled') });
}
