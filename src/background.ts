import { z } from 'zod';
import { testModelConnection } from '../shared/model';
import { resolveSettings, settingsInputSchema, settingsStatus } from '../shared/settings';
import { collectionStore } from './extension/database';
import { readExtensionSettings, saveExtensionSettings } from './extension/settings';
import { messageError, sendExtensionMessage, trustedMessage } from './extension/protocol';

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
        justification: '读取用户选择的文章 HTML，提取正文并完成文集整理。',
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
          throw new Error('扩展请求不可用。');
        return readExtensionSettings();
      case 'books.list':
        return collectionStore.books();
      case 'books.remove': {
        const { id } = z.object({ id: z.string().uuid() }).parse(message.input);
        await collectionStore.removeBook(id);
        return { ok: true };
      }
      case 'jobs.create':
      case 'jobs.get':
      case 'jobs.write':
      case 'jobs.cancel':
        await ensureRunner();
        return sendExtensionMessage('runner', message.method, message.input);
      default:
        throw new Error('扩展请求不可用。');
    }
  })().then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: messageError(error) }),
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
