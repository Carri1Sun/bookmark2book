import {
  defaultSettings,
  resolveSettings,
  settingsStatus,
  type ModelSettings,
  type SettingsInput,
} from '../../shared/settings';

const key = 'api-settings';
export async function readExtensionSettings(): Promise<ModelSettings> {
  const value = (await chrome.storage.local.get(key))[key] as ModelSettings | undefined;
  return value
    ? resolveSettings(value, { ...defaultSettings, apiKey: '' })
    : { ...defaultSettings, apiKey: '' };
}
export async function saveExtensionSettings(input: SettingsInput) {
  const settings = resolveSettings(input, await readExtensionSettings());
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ [key]: settings });
  return settingsStatus(settings);
}
