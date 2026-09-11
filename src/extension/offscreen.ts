import { z } from 'zod';
import type { ModelSettings } from '../../shared/settings';
import { collectionStore } from './database';
import { extractBrowserSource } from './extract';
import { createExtensionJobs } from './jobs';
import { messageError, sendExtensionMessage, trustedMessage } from './protocol';

const jobs = createExtensionJobs({
  store: collectionStore,
  settings: () => sendExtensionMessage<ModelSettings>('background', 'runner.settings'),
  extract: extractBrowserSource,
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trustedMessage(message, sender, 'runner')) return;
  void (async () => {
    if (message.method === 'jobs.create') return jobs.create(message.input);
    const input = z
      .object({ id: z.string().min(1).max(100), value: z.unknown().optional() })
      .parse(message.input);
    if (message.method === 'jobs.get') return jobs.get(input.id);
    if (message.method === 'jobs.write') return jobs.write(input.id, input.value);
    if (message.method === 'jobs.cancel') return jobs.cancel(input.id);
    throw new Error('扩展请求不可用。');
  })().then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: messageError(error) }),
  );
  return true;
});
