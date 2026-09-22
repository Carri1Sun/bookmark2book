import { AppError, errorResponse, resolveLocale, locales } from '../../shared/i18n';
import { z } from 'zod';
import { generateEditorialIntroduction } from '../../shared/editorial-introduction';
import type { ModelSettings } from '../../shared/settings';
import { collectionStore } from './database';
import { extractBrowserSource } from './extract';
import { createExtensionJobs } from './jobs';
import { sendExtensionMessage, trustedMessage } from './protocol';

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
      .object({
        id: z.string().min(1).max(100),
        value: z.unknown().optional(),
        locale: z.enum(locales).optional(),
      })
      .parse(message.input);
    if (message.method === 'books.introduction') {
      const book = (await collectionStore.books()).find((book) => book.id === input.id);
      if (!book) throw new AppError('error.bookNotFound');
      return generateEditorialIntroduction(
        book,
        await sendExtensionMessage<ModelSettings>('background', 'runner.settings'),
        input.locale || resolveLocale(message.locale),
      );
    }
    if (message.method === 'jobs.get') return jobs.get(input.id);
    if (message.method === 'jobs.write') return jobs.write(input.id, input.value);
    if (message.method === 'jobs.cancel') return jobs.cancel(input.id);
    throw new AppError('error.extensionRequest');
  })().then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, ...errorResponse(error, resolveLocale(message.locale)) }),
  );
  return true;
});
