import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { smokeBookmarks } from './smoke-bookmarks';
import { flattenBookmarks } from '../src/lib/bookmarks';
import { type Book, type Job, validateReferences } from '../shared/types';
const base = 'http://127.0.0.1:8787/api';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data as T;
}
const health = await request<{ configured: boolean; model: string }>('/health');
assert.equal(health.configured, true);
console.log(`Live provider: ${health.model}`);
let job = await request<Job>('/jobs', {
  bookmarks: flattenBookmarks(smokeBookmarks),
  palette: 'ink',
  direction:
    '围绕这三篇文章的原文，以产品设计与工程实践的共同视角，解释 Agent 如何从计划、执行到评估形成完整的工作闭环。面向已经了解基本概念的实践者。每篇文章写一段 100–160 字的介绍，合辑名称简洁，保留事实边界。',
});
const jobId = job.id;
console.log(`Started: ${jobId}`);
let previous = '';
let wrote = false;
const deadline = Date.now() + 15 * 60_000;
while (Date.now() < deadline) {
  job = await request<Job>(`/jobs/${jobId}`);
  const status = `${job.status}: ${job.message}`;
  if (status !== previous) {
    console.log(status);
    previous = status;
  }
  if (job.status === 'failed' || job.status === 'cancelled')
    throw new Error(job.error || job.message);
  if (job.status === 'outline_ready' && !wrote) {
    assert(job.outline);
    validateReferences(job.outline, job.sources);
    assert(job.sources.some((source) => source.status === 'full' || source.status === 'excerpt'));
    console.log(`Outline: ${job.outline.title} (${job.sources.length} articles)`);
    await request(`/jobs/${jobId}/write`, { outline: job.outline });
    wrote = true;
  }
  if (job.status === 'completed') {
    const books = await request<Book[]>('/books');
    const book = books.find((book) => book.id === job.bookId);
    assert(book);
    assert.equal(book.chapters.length, 0);
    assert.equal(book.sources.length, 3);
    assert(book.sources.every((source) => source.summary && !source.content));
    assert.equal(book.model, 'deepseek-flash');
    assert(!JSON.stringify(book).includes('DEEPSEEK_API_KEY'));
    await fs.mkdir('artifacts', { recursive: true });
    await fs.writeFile(
      'artifacts/live-smoke.json',
      JSON.stringify(
        {
          jobId,
          bookId: book.id,
          title: book.title,
          model: book.model,
          articles: book.sources.length,
          sources: book.sources.map((source) => ({ id: source.id, status: source.status })),
          passed: true,
        },
        null,
        2,
      ),
    );
    console.log(
      `PASS: ${book.title} · ${book.sources.length} sources · http://127.0.0.1:5173/?book=${book.id}`,
    );
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 1800));
}
throw new Error('Smoke test exceeded 15 minutes; inspect the saved job before retrying.');
