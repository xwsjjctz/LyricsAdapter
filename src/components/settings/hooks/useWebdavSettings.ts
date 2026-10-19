import { useCallback, useEffect, useRef, useState } from 'react';
import { webdavClient } from '@/services/webdavClient';
import { useTranslation } from 'react-i18next';
import { logger } from '@/services/logger';

// Owns the WebDAV form lifecycle independently from the settings panel layout.

interface WebdavFormConfig {
  serverUrl: string;
  username: string;
  password: string;
}

const EMPTY_CONFIG: WebdavFormConfig = { serverUrl: '', username: '', password: '' };
const MESSAGE_DURATION_MS = 3000;

interface UseWebdavSettingsResult {
  serverUrl: string;
  username: string;
  password: string;
  message: string | null;
  messageType: 'success' | 'error' | null;
  isTesting: boolean;
  isSaving: boolean;
  /** The form differs from the stored connection. */
  isDirty: boolean;
  setServerUrl: (v: string) => void;
  setUsername: (v: string) => void;
  setPassword: (v: string) => void;
  handleSave: () => Promise<void>;
}

function storedConfig(): WebdavFormConfig {
  const config = webdavClient.getConfig();
  return config ? { serverUrl: config.serverUrl, username: config.username, password: config.password } : EMPTY_CONFIG;
}

/**
 * Owns all WebDAV settings state and handlers. A connection is a credential, so
 * it is only stored after the server accepts it: Save tests first, then stores.
 */
export function useWebdavSettings(): UseWebdavSettingsResult {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<WebdavFormConfig>(storedConfig);
  const [serverUrl, setServerUrl] = useState(saved.serverUrl);
  const [username, setUsername] = useState(saved.username);
  const [password, setPassword] = useState(saved.password);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const messageTimer = useRef<ReturnType<typeof setTimeout>>();
  const isDirty = serverUrl.trim() !== saved.serverUrl || username.trim() !== saved.username || password.trim() !== saved.password;

  useEffect(() => () => clearTimeout(messageTimer.current), []);

  const showMessage = useCallback((text: string, type: 'success' | 'error', transient = false) => {
    clearTimeout(messageTimer.current);
    setMessage(text);
    setMessageType(type);
    if (transient) messageTimer.current = setTimeout(() => { setMessage(null); setMessageType(null); }, MESSAGE_DURATION_MS);
  }, []);

  const handleSave = useCallback(async () => {
    const config = { serverUrl: serverUrl.trim(), username: username.trim(), password: password.trim() };
    if (!config.serverUrl || !config.username || !config.password) {
      showMessage(t('settingsDialog.webdavFillAll'), 'error');
      return;
    }
    setMessage(null);
    setIsTesting(true);
    try {
      const result = await webdavClient.testConnection(config);
      if (!result.success) {
        showMessage(result.message, 'error');
        return;
      }
      setIsTesting(false);
      setIsSaving(true);
      await webdavClient.saveConfig(config);
      setSaved(config);
      showMessage(t('settingsDialog.webdavConnectedSaved'), 'success', true);
    } catch (err) {
      showMessage(t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsPanel] WebDAV save failed:', err);
    } finally {
      setIsTesting(false);
      setIsSaving(false);
    }
  }, [serverUrl, username, password, showMessage, t]);

  return {
    serverUrl,
    username,
    password,
    message,
    messageType,
    isTesting,
    isSaving,
    isDirty,
    setServerUrl,
    setUsername,
    setPassword,
    handleSave,
  };
}
