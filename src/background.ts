import { AppError, errorResponse, translate, defaultLocale, resolveLocale } from '../shared/i18n';
import { z } from 'zod';
import { bookFlagsSchema } from '../shared/book-flags';
import { testModelConnection } from '../shared/model';
import { resolveSettings, settingsInputSchema, settingsStatus } from '../shared/settings';
import { collectionStore } from './extension/database';
import { readExtensionSettings, saveExtensionSettings } from './extension/settings';
import { sendExtensionMessage, trustedMessage } from './extension/protocol';
import { ensureSourceImages } from './extension/page-images';

void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let creating: Promise<void> | undefined;
async function ensureRunner() {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL('offscreen.html')],
    });
    if (!contexts.length)
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: translate(defaultLocale, 'extension.justification'),
      });
  })();
  try {
    await creating;
  } finally {
    creating = undefined;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!trustedMessage(message, sender, 'background')) return;
  void (async () => {
    switch (message.method) {
      case 'health': {
        const settings = await readExtensionSettings();
        return { configured: Boolean(settings.apiKey), model: settings.model };
      }
      case 'settings.get':
        return settingsStatus(await readExtensionSettings());
      case 'settings.save':
        return saveExtensionSettings(settingsInputSchema.parse(message.input));
      case 'settings.test':
        return testModelConnection(
          resolveSettings(settingsInputSchema.parse(message.input), await readExtensionSettings()),
        );
      case 'runner.settings':
        if (sender.url !== chrome.runtime.getURL('offscreen.html'))
          throw new AppError('error.extensionRequest');
        return readExtensionSettings();
      case 'books.list':
        return collectionStore.books();
      case 'books.images': {
        const { id, sourceId } = z
          .object({ id: z.string().uuid(), sourceId: z.string().max(200) })
          .parse(message.input);
        return ensureSourceImages(id, sourceId);
      }
      case 'images.get': {
        const { id } = z.object({ id: z.string().uuid() }).parse(message.input);
        return collectionStore.imageAsset(id);
      }
      case 'books.flags': {
        const { id, flags } = z
          .object({ id: z.string().uuid(), flags: bookFlagsSchema })
          .parse(message.input);
        return collectionStore.updateBookFlags(id, flags);
      }
      case 'books.remove': {
        const { id } = z.object({ id: z.string().uuid() }).parse(message.input);
        await collectionStore.removeBook(id);
        return { ok: true };
      }
      case 'books.introduction':
      case 'jobs.create':
      case 'jobs.get':
      case 'jobs.write':
      case 'jobs.cancel':
        await ensureRunner();
        return sendExtensionMessage(
          'runner',
          message.method,
          message.input,
          resolveLocale(message.locale),
        );
      default:
        throw new AppError('error.extensionRequest');
    }
  })().then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, ...errorResponse(error, resolveLocale(message.locale)) }),
  );
  return true;
});

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
  // The tabs permission is unnecessary: unreadable tab URLs simply do not match.
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const existing = tabs.find((tab) => tab.url === url || tab.url?.startsWith(`${url}?`));
  if (existing?.id) await chrome.tabs.update(existing.id, { active: true });
  else await chrome.tabs.create({ url });
});
