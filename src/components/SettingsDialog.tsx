import React, { useState, useEffect } from 'react';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
import { webdavClient } from '../services/webdavClient';
import { logger } from '../services/logger';
import { getDesktopAPI } from '../services/desktopAdapter';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ isOpen, onClose }) => {
  const [cookie, setCookie] = useState('');
  const [downloadPath, setDownloadPath] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [webdavServerUrl, setWebdavServerUrl] = useState('');
  const [webdavUsername, setWebdavUsername] = useState('');
  const [webdavPassword, setWebdavPassword] = useState('');
  const [isTestingWebdav, setIsTestingWebdav] = useState(false);
  const [webdavMessage, setWebdavMessage] = useState<string | null>(null);
  const [webdavMessageType, setWebdavMessageType] = useState<'success' | 'error' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    if (isOpen) {
      (async () => {
        await cookieManager.ensureLoaded();
        await settingsManager.ensureLoaded();
        setCookie(cookieManager.getCookie());
        setDownloadPath(settingsManager.getDownloadPath());
        const webdavConfig = webdavClient.getConfig();
        if (webdavConfig) {
          setWebdavServerUrl(webdavConfig.serverUrl);
          setWebdavUsername(webdavConfig.username);
          setWebdavPassword(webdavConfig.password);
        }
        setMessage(null);
        setWebdavMessage(null);
      })();
    }
  }, [isOpen]);

  // Subscribe to language changes
  useEffect(() => {
    const unsubscribe = i18n.subscribe(() => {
      setLanguageVersion(v => v + 1);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage(null);
      setMessageType(null);
    }, 3000);
  };

  const handleSave = async () => {
    setIsValidating(true);
    setMessage(null);

    try {
      // Save cookie
      if (cookie.trim()) {
        cookieManager.setCookie(cookie.trim());
        const status = await cookieManager.validateCookie();
        if (!status.valid) {
          showMessage(i18n.t('settingsDialog.cookieInvalid'), 'error');
          cookieManager.clearCookie();
          setIsValidating(false);
          return;
        }
      }

      // Save download path
      settingsManager.setDownloadPath(downloadPath.trim());

      // Save WebDAV config
      if (webdavServerUrl.trim() && webdavUsername.trim() && webdavPassword.trim()) {
        webdavClient.saveConfig({
          serverUrl: webdavServerUrl.trim(),
          username: webdavUsername.trim(),
          password: webdavPassword.trim(),
        });
      }

      showMessage(i18n.t('settingsDialog.saved'), 'success');
    } catch (err) {
      showMessage(i18n.t('settingsDialog.saveFailed'), 'error');
      logger.error('[SettingsDialog] Save failed:', err);
    } finally {
      setIsValidating(false);
    }
  };

  const handleClose = () => {
    if (!isValidating) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const colors = currentTheme.colors;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold" style={{ color: colors.textPrimary }}>{i18n.t('settingsDialog.title')}</h2>
          <button
            onClick={handleClose}
            className="transition-colors"
            style={{ color: colors.textMuted }}
            disabled={isValidating}
            onMouseEnter={e => e.currentTarget.style.color = colors.textPrimary}
            onMouseLeave={e => e.currentTarget.style.color = colors.textMuted}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: colors.textSecondary }}>
              {i18n.t('settingsDialog.cookie')}
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder={i18n.t('settingsDialog.pasteCookie')}
              className="w-full h-24 rounded-xl p-3 text-sm focus:outline-none focus:ring-0 transition-all resize-none"
              style={{
                backgroundColor: colors.backgroundCard,
                border: `1px solid ${colors.borderLight}`,
                color: colors.textPrimary,
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                e.currentTarget.style.boxShadow = `0 0 20px ${colors.glowColor}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = colors.backgroundCard;
                e.currentTarget.style.boxShadow = 'none';
              }}
              disabled={isValidating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: colors.textSecondary }}>
              {i18n.t('settingsDialog.savePath')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder={i18n.t('settingsDialog.downloadFolderPath')}
                className="flex-1 rounded-xl py-3 px-4 text-sm focus:outline-none focus:ring-0 transition-all"
                style={{
                  backgroundColor: colors.backgroundCard,
                  border: `1px solid ${colors.borderLight}`,
                  color: colors.textPrimary,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                  e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCard;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                disabled={isValidating}
              />
              <button
                onClick={async () => {
                  const desktopAPI = getDesktopAPI();
                  if (desktopAPI?.selectDownloadFolder) {
                    const result = await desktopAPI.selectDownloadFolder();
                    if (result.success && result.path) {
                      setDownloadPath(result.path);
                    }
                  }
                }}
                disabled={isValidating}
                className="px-4 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: colors.backgroundCard, color: colors.textPrimary }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundCard}
                title={i18n.t('settingsDialog.savePath')}
              >
                <span className="material-symbols-outlined text-base">folder_open</span>
              </button>
            </div>
            <p className="mt-1.5 text-xs" style={{ color: colors.textMuted }}>
              {i18n.t('settingsDialog.tip')}
            </p>
          </div>

          <div className="pt-2 border-t" style={{ borderColor: colors.borderLight }}>
            <h3 className="text-sm font-medium mb-3" style={{ color: colors.textPrimary }}>
              {i18n.t('settingsDialog.webdavTitle')}
            </h3>
            <div className="space-y-3">
              <input
                type="text"
                value={webdavServerUrl}
                onChange={(e) => setWebdavServerUrl(e.target.value)}
                placeholder="https://webdav.123pan.cn/webdav"
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={{
                  backgroundColor: colors.backgroundCard,
                  border: `1px solid ${colors.borderLight}`,
                  color: colors.textPrimary,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                  e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCard;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                disabled={isValidating}
              />
              <input
                type="text"
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavUsername')}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={{
                  backgroundColor: colors.backgroundCard,
                  border: `1px solid ${colors.borderLight}`,
                  color: colors.textPrimary,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                  e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCard;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                disabled={isValidating}
              />
              <input
                type="password"
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
                placeholder={i18n.t('settingsDialog.webdavPassword')}
                className="w-full rounded-xl py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
                style={{
                  backgroundColor: colors.backgroundCard,
                  border: `1px solid ${colors.borderLight}`,
                  color: colors.textPrimary,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCardHover;
                  e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = colors.backgroundCard;
                  e.currentTarget.style.boxShadow = 'none';
                }}
                disabled={isValidating}
              />
              {webdavMessage && (
                <div className={`p-2 rounded-lg text-xs ${
                  webdavMessageType === 'success'
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}>
                  {webdavMessage}
                </div>
              )}
              <button
                onClick={async () => {
                  if (!webdavServerUrl.trim() || !webdavUsername.trim() || !webdavPassword.trim()) {
                    setWebdavMessage(i18n.t('settingsDialog.webdavFillAll'));
                    setWebdavMessageType('error');
                    return;
                  }
                  setIsTestingWebdav(true);
                  webdavClient.saveConfig({
                    serverUrl: webdavServerUrl.trim(),
                    username: webdavUsername.trim(),
                    password: webdavPassword.trim(),
                  });
                  const result = await webdavClient.testConnection();
                  setWebdavMessage(result.message);
                  setWebdavMessageType(result.success ? 'success' : 'error');
                  setIsTestingWebdav(false);
                }}
                disabled={isTestingWebdav}
                className="px-4 py-2 rounded-xl text-sm transition-all disabled:opacity-50 flex items-center gap-2"
                style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundCard}
              >
                {isTestingWebdav ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                    {i18n.t('settingsDialog.webdavTesting')}
                  </>
                ) : (
                  i18n.t('settingsDialog.webdavTestConnection')
                )}
              </button>
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-xl text-sm ${
              messageType === 'success' 
                ? 'bg-green-500/10 border border-green-500/30 text-green-400' 
                : 'bg-red-500/10 border border-red-500/30 text-red-400'
            }`}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">
                  {messageType === 'success' ? 'check' : 'error'}
                </span>
                {message}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              onClick={handleClose}
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl transition-all disabled:opacity-50"
              style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundCard}
            >
              {i18n.t('settingsDialog.close')}
            </button>
            <button
              onClick={handleSave}
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: colors.primary, color: colors.textPrimary }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
            >
              {isValidating ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                  {i18n.t('settingsDialog.saving')}
                </>
              ) : (
                i18n.t('settingsDialog.save')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
