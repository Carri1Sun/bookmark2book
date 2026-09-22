import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { translate } from '../shared/i18n';

test('local HTTP service localizes errors, validation, branding, and CORS without model calls', async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tabbit-i18n-http-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATA_DIR: directory, PORT: String(port), DEEPSEEK_API_KEY: '' },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}/api`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Fixture service exited before starting');
      try {
        const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* Wait for the isolated fixture service to listen. */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert(ready, 'Fixture service did not start');
    for (const locale of ['en', 'zh-CN'] as const) {
      const headers = { 'X-UI-Language': locale, 'Content-Type': 'application/json' };
      const health = await (await fetch(`${base}/health`, { headers })).json();
      assert.equal(health.service, translate(locale, 'brand.name'));
      assert.equal(health.configured, false);
      const missing = await (await fetch(`${base}/jobs/missing`, { headers })).json();
      assert.equal(missing.errorDetails.key, 'error.draftNotFound');
      assert.equal(missing.error, translate(locale, 'error.draftNotFound'));
      const validation = await (
        await fetch(`${base}/settings`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ baseUrl: 'http://example.com', model: 'test' }),
        })
      ).json();
      assert.equal(validation.error, translate(locale, 'error.httpsEndpoint'));
      const noKey = await (
        await fetch(`${base}/jobs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ locale, bookmarks: [] }),
        })
      ).json();
      assert.equal(noKey.error, translate(locale, 'error.missingKey'));
    }
    const legacy = await (await fetch(`${base}/jobs/missing`)).json();
    assert.equal(legacy.error, translate('zh-CN', 'error.draftNotFound'));
    const preflight = await fetch(`${base}/jobs`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-UI-Language/);
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
