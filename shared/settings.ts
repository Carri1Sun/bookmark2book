import { z } from 'zod';

export const defaultSettings = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
};
export interface ModelSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}
export interface SettingsStatus {
  baseUrl: string;
  model: string;
  hasKey: boolean;
}
export const settingsInputSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    }, 'API 地址必须是无用户名、密码或查询参数的 HTTPS 地址。'),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(1000).optional(),
  clearKey: z.boolean().optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;
export function resolveSettings(input: SettingsInput, previous: ModelSettings): ModelSettings {
  const parsed = settingsInputSchema.parse(input);
  const baseUrl = parsed.baseUrl.replace(/\/+$/, '');
  if (
    !parsed.clearKey &&
    !parsed.apiKey &&
    previous.apiKey &&
    new URL(baseUrl).origin !== new URL(previous.baseUrl).origin
  ) {
    throw new Error('更换 API 服务地址时，请重新填写该服务的 API Key。');
  }
  return {
    baseUrl,
    model: parsed.model,
    apiKey: parsed.clearKey ? '' : parsed.apiKey || previous.apiKey,
  };
}
export function settingsStatus(settings: ModelSettings): SettingsStatus {
  return { baseUrl: settings.baseUrl, model: settings.model, hasKey: Boolean(settings.apiKey) };
}
