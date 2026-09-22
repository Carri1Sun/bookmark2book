import { AppError, defaultLocale, errorResponse, jobMessage } from '../../shared/i18n';
import { analyzeCollection, type AnalysisDependencies } from '../../shared/analysis';
import { assembleCollection } from '../../shared/collection';
import { createModelClient } from '../../shared/model';
import type { ModelSettings } from '../../shared/settings';
import {
  createJobSchema,
  publicSource,
  validateReferences,
  writeJobSchema,
  type Job,
} from '../../shared/types';
import { deduplicateBookmarks } from '../lib/bookmarks';
import type { CollectionStore } from './database';

const working = new Set(['extracting', 'analyzing', 'outlining', 'writing']);
export function createExtensionJobs(dependencies: {
  store: CollectionStore;
  settings: () => Promise<ModelSettings>;
  extract: AnalysisDependencies['extractSource'];
}) {
  const { store } = dependencies;
  const jobs = new Map<string, Job>();
  const controllers = new Map<string, AbortController>();
  const writes = new Map<string, Promise<void>>();
  const publicJob = (job: Job): Job =>
    structuredClone({ ...job, sources: job.sources.map(publicSource) });
  function persist(job: Job) {
    const snapshot = structuredClone(job);
    const previous = writes.get(job.id) || Promise.resolve();
    const pending = previous.catch(() => {}).then(() => store.saveJob(snapshot));
    writes.set(job.id, pending);
    void pending
      .finally(() => {
        if (writes.get(job.id) === pending) writes.delete(job.id);
      })
      .catch(() => {});
    return pending;
  }
  async function update(job: Job, change: Partial<Job>) {
    if (job.status === 'cancelled' && change.status !== 'cancelled')
      throw new DOMException('Aborted', 'AbortError');
    Object.assign(job, change);
    await persist(job);
  }
  const ready = (async () => {
    for (const job of await store.jobs()) {
      if (working.has(job.status)) {
        job.status = 'failed';
        Object.assign(
          job,
          jobMessage(job.locale, 'error.browserRestart'),
          errorResponse(new AppError('error.browserRestart'), job.locale),
        );
        await persist(job);
      }
      jobs.set(job.id, job);
    }
  })();
  function find(id: string) {
    const job = jobs.get(id);
    if (!job) throw new AppError('error.draftNotFound');
    return job;
  }
  return {
    ready,
    async get(id: string) {
      await ready;
      return publicJob(find(id));
    },
    async create(value: unknown) {
      await ready;
      const input = createJobSchema.parse(value);
      const settings = await dependencies.settings();
      if (!settings.apiKey) throw new AppError('error.missingKey');
      if ([...jobs.values()].filter((job) => working.has(job.status)).length >= 2)
        throw new AppError('error.busy');
      const bookmarks = deduplicateBookmarks(input.bookmarks).map((item, index) => ({
        ...item,
        id: `s${index + 1}`,
      }));
      if (!bookmarks.length) throw new AppError('error.noBookmarks');
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
      try {
        await persist(job);
      } catch (error) {
        jobs.delete(job.id);
        throw error;
      }
      const controller = new AbortController();
      controllers.set(job.id, controller);
      void analyzeCollection(job, controller.signal, {
        extractSource: dependencies.extract,
        askModel: createModelClient(settings),
        update,
      })
        .catch(async (error) => {
          const cancelled = controller.signal.aborted;
          const failure = errorResponse(
            cancelled ? new AppError('job.stopped') : error,
            job.locale,
          );
          await update(job, {
            status: cancelled ? 'cancelled' : 'failed',
            ...jobMessage(job.locale, failure.errorDetails.key, failure.errorDetails.params),
            ...failure,
          });
        })
        .catch(() => {})
        .finally(() => controllers.delete(job.id));
      return publicJob(job);
    },
    async write(id: string, value: unknown) {
      await ready;
      const job = find(id);
      if (job.status !== 'outline_ready') throw new AppError('error.notReady');
      const input = writeJobSchema.parse(value);
      validateReferences(input.outline, job.sources);
      const book = assembleCollection(
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          palette: job.palette,
          locale: job.locale || defaultLocale,
          coverImage: job.coverImage,
          model: job.model,
        },
        input.outline,
        job.sources,
        input.articles,
      );
      job.status = 'writing';
      const completed: Job = {
        ...job,
        outline: input.outline,
        bookId: book.id,
        status: 'completed',
        progress: 100,
        ...jobMessage(job.locale, 'job.saved'),
        sources: book.sources,
      };
      try {
        await writes.get(job.id);
        await store.saveCollection(completed, book);
        Object.assign(job, completed);
      } catch (error) {
        job.status = 'outline_ready';
        throw error;
      }
      return publicJob(job);
    },
    async cancel(id: string) {
      await ready;
      const job = find(id);
      if (job.status === 'completed' || job.status === 'cancelled') return { ok: true };
      if (job.status === 'writing') throw new AppError('error.saving');
      controllers.get(id)?.abort();
      await update(job, { status: 'cancelled', ...jobMessage(job.locale, 'job.stopped') });
      return { ok: true };
    },
  };
}
