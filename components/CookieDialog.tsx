import React, { useState, useEffect } from 'react';
import { cookieManager } from '../services/cookieManager';
import { logger } from '../services/logger';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

interface CookieDialogProps {
  isOpen: boolean;
  onClose: (success: boolean) => void;
}

const CookieDialog: React.FC<CookieDialogProps> = ({ isOpen, onClose }) => {
  const [cookie, setCookie] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());
  const colors = currentTheme.colors;

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

  useEffect(() => {
    if (isOpen) {
      setCookie(cookieManager.getCookie());
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cookie.trim()) {
      setError(i18n.t('cookieDialog.enterCookie'));
      return;
    }

    setIsValidating(true);
    setError(null);

    try {
      // Save cookie temporarily for validation
      cookieManager.setCookie(cookie.trim());

      // Validate cookie
      const status = await cookieManager.validateCookie();

      if (status.valid) {
        logger.debug('[CookieDialog] Cookie validated successfully');
        onClose(true);
      } else {
        setError(status.message || i18n.t('cookieDialog.validateFailed'));
        cookieManager.clearCookie();
      }
    } catch (err) {
      setError(i18n.t('cookieDialog.validateError'));
      cookieManager.clearCookie();
    } finally {
      setIsValidating(false);
    }
  };

  const handleClose = () => {
    if (!isValidating) {
      onClose(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="rounded-2xl p-6 w-full max-w-lg mx-4 shadow-2xl" style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold" style={{ color: colors.textPrimary }}>{i18n.t('cookieDialog.title')}</h2>
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

        <p className="text-sm mb-4" style={{ color: colors.textSecondary }}>
          {i18n.t('cookieDialog.description')}
        </p>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: colors.textSecondary }}>
              {i18n.t('cookieDialog.cookieLabel')}
            </label>
            <textarea
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder={i18n.t('cookieDialog.pastePlaceholder')}
              className="w-full h-32 rounded-xl p-3 text-sm focus:outline-none transition-all resize-none"
              style={{ backgroundColor: colors.backgroundCard, border: `1px solid ${colors.borderLight}`, color: colors.textPrimary }}
              disabled={isValidating}
            />
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">error</span>
                {error}
              </div>
            </div>
          )}

          <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: colors.backgroundCard }}>
            <p className="text-xs" style={{ color: colors.textMuted }}>
              <span className="material-symbols-outlined text-sm align-text-bottom mr-1">info</span>
              {i18n.t('cookieDialog.howToGet')}
            </p>
            <ol className="text-xs mt-2 ml-5 list-decimal space-y-1" style={{ color: colors.textMuted }}>
              <li>{i18n.t('cookieDialog.step1')}</li>
              <li>{i18n.t('cookieDialog.step2')}</li>
              <li>{i18n.t('cookieDialog.step3')}</li>
              <li>{i18n.t('cookieDialog.step4')}</li>
              <li>{i18n.t('cookieDialog.step5')}</li>
            </ol>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 mb-4">
            <p className="text-xs text-yellow-400/80">
              <span className="material-symbols-outlined text-sm align-text-bottom mr-1">warning</span>
              {i18n.t('cookieDialog.browserLimit')}
            </p>
            <p className="text-xs text-yellow-400/60 mt-1 ml-5">
              {i18n.t('cookieDialog.browserLimitDesc')}
            </p>
            <p className="text-xs text-yellow-400/40 mt-1 ml-5">
              {i18n.t('cookieDialog.buildDesktop')}
            </p>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl transition-all disabled:opacity-50"
              style={{ backgroundColor: colors.backgroundCard, color: colors.textSecondary }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundCard}
            >
              {i18n.t('cookieDialog.cancel')}
            </button>
            <button
              type="submit"
              disabled={isValidating}
              className="flex-1 px-4 py-3 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ backgroundColor: colors.primary, color: colors.textPrimary }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
            >
              {isValidating ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                  {i18n.t('cookieDialog.validating')}
                </>
              ) : (
                i18n.t('cookieDialog.save')
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CookieDialog;