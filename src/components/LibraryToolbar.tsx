import React, { memo } from 'react';
import { i18n } from '../services/i18n';
import { useTranslation } from 'react-i18next';
import { ThemeColors } from '../types/theme';
import type { SlotId } from '../types';
import { readableForeground } from '../services/colorUtils';
import { WEBDAV_AUDIO_UPLOAD_ENABLED } from '../constants/features';

interface LibraryToolbarProps {
  dataSource: SlotId;
  colors: ThemeColors;
  onImportClick?: () => void;
  importDisabled?: boolean;
  onRefreshCloud?: () => void;
  isRefreshing?: boolean;
  trackCount: number;
  playlistTitle?: string;
  playlistTrackCount?: number;
  importProgress?: { loaded: number; total: number } | null | undefined;
  loadProgress?: { loaded: number; total: number } | null | undefined;
  searchBox?: React.ReactNode | undefined;
}

function getDataSourceTitle(dataSource: SlotId): string {
  if (dataSource === 'playlist') return i18n.t('sidebar.playlists');
  return i18n.t(`sidebar.${dataSource}`);
}

/**
 * Library header: title, progress/import status, search box slot,
 * search and source-specific import/refresh controls.
 */
const LibraryToolbar: React.FC<LibraryToolbarProps> = memo(({
  dataSource,
  colors,
  onImportClick,
  importDisabled = false,
  onRefreshCloud,
  isRefreshing = false,
  trackCount,
  playlistTitle,
  playlistTrackCount,
  importProgress,
  loadProgress,
  searchBox,
}) => {
  const { t } = useTranslation();
  const localImportForeground = readableForeground(colors.primary);
  const renderImportButton = (icon: 'upload_file' | 'cloud_upload') => {
    if (!onImportClick) return null;

    return (
      <button
        onClick={onImportClick}
        disabled={importDisabled}
        className="w-10 h-10 shrink-0 flex items-center justify-center transition-colors"
        style={{
          borderRadius: 'var(--theme-control-radius)',
          color: importDisabled
            ? colors.textMuted
            : dataSource === 'local'
              ? localImportForeground
              : '#fff',
          backgroundColor: importDisabled ? colors.backgroundCard : colors.primary,
          border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
          boxShadow: importDisabled ? 'none' : 'var(--theme-elevated-shadow)',
          cursor: importDisabled ? 'not-allowed' : 'pointer',
          opacity: importDisabled ? 0.55 : 1,
        }}
        aria-label={t('sidebar.importFiles')}
      >
        <span className="material-symbols-outlined text-[22px]">{icon}</span>
      </button>
    );
  };

  return (
    <div className="library-toolbar mb-4 flex-shrink-0 flex items-center justify-between">
      <div className="library-toolbar-leading">
        <h1 className="text-3xl" style={{ color: 'var(--theme-text-primary, #fff)', fontWeight: 'var(--theme-text-heading-weight)', letterSpacing: 'var(--theme-heading-letter-spacing)' }}>
          {playlistTitle ?? getDataSourceTitle(dataSource)}
        </h1>
        <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
          {importProgress ? (
            `${t('library.importing')} ${importProgress.loaded}/${importProgress.total}`
          ) : dataSource === 'cloud' && loadProgress ? (
            `${t('library.loadingMetadata')}${loadProgress.loaded}/${loadProgress.total}`
          ) : (
            <>
              {playlistTrackCount ?? trackCount} {t('library.trackCount')}
            </>
          )}
        </p>
        {(importProgress || (dataSource === 'cloud' && loadProgress)) && (
          <div className="mt-2 w-48 overflow-hidden" style={{ backgroundColor: 'var(--theme-control-slider-track)', height: 'var(--theme-progress-height)', borderRadius: 'var(--theme-progress-radius)' }}>
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${((importProgress || loadProgress)!.loaded / (importProgress || loadProgress)!.total) * 100}%`,
                backgroundColor: 'var(--theme-control-slider-fill)',
                borderRadius: 'var(--theme-progress-radius)',
              }}
            />
          </div>
        )}
      </div>
      <div className="library-toolbar-actions flex items-center gap-2">
        {searchBox}
        {dataSource === 'cloud' && (
          <>
            {/* Keep the upload control dormant while audio uploads are paused. */}
            <button
              onClick={onRefreshCloud}
              disabled={isRefreshing}
              className="w-10 h-10 shrink-0 flex items-center justify-center"
              style={{
                borderRadius: 'var(--theme-control-radius)',
                color: colors.textSecondary,
                backgroundColor: colors.backgroundCard,
                border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
                boxShadow: 'var(--theme-elevated-shadow)',
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                opacity: isRefreshing ? 0.7 : 1,
                transition: 'background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease',
              }}
              onMouseEnter={isRefreshing ? undefined : (e => { e.currentTarget.style.backgroundColor = colors.backgroundCardHover; })}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
              aria-label={t('library.refresh')}
            >
              <span
                className={`material-symbols-outlined${isRefreshing ? ' animate-spin' : ''}`}
                style={{ fontSize: '22px' }}
              >
                refresh
              </span>
            </button>
            {WEBDAV_AUDIO_UPLOAD_ENABLED && renderImportButton('cloud_upload')}
          </>
        )}
        {dataSource === 'local' && renderImportButton('upload_file')}
      </div>
    </div>
  );
});

export default LibraryToolbar;
