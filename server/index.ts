import express from 'express';
import path from 'node:path';
import { config, rootDir } from './config';
import { initStore, readRecords, removeBook } from './store';
import { activeCount, cancelJob, createJob, jobs, publicJob, restoreJobs, writeBook } from './jobs';
import { createJobSchema, writeJobSchema, type Book } from '../shared/types';
import { readSettings, saveSettings } from './settings';
import { resolveSettings, settingsInputSchema, settingsStatus } from '../shared/settings';
import { testModelConnection } from '../shared/model';

await initStore();
await restoreJobs();
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const hostname = req.hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    res.status(403).json({ error: '仅允许本地访问。' });
    return;
  }
  const origin = req.get('origin');
  const allowed =
    origin &&
    (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
      [
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        `http://127.0.0.1:${config.port}`,
        `http://localhost:${config.port}`,
      ].includes(origin));
  if (origin && !allowed) {
    res.status(403).json({ error: '来源未获允许。' });
    return;
  }
  if (allowed)
    res.set({
      'Access-Control-Allow-Origin': origin!,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  if (
    ['POST', 'DELETE'].includes(req.method) &&
    req.get('sec-fetch-site') === 'cross-site' &&
    !allowed
  ) {
    res.sendStatus(403);
    return;
  }
  next();
});
app.use(express.json({ limit: '3mb' }));
app.get('/api/health', async (_req, res) => {
  const settings = await readSettings();
  res.json({
    configured: Boolean(settings.apiKey),
    model: settings.model,
    service: 'Bookmark Press',
  });
});
app.get('/api/settings', async (_req, res) => res.json(settingsStatus(await readSettings())));
app.post('/api/settings', async (req, res) =>
  res.json(settingsStatus(await saveSettings(settingsInputSchema.parse(req.body)))),
);
app.post('/api/settings/test', async (req, res) =>
  res.json(
    await testModelConnection(
      resolveSettings(settingsInputSchema.parse(req.body), await readSettings()),
    ),
  ),
);
app.get('/api/extension', (_req, res) =>
  res.download(path.join(rootDir, 'dist/bookmark-press-extension.zip'), '拾页.zip'),
);
app.get('/api/books', async (_req, res) =>
  res.json(
    (await readRecords<Book>('books')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  ),
);
app.delete('/api/books/:id', async (req, res) => {
  await removeBook(req.params.id);
  res.json({ ok: true });
});
app.post('/api/jobs', async (req, res) => {
  if (!(await readSettings()).apiKey) {
    res.status(503).json({ error: '请先在设置中填写 API Key。' });
    return;
  }
  if (activeCount() >= 2) {
    res.status(429).json({ error: '已有两个文集正在整理，请等其中一个完成。' });
    return;
  }
  const input = createJobSchema.parse(req.body);
  res.status(202).json(publicJob(await createJob(input)));
});
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '未找到这份草稿，请重新创建。' });
    return;
  }
  res.json(publicJob(job));
});
app.post('/api/jobs/:id/write', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: '未找到这份草稿。' });
    return;
  }
  const input = writeJobSchema.parse(req.body);
  await writeBook(job, input.outline, input.articles);
  res.status(202).json(publicJob(job));
});
app.post('/api/jobs/:id/cancel', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.sendStatus(404);
    return;
  }
  await cancelJob(job);
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
app.use(express.static(path.join(rootDir, 'dist/extension')));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error && typeof error === 'object' && 'issues' in error) {
      res.status(400).json({ error: '输入格式有误，请检查链接、目录与文字长度。' });
      return;
    }
    const message = error instanceof Error ? error.message : '';
    const safe = /^(当前任务|目录|模型|章节|无效文集|文章|API|请|更换|无法连接)/.test(message)
      ? message
      : '操作失败，请稍后重试。';
    res.status(400).json({ error: safe });
  },
);
app.listen(config.port, '127.0.0.1', () =>
  console.log(
    `Bookmark Press API → http://127.0.0.1:${config.port} · ${config.model} · key ${config.key ? 'configured' : 'missing'}`,
  ),
);
