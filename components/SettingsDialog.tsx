import React, { useState, useEffect } from 'react';
import { cookieManager } from '../services/cookieManager';
import { settingsManager } from '../services/settingsManager';
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
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<'success' | 'error' | null>(null);
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    if (isOpen) {
      setCookie(cookieManager.getCookie());
      setDownloadPath(settingsManager.getDownloadPath());
      setMessage(null);
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
      <div className="bg-[#1a2533] border border-white/10 rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">{i18n.t('settingsDialog.title')}</h2>
          <button
            onClick={handleClose}
            className="text-white/40 hover:text-white transition-colors"
            disabled={isValidating}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              {i18n.t('settingsDialog.cookie')}
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder={i18n.t('settingsDialog.pasteCookie')}
              className="w-full h-24 bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-0 transition-all resize-none"
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)';
                e.currentTarget.style.boxShadow = `0 0 20px ${colors.glowColor}`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              disabled={isValidating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              {i18n.t('settingsDialog.savePath')}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={downloadPath}
                onChange={(e) => setDownloadPath(e.target.value)}
                placeholder={i18n.t('settingsDialog.downloadFolderPath')}
                className="flex-1 bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-0 transition-all"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.05)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.07)';
                  e.currentTarget.style.boxShadow = `0 0 15px ${colors.glowColor}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
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
                className="px-4 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all disabled:opacity-50 flex items-center gap-2"
                title={i18n.t('settingsDialog.savePath')}
              >
                <span className="material-symbols-outlined text-base">folder_open</span>
              </button>
            </div>
            <p className="mt-1.5 text-xs text-white/40">
              {i18n.t('settingsDialog.tip')}
            </p>
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
              className="flex-1 px-4 py-3 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 transition-all disabled:opacity-50"
            >
              {i18n.t('settingsDialog.close')}
            </button>
            <button
              onClick={handleSave}
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl bg-primary text-white hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
