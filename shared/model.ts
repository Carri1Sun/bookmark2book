import { AppError, type MessageKey } from './i18n';
import { z } from 'zod';
import type { ModelSettings } from './settings';

import { collectionSystemPrompt, modelRetryPrompt } from './prompts';

function providerError(status: number): Error {
  const messages: Partial<Record<number, MessageKey>> = {
    401: 'error.api401',
    403: 'error.api403',
    402: 'error.api402',
    429: 'error.api429',
    400: 'error.api400',
    404: 'error.api404',
  };
  return new AppError(messages[status] || 'error.apiStatus', { status });
}
async function providerFetch(settings: ModelSettings, path: string, init: RequestInit) {
  if (!settings.apiKey) throw new AppError('error.missingKey');
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}${path}`, {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new AppError('error.apiConnect');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw providerError(response.status);
  }
  return response;
}
export async function testModelConnection(settings: ModelSettings): Promise<{ ok: true }> {
  const response = await providerFetch(settings, '/models', { signal: AbortSignal.timeout(15000) });
  let data: { data?: { id: string }[] };
  try {
    data = await response.json();
  } catch {
    throw new AppError('error.modelList');
  }
  if (!Array.isArray(data.data) || !data.data.some((model) => model.id === settings.model))
    throw new AppError('error.modelMissing');
  return { ok: true };
}
export function createModelClient(settings: ModelSettings, systemPrompt = collectionSystemPrompt) {
  return async function askModel<T>(
    prompt: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    maxTokens = 6500,
  ): Promise<T> {
    let retryHint = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const response = await providerFetch(settings, '/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: settings.model,
          temperature: 0.65,
          max_tokens: maxTokens,
          ...(new URL(settings.baseUrl).hostname === 'api.deepseek.com'
            ? { thinking: { type: 'disabled' } }
            : {}),
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt + retryHint },
          ],
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
      });
      try {
        const data = (await response.json()) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[];
        };
        if (data.choices?.[0]?.finish_reason === 'length')
          throw new Error('Model output exceeded the token limit');
        const content = data.choices?.[0]?.message?.content || '';
        signal.throwIfAborted();
        return schema.parse(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, '')));
      } catch {
        signal.throwIfAborted();
        retryHint = modelRetryPrompt;
      }
    }
    throw new AppError('error.modelFormat');
  };
}
