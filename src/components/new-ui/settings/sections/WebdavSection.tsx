import React from 'react';
import { i18n } from '@/services/i18n';
import type { SettingsTheme } from '../shared';

interface WebdavSectionProps {
  theme: SettingsTheme;
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
  onTest: () => void;
  onSave: () => void;
}

/**
 * WebDAV connection settings card. Pure presentational — all state and handlers
 * come from useWebdavSettings via props.
 */
const WebdavSection: React.FC<WebdavSectionProps> = ({
  theme,
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
  onTest,
  onSave,
}) => {
  const { colors, inputStyle, inputFocus, inputBlur } = theme;

  return (
    <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: colors.textPrimary }}>
          <span className="material-symbols-outlined text-lg" style={{ color: colors.primary }}>cloud</span>
          {i18n.t('settingsDialog.webdavTitle')}
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onTest}
            disabled={isTesting || isSaving}
            className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2"
            style={{ backgroundColor: colors.backgroundDark, color: colors.textSecondary, border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.backgroundCardHover}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.backgroundDark}
          >
            {isTesting ? (
              <>
                <span className="material-symbols-outlined animate-spin text-sm">refresh</span>
                {i18n.t('settingsDialog.webdavTesting')}
              </>
            ) : (
              i18n.t('settingsDialog.webdavTestConnection')
            )}
          </button>
          <button
            onClick={onSave}
            disabled={isTesting || isSaving}
            className="px-4 py-2 text-sm transition-all disabled:opacity-50 flex items-center gap-2"
            style={{ backgroundColor: colors.primary, color: '#fff', border: `1px solid ${colors.borderLight}`, borderRadius: 'var(--theme-card-radius)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = colors.primaryHover}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = colors.primary}
          >
            {isSaving ? (
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
      <div className="space-y-3">
        <input
          type="text"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://webdav.123pan.cn/webdav"
          className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
        />
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={i18n.t('settingsDialog.webdavUsername')}
          className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={i18n.t('settingsDialog.webdavPassword')}
          className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
        />
        {message && (
          <span className={`text-xs ${
            messageType === 'success' ? 'text-green-400' : 'text-red-400'
          }`}>
            {message}
          </span>
        )}
      </div>
    </section>
  );
};

export default WebdavSection;
