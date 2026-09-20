import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { config } from '../server/config';
import { createCollectionStore } from '../src/extension/database';
import { createExtensionJobs } from '../src/extension/jobs';
import { extractBrowserSource } from '../src/extension/extract';
import { flattenBookmarks } from '../src/lib/bookmarks';
import { smokeBookmarks } from './smoke-bookmarks';

assert(config.key, 'A configured API key is required for this opt-in live smoke test.');
const dom = new JSDOM('');
globalThis.DOMParser = dom.window.DOMParser;
const databaseName = `live-extension-${crypto.randomUUID()}`;
const store = createCollectionStore(databaseName);
const engine = createExtensionJobs({
  store,
  settings: async () => ({ apiKey: config.key, model: config.model, baseUrl: config.baseUrl }),
  extract: extractBrowserSource,
});
try {
  const created = await engine.create({
    bookmarks: flattenBookmarks(smokeBookmarks),
    palette: 'forest',
    direction: '',
    collectionTitle: 'Agent 文章选集',
  });
  let previous = '';
  for (let attempt = 0; attempt < 240; attempt++) {
    const job = await engine.get(created.id);
    if (job.message !== previous) {
      console.log(job.message);
      previous = job.message;
    }
    if (job.status === 'failed' || job.status === 'cancelled')
      throw new Error(job.error || job.message);
    if (job.status === 'outline_ready') {
      assert.equal(job.sources.length, 3);
      assert(job.sources.every((source) => source.summary?.trim()));
      assert(job.sources.every((source) => source.content === undefined));
      const completed = await engine.write(job.id, { outline: job.outline });
      const book = (await createCollectionStore(databaseName).books()).find(
        (item) => item.id === completed.bookId,
      )!;
      assert(book);
      assert.equal(book.sources.length, 3);
      const output = JSON.stringify({ job: completed, book }, null, 2);
      assert(!output.includes(config.key));
      await fs.mkdir('artifacts', { recursive: true });
      await fs.writeFile('artifacts/extension-smoke.json', output);
      console.log(
        JSON.stringify({
          ok: true,
          articles: book.sources.length,
          statuses: book.sources.map((source) => source.status),
          persisted: true,
          artifact: 'artifacts/extension-smoke.json',
        }),
      );
      break;
    }
    if (attempt === 239) throw new Error('Extension smoke test timed out.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} finally {
  dom.window.close();
}
