import { useI18n, useMessageState } from '../lib/i18n';
import { AppError, message } from '../../shared/i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, X } from 'lucide-react';
import {
  defaultSettings,
  settingsInputSchema,
  type SettingsInput,
  type SettingsStatus,
} from '../../shared/settings';
import { api } from '../lib/api';
import { extensionContext } from '../extension/protocol';
import { useCoverMode } from '../lib/display-preferences';

export function SettingsDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: SettingsStatus) => void;
}) {
  const { t, locale, setLocale } = useI18n();
  const [coverMode, setCoverMode] = useCoverMode();
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<SettingsStatus>({ ...defaultSettings, hasKey: false });
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useMessageState();
  const [tested, setTested] = useState(false);
  useEffect(() => {
    if (!open) {
      dialog.current?.close();
      setApiKey('');
      return;
    }
    dialog.current?.showModal();
    let cancelled = false;
    setLoading(true);
    setError('');
    setTested(false);
    setApiKey('');
    void api
      .settings()
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch((e) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  async function submit(action: 'save' | 'test' | 'clear') {
    setError('');
    setTested(false);
    const result = settingsInputSchema.safeParse({
      baseUrl: settings.baseUrl,
      model: settings.model,
      apiKey,
      clearKey: action === 'clear',
    });
    if (!result.success) {
      setError(message('error.settingsInput'));
      return;
    }
    const input: SettingsInput = result.data;
    setBusy(action);
    try {
      if (action !== 'clear' && !(await api.allowSites([input.baseUrl])))
        throw new AppError('error.apiPermission');
      if (action === 'test') {
        await api.testSettings(input);
        setTested(true);
      } else {
        const saved = await api.saveSettings(input);
        setSettings(saved);
        setApiKey('');
        onSaved(saved);
        if (action === 'save') onClose();
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy('');
    }
  }
  return (
    <dialog
      ref={dialog}
      className="api-settings-dialog"
      aria-labelledby="api-settings-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit('save');
        }}
      >
        <div className="api-settings-heading">
          <h2 id="api-settings-title">{t('common.settings')}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t('settings.close')}
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <label className="api-setting-field">
          {t('settings.language')}
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as 'zh-CN' | 'en')}
          >
            <option value="zh-CN">{t('settings.zh')}</option>
            <option value="en">{t('settings.en')}</option>
          </select>
        </label>
        <div className="api-setting-field">
          <span id="page-cover-setting">{t('settings.pageCovers')}</span>
          <div className="cover-mode-toggle" role="group" aria-labelledby="page-cover-setting">
            {(['preview', 'screenshot'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={coverMode === mode}
                onClick={() => setCoverMode(mode)}
              >
                {t(mode === 'preview' ? 'settings.previewImage' : 'settings.screenshot')}
              </button>
            ))}
          </div>
        </div>
        <label className="api-setting-field">
          {t('settings.apiKey')}
          <input
            type="password"
            value={apiKey}
            autoComplete="new-password"
            spellCheck={false}
            disabled={loading || Boolean(busy)}
            placeholder={settings.hasKey ? t('settings.keySaved') : t('settings.keyPlaceholder')}
            onChange={(event) => {
              setApiKey(event.target.value);
              setTested(false);
            }}
          />
        </label>
        <p className="api-key-note">
          {extensionContext ? t('settings.keyBrowser') : t('settings.keyServer')}
        </p>
        <details
          className="api-advanced"
          open={
            settings.baseUrl !== defaultSettings.baseUrl || settings.model !== defaultSettings.model
          }
        >
          <summary>{t('settings.advanced')}</summary>
          <label className="api-setting-field">
            {t('settings.endpoint')}
            <input
              type="url"
              value={settings.baseUrl}
              required
              disabled={loading || Boolean(busy)}
              onChange={(event) => {
                setSettings({ ...settings, baseUrl: event.target.value });
                setTested(false);
              }}
            />
          </label>
          <label className="api-setting-field">
            {t('settings.model')}
            <input
              value={settings.model}
              required
              disabled={loading || Boolean(busy)}
              onChange={(event) => {
                setSettings({ ...settings, model: event.target.value });
                setTested(false);
              }}
            />
          </label>
        </details>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {tested && (
          <p className="api-test-success" role="status">
            <Check size={16} />
            {t('settings.connected')}
          </p>
        )}
        <div className="api-settings-actions">
          {settings.hasKey && (
            <button
              type="button"
              className="text-button"
              disabled={loading || Boolean(busy)}
              onClick={() => void submit('clear')}
            >
              {t('settings.removeKey')}
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={loading || Boolean(busy) || (!apiKey && !settings.hasKey)}
            onClick={() => void submit('test')}
          >
            {busy === 'test' && <LoaderCircle className="spin" size={15} />}
            {t('settings.test')}
          </button>
          <button type="submit" className="button primary" disabled={loading || Boolean(busy)}>
            {busy === 'save' && <LoaderCircle className="spin" size={15} />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </dialog>
  );
}
