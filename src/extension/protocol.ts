export const extensionContext = globalThis.location?.protocol === 'chrome-extension:';
export interface ExtensionMessage {
  channel: 'bookmark-press';
  target: 'background' | 'runner';
  method: string;
  input?: unknown;
}
export async function sendExtensionMessage<T>(
  target: ExtensionMessage['target'],
  method: string,
  input?: unknown,
): Promise<T> {
  const message: ExtensionMessage = { channel: 'bookmark-press', target, method, input };
  const response = (await chrome.runtime.sendMessage(message)) as
    { ok: true; value: T } | { ok: false; error: string } | undefined;
  if (!response) throw new Error('扩展未能响应，请重新打开拾页。');
  if (!response.ok) throw new Error(response.error);
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
    (message as ExtensionMessage).channel === 'bookmark-press' &&
    (message as ExtensionMessage).target === target &&
    sender.id === chrome.runtime.id &&
    (sender.url?.startsWith(chrome.runtime.getURL('')) ||
      (target === 'runner' && !sender.url && !sender.tab)),
  );
}
export function messageError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error)
    return '输入格式有误，请检查设置或所选内容。';
  const message = error instanceof Error ? error.message : '';
  return /^(API|请|当前|文章|模型|浏览器|扩展|更换|无法|未找到|已有|任务|目录|网页)/.test(message)
    ? message
    : '操作失败，请稍后重试。';
}
