import { AppError, errorResponse, resolveLocale, locales, type MessageKey } from '../shared/i18n';
import { productName, localizedProductName, extensionArchiveName } from '../shared/branding';
import express from 'express';
import { z } from 'zod';
import { generateEditorialIntroduction } from '../shared/editorial-introduction';
import path from 'node:path';
import { config, rootDir } from './config';
import { initStore, readRecords, removeBook, updateBookFlags } from './store';
import { compareBooks } from '../shared/book-order';
import { activeCount, cancelJob, createJob, jobs, publicJob, restoreJobs, writeBook } from './jobs';
import { createJobSchema, writeJobSchema, type Book } from '../shared/types';
import { readSettings, saveSettings } from './settings';
import { resolveSettings, settingsInputSchema, settingsStatus } from '../shared/settings';
import { testModelConnection } from '../shared/model';
import { ensureSourceImages } from './page-images';
import { readImageAsset } from './store';

await initStore();
await restoreJobs();
const app = express();
const requestLocale = (req: express.Request) => {
  const preferred = req.get('X-UI-Language') || req.acceptsLanguages()[0];
  return resolveLocale(preferred === '*' ? undefined : preferred);
};
const failure = (req: express.Request, key: MessageKey) =>
  errorResponse(new AppError(key), requestLocale(req));
app.disable('x-powered-by');
app.use((req, res, next) => {
  const hostname = req.hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    res.status(403).json(failure(req, 'error.localOnly'));
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
    res.status(403).json(failure(req, 'error.origin'));
    return;
  }
  if (allowed)
    res.set({
      'Access-Control-Allow-Origin': origin!,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-UI-Language',
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
    res.status(403).json(failure(req, 'error.origin'));
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
    service: localizedProductName(requestLocale(_req)),
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
  res.download(
    path.join(rootDir, 'dist', extensionArchiveName),
    `${localizedProductName(requestLocale(_req)).replaceAll(' ', '-')}.zip`,
  ),
);
app.get('/api/books', async (_req, res) =>
  res.json((await readRecords<Book>('books')).sort(compareBooks)),
);
app.post('/api/books/:id/flags', async (req, res) => {
  res.json(await updateBookFlags(req.params.id, req.body));
});
app.post('/api/books/:id/sources/:sourceId/images', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const sourceId = z.string().max(200).parse(req.params.sourceId);
  res.json(await ensureSourceImages(id, sourceId));
});
app.get('/api/images/:id', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.json(await readImageAsset(req.params.id));
});
app.post('/api/books/:id/introduction', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const book = (await readRecords<Book>('books')).find((book) => book.id === id);
  if (!book) {
    res.status(404).json(failure(req, 'error.bookNotFound'));
    return;
  }
  res.json(
    await generateEditorialIntroduction(
      book,
      await readSettings(),
      z.enum(locales).default(requestLocale(req)).parse(req.body?.locale),
    ),
  );
});
app.delete('/api/books/:id', async (req, res) => {
  await removeBook(req.params.id);
  res.json({ ok: true });
});
app.post('/api/jobs', async (req, res) => {
  if (!(await readSettings()).apiKey) {
    res.status(503).json(failure(req, 'error.missingKey'));
    return;
  }
  if (activeCount() >= 2) {
    res.status(429).json(failure(req, 'error.busy'));
    return;
  }
  const input = createJobSchema.parse({
    ...req.body,
    locale: req.body?.locale ?? requestLocale(req),
  });
  res.status(202).json(publicJob(await createJob(input)));
});
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json(failure(req, 'error.draftNotFound'));
    return;
  }
  res.json(publicJob(job));
});
app.post('/api/jobs/:id/write', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json(failure(req, 'error.draftNotFound'));
    return;
  }
  const input = writeJobSchema.parse(req.body);
  await writeBook(job, input.outline, input.articles);
  res.status(202).json(publicJob(job));
});
app.post('/api/jobs/:id/cancel', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json(failure(req, 'error.draftNotFound'));
    return;
  }
  await cancelJob(job);
  res.json({ ok: true });
});
app.use('/api', (req, res) => res.status(404).json(failure(req, 'error.route')));
app.use(express.static(path.join(rootDir, 'dist/extension')));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json(errorResponse(error, requestLocale(_req)));
  },
);
app.listen(config.port, '127.0.0.1', () =>
  console.log(
    `${productName} API → http://127.0.0.1:${config.port} · ${config.model} · key ${config.key ? 'configured' : 'missing'}`,
  ),
);
