import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import { resolveSettings, type ModelSettings, type SettingsInput } from '../shared/settings';

const filename = path.join(config.dataDir, 'api-settings.json');
export async function readSettings(): Promise<ModelSettings> {
  try {
    const saved = JSON.parse(await fs.readFile(filename, 'utf8')) as ModelSettings;
    return resolveSettings(saved, { apiKey: '', baseUrl: config.baseUrl, model: config.model });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('API 设置无法读取，请重新保存设置。');
    return { apiKey: config.key, baseUrl: config.baseUrl, model: config.model };
  }
}
export async function saveSettings(input: SettingsInput): Promise<ModelSettings> {
  const settings = resolveSettings(input, await readSettings());
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(settings), { mode: 0o600 });
  await fs.rename(temporary, filename);
  return settings;
}
