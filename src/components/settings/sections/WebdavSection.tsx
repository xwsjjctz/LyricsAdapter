import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsTheme } from '../shared';
import Button from '../../ui/Button';
import SettingsMessage from '../SettingsMessage';
import type { SettingsMessageState } from '../hooks/useSettingsMessage';

// Presentational WebDAV settings section used by the application settings panel.

interface WebdavSectionProps {
  theme: SettingsTheme;
  serverUrl: string;
  username: string;
  password: string;
  message: SettingsMessageState | null;
  isTesting: boolean;
  isSaving: boolean;
  isDirty: boolean;
  setServerUrl: (v: string) => void;
  setUsername: (v: string) => void;
  setPassword: (v: string) => void;
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
  isTesting,
  isSaving,
  isDirty,
  setServerUrl,
  setUsername,
  setPassword,
  onSave,
}) => {
  const { t } = useTranslation();
  const { colors, inputStyle, inputFocus, inputBlur } = theme;

  return (
    <section className="r-card p-4 border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
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
          placeholder={t('settingsDialog.webdavUsername')}
          className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('settingsDialog.webdavPassword')}
          className="w-full r-control py-2.5 px-3 text-sm focus:outline-none focus:ring-0 transition-all"
          style={inputStyle}
          onFocus={inputFocus}
          onBlur={inputBlur}
        />
      </div>

      <div className="mt-3 flex items-center justify-end gap-3">
        {isDirty && <span className="text-xs" role="status" style={{ color: colors.textMuted }}>{t('settingsDialog.unsaved')}</span>}
        <Button variant="primary" size="sm" onClick={onSave} disabled={isTesting || isSaving}>
          {isTesting || isSaving ? (
            <>
              <span className="material-symbols-rounded animate-spin text-sm">refresh</span>
              {t(isTesting ? 'settingsDialog.webdavTesting' : 'settingsDialog.saving')}
            </>
          ) : (
            t('settingsDialog.webdavConnectAndSave')
          )}
        </Button>
      </div>

      {message && <div className="mt-3"><SettingsMessage tone={message.tone}>{message.text}</SettingsMessage></div>}
    </section>
  );
};

export default WebdavSection;
