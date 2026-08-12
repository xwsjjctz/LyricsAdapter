import { useCallback, useEffect, useState } from 'react';
import { webdavClient } from '@/services/webdavClient';
import { useTranslation } from 'react-i18next';
import { logger } from '@/services/logger';

// Owns the WebDAV form lifecycle independently from the settings panel layout.

interface WebdavFormConfig {
  serverUrl: string;
  username: string;
  password: string;
}

interface UseWebdavSettingsResult {
  serverUrl: string;
  username: string;
  password: string;
  message: string | null;
  messageType: 'success' | 'error' | null;
  isTesting: boolean;
  isSaving: boolean;
  setServerUrl: (v: string) => void;
  setUsername: (v: string) => void;
  setPassword: (v: string) => void;
  handleTest: () => Promise<void>;
  handleSave: () => void;
}

/**
 * Owns all WebDAV settings state and handlers. Loads the persisted config on
 * mount and exposes form fields plus test/save actions. Extracted from the
 * monolithic SettingsPanel to keep that shell a thin assembler.
 */
export function useWebdavSettings(): UseWebdavSettingsResult {
  const { t } = useTranslation();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const config = webdavClient.getConfig();
    if (config) {
      setServerUrl(config.serverUrl);
      setUsername(config.username);
      setPassword(config.password);
    }
  }, []);

  const getFormConfig = useCallback((): WebdavFormConfig | null => {
    if (!serverUrl.trim() || !username.trim() || !password.trim()) {
      setMessage(t('settingsDialog.webdavFillAll'));
      setMessageType('error');
      return null;
    }
    return {
      serverUrl: serverUrl.trim(),
      username: username.trim(),
      password: password.trim(),
    };
  }, [serverUrl, username, password]);

  const handleTest = useCallback(async () => {
    const config = getFormConfig();
    if (!config) return;
    setIsTesting(true);
    try {
      const result = await webdavClient.testConnection(config);
      setMessage(result.message);
      setMessageType(result.success ? 'success' : 'error');
    } finally {
      setIsTesting(false);
    }
  }, [getFormConfig]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    try {
      const config = getFormConfig();
      if (!config) return;
      webdavClient.saveConfig(config);
      setMessage(t('settingsDialog.saved'));
      setMessageType('success');
      setTimeout(() => { setMessage(null); setMessageType(null); }, 3000);
    } catch (err) {
      setMessage(t('settingsDialog.saveFailed'));
      setMessageType('error');
      logger.error('[SettingsPanel] WebDAV save failed:', err);
    } finally {
      setIsSaving(false);
    }
  }, [getFormConfig]);

  return {
    serverUrl,
    username,
    password,
    message,
    messageType,
    isTesting,
    isSaving,
    setServerUrl,
    setUsername,
    setPassword,
    handleTest,
    handleSave,
  };
}
