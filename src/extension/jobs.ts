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
import { messageError } from './protocol';

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
      throw new DOMException('整理已取消', 'AbortError');
    Object.assign(job, change);
    await persist(job);
  }
  const ready = (async () => {
    for (const job of await store.jobs()) {
      if (working.has(job.status)) {
        job.status = 'failed';
        job.message = job.error = '浏览器已重启，整理已中断。可以使用已选书签重新生成。';
        await persist(job);
      }
      jobs.set(job.id, job);
    }
  })();
  function find(id: string) {
    const job = jobs.get(id);
    if (!job) throw new Error('未找到这份草稿，请重新选择收藏。');
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
      if (!settings.apiKey) throw new Error('请先在设置中填写 API Key。');
      if ([...jobs.values()].filter((job) => working.has(job.status)).length >= 2)
        throw new Error('已有两个文集正在整理，请等其中一个完成。');
      const bookmarks = deduplicateBookmarks(input.bookmarks).map((item, index) => ({
        ...item,
        id: `s${index + 1}`,
      }));
      if (!bookmarks.length) throw new Error('请至少选择一个可用书签。');
      const job: Job = {
        id: crypto.randomUUID(),
        bookmarks,
        sources: [],
        palette: input.palette,
        direction: input.direction,
        collectionTitle: input.collectionTitle,
        model: settings.model,
        status: 'extracting',
        progress: 0,
        message: '正在读取网页…',
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
          const message = cancelled
            ? '已停止整理，原始书签未受影响。'
            : error instanceof Error && error.name === 'TimeoutError'
              ? 'API 读取或生成超时，请稍后重试。'
              : messageError(error);
          await update(job, {
            status: cancelled ? 'cancelled' : 'failed',
            message,
            error: message,
          });
        })
        .catch(() => {})
        .finally(() => controllers.delete(job.id));
      return publicJob(job);
    },
    async write(id: string, value: unknown) {
      await ready;
      const job = find(id);
      if (job.status !== 'outline_ready') throw new Error('当前任务尚未准备好保存文集。');
      const input = writeJobSchema.parse(value);
      validateReferences(input.outline, job.sources);
      const book = assembleCollection(
        {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          palette: job.palette,
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
        message: '文集已保存。',
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
      if (job.status === 'writing') throw new Error('当前文集正在保存，请稍候。');
      controllers.get(id)?.abort();
      await update(job, { status: 'cancelled', message: '已停止整理，原始书签未受影响。' });
      return { ok: true };
    },
  };
}
