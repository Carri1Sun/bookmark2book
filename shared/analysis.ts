import { z } from 'zod';
import {
  outlineSchema,
  publicSource,
  type Bookmark,
  type Job,
  type Outline,
  type Source,
} from './types';
import { createModelClient } from './model';

export interface AnalysisDependencies {
  extractSource: (bookmark: Bookmark, signal: AbortSignal) => Promise<Source>;
  askModel: ReturnType<typeof createModelClient>;
  update: (job: Job, change: Partial<Job>) => Promise<void>;
}

const summarySchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      summary: z.string().min(1).max(220),
    }),
  ),
});
export async function analyzeCollection(
  job: Job,
  signal: AbortSignal,
  dependencies: AnalysisDependencies,
) {
  const { extractSource, askModel, update } = dependencies;
  let next = 0,
    done = 0;
  const results: Source[] = new Array(job.bookmarks.length);
  await Promise.all(
    Array.from({ length: Math.min(4, job.bookmarks.length) }, async () => {
      while (next < job.bookmarks.length) {
        signal.throwIfAborted();
        const index = next++;
        const bookmark = job.bookmarks[index]!;
        const source = await extractSource(bookmark, signal);
        const parsed = new URL(bookmark.url);
        const autoTitle = parsed.hostname + parsed.pathname.slice(0, 100);
        if (bookmark.title !== autoTitle && bookmark.title !== bookmark.url)
          source.title = bookmark.title;
        results[index] = source;
        done++;
        await update(job, {
          progress: Math.round((done / job.bookmarks.length) * 30),
          message: `正在阅读素材 ${done} / ${job.bookmarks.length}`,
          sources: results.filter(Boolean),
        });
      }
    }),
  );
  job.sources = results;
  await update(job, { status: 'analyzing', progress: 32, message: '正在分析内容…' });
  const batches: Source[][] = [];
  for (let i = 0; i < results.length; i += 5) batches.push(results.slice(i, i + 5));
  let batchDone = 0,
    batchNext = 0;
  await Promise.all(
    Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (batchNext < batches.length) {
        const batch = batches[batchNext++]!;
        const analyzed = await askModel(
          `为每篇收藏文章写一段简短中文介绍，用 2–3 句话说明文章讨论什么及适合谁阅读。总长度 90–140 个字符，包含英文和标点，最多 180 个字符。不要复述实现步骤、工具 API 名称和代码细节，不列清单，不写宣传语或完整文章。无法获取正文的条目必须注明只依据标题/简介推测，只解释可能用途，不写成事实。返回 JSON: {"sources":[{"id":"原样保留素材id","summary":"简短介绍"}]}。必须包含每个给定 id，不能新增。\n素材 JSON：${JSON.stringify(batch)}`,
          summarySchema,
          signal,
          6000,
        );
        for (const source of batch) {
          const found = analyzed.sources.find((item) => item.id === source.id);
          if (!found) throw new Error('摘要遗漏了素材，请重试。');
          source.summary = found.summary;
        }
        batchDone++;
        await update(job, {
          progress: 32 + Math.round((batchDone / batches.length) * 43),
          message: `正在梳理观点 ${Math.min(batchDone * 5, results.length)} / ${results.length}`,
        });
      }
    }),
  );
  await update(job, { status: 'outlining', progress: 90, message: '正在整理文集名称…' });
  const metadata = job.collectionTitle?.trim()
    ? { title: job.collectionTitle.trim() }
    : await askModel(
        `根据以下所选文章，拟定一个简洁、准确的中文文集名称，4–18 字，直接描述内容，不使用口号。返回 JSON: {"title":"文集名称"}。用户方向：${JSON.stringify(job.direction)}。文章：${JSON.stringify(results.map(publicSource))}`,
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
      { title: '收录文章', description: '', sourceIds: results.map((source) => source.id) },
    ],
  };
  signal.throwIfAborted();
  await update(job, {
    status: 'outline_ready',
    progress: 100,
    message: '文章介绍已生成，请确认后保存。',
    outline,
  });
}
