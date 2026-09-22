import { productId } from '../../shared/branding';
import {
  AppError,
  errorResponse,
  isMessage,
  translate,
  defaultLocale,
  type Locale,
  type MessageDescriptor,
} from '../../shared/i18n';
import { getUiLocale } from '../lib/locale';

export const extensionContext = globalThis.location?.protocol === 'chrome-extension:';
export interface ExtensionMessage {
  channel: typeof productId;
  target: 'background' | 'runner';
  method: string;
  input?: unknown;
  locale?: Locale;
}
export async function sendExtensionMessage<T>(
  target: ExtensionMessage['target'],
  method: string,
  input?: unknown,
  locale: Locale = getUiLocale(),
): Promise<T> {
  const message: ExtensionMessage = { channel: productId, target, method, input, locale };
  const response = (await chrome.runtime.sendMessage(message)) as
    | { ok: true; value: T }
    | { ok: false; error: string; errorDetails?: MessageDescriptor }
    | undefined;
  if (!response)
    throw new AppError('error.extensionResponse', { name: translate(locale, 'brand.name') });
  if (!response.ok)
    throw isMessage(response.errorDetails)
      ? new AppError(response.errorDetails.key, response.errorDetails.params)
      : new AppError('error.generic');
  return response.value;
}
export function trustedMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  target: ExtensionMessage['target'],
): message is ExtensionMessage {
  return Boolean(
    message &&
    typeof message === 'object' &&
    (message as ExtensionMessage).channel === productId &&
    (message as ExtensionMessage).target === target &&
    sender.id === chrome.runtime.id &&
    (sender.url?.startsWith(chrome.runtime.getURL('')) ||
      (target === 'runner' && !sender.url && !sender.tab)),
  );
}
export function messageError(error: unknown, locale: Locale = defaultLocale): string {
  return errorResponse(error, locale).error;
}
