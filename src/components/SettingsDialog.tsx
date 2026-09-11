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

export function SettingsDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (settings: SettingsStatus) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<SettingsStatus>({ ...defaultSettings, hasKey: false });
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
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
        if (!cancelled) setError(e.message);
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
      setError('请填写有效的 HTTPS API 地址与模型名称。');
      return;
    }
    const input: SettingsInput = result.data;
    setBusy(action);
    try {
      if (action !== 'clear' && !(await api.allowSites([input.baseUrl])))
        throw new Error('未获得 API 网站访问权限，设置尚未保存。');
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
      setError((e as Error).message);
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
          <h2 id="api-settings-title">设置</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭设置"
            disabled={Boolean(busy)}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <label className="api-setting-field">
          API Key
          <input
            type="password"
            value={apiKey}
            autoComplete="new-password"
            spellCheck={false}
            disabled={loading || Boolean(busy)}
            placeholder={settings.hasKey ? '已保存，留空保留现有密钥' : '填写你的 API Key'}
            onChange={(event) => {
              setApiKey(event.target.value);
              setTested(false);
            }}
          />
        </label>
        <p className="api-key-note">
          {extensionContext
            ? '密钥仅保存在当前浏览器，用于直接调用你配置的 API。'
            : '密钥保存在本机服务的配置中。'}
        </p>
        <details
          className="api-advanced"
          open={
            settings.baseUrl !== defaultSettings.baseUrl || settings.model !== defaultSettings.model
          }
        >
          <summary>API 地址与模型</summary>
          <label className="api-setting-field">
            API 地址
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
            模型
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
            连接成功，模型可用。
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
              删除密钥
            </button>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={loading || Boolean(busy) || (!apiKey && !settings.hasKey)}
            onClick={() => void submit('test')}
          >
            {busy === 'test' && <LoaderCircle className="spin" size={15} />}测试连接
          </button>
          <button type="submit" className="button primary" disabled={loading || Boolean(busy)}>
            {busy === 'save' && <LoaderCircle className="spin" size={15} />}保存
          </button>
        </div>
      </form>
    </dialog>
  );
}
