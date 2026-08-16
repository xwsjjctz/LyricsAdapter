import React, { memo } from 'react';
import { i18n } from '../services/i18n';
import { useTranslation } from 'react-i18next';
import { ThemeColors } from '../types/theme';
import type { SlotId } from '../types';
import { readableForeground } from '../services/colorUtils';

interface LibraryToolbarProps {
  dataSource: SlotId;
  colors: ThemeColors;
  isEditMode: boolean;
  selectedCount: number;
  showEditDropdown: boolean;
  setShowEditDropdown: (v: boolean) => void;
  onToggleEditMode: () => void;
  onBatchDelete: () => void;
  onImportClick?: () => void;
  importDisabled?: boolean;
  importDisabledReason?: string | undefined;
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
 * edit-mode toggle with batch-delete dropdown, and filter-type switch.
 */
const LibraryToolbar: React.FC<LibraryToolbarProps> = memo(({
  dataSource,
  colors,
  isEditMode,
  selectedCount,
  showEditDropdown,
  setShowEditDropdown,
  onToggleEditMode,
  onBatchDelete,
  onImportClick,
  importDisabled = false,
  importDisabledReason,
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
        className="w-10 h-10 flex items-center justify-center transition-colors"
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
        title={importDisabled ? importDisabledReason : t('sidebar.importFiles')}
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
          ) : isEditMode ? (
            `${selectedCount} ${t('library.selectedCount')}`
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
        {dataSource === 'cloud' ? (
          <>
            {/* Cloud：刷新 + 上传到 WebDAV */}
            <button
              onClick={onRefreshCloud}
              disabled={isRefreshing}
              className="w-10 h-10 flex items-center justify-center"
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
              title={t('library.refresh')}
              aria-label={t('library.refresh')}
            >
              <span
                className={`material-symbols-outlined${isRefreshing ? ' animate-spin' : ''}`}
                style={{ fontSize: '22px' }}
              >
                refresh
              </span>
            </button>
            {renderImportButton('cloud_upload')}
          </>
        ) : (
          /* Local：编辑按钮 + 下拉删除菜单 */
          <div
            className="relative"
            onMouseEnter={() => isEditMode && setShowEditDropdown(true)}
            onMouseLeave={() => isEditMode && setShowEditDropdown(false)}
          >
            <button
              onClick={onToggleEditMode}
              className="w-10 h-10 flex items-center justify-center relative"
              style={{
                borderRadius: showEditDropdown ? 'var(--theme-control-radius) var(--theme-control-radius) 0 0' : 'var(--theme-control-radius)',
                color: isEditMode ? '#fff' : colors.textSecondary,
                backgroundColor: isEditMode ? colors.success : colors.backgroundCard,
                boxShadow: isEditMode ? `0 0 20px ${colors.success}80` : 'var(--theme-elevated-shadow)',
                border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
                transition: 'border-radius 0.25s ease, background-color 0.2s ease, box-shadow 0.2s ease, color 0.2s ease',
              }}
            >
              <span
                className="material-symbols-outlined absolute"
                style={{
                  opacity: isEditMode ? 1 : 0,
                  transform: isEditMode ? 'scale(1)' : 'scale(0.4)',
                  transition: 'opacity 0.2s ease, transform 0.25s ease',
                }}
              >
                check
              </span>
              <span
                className="material-symbols-outlined absolute"
                style={{
                  opacity: isEditMode ? 0 : 1,
                  transform: isEditMode ? 'scale(0.4)' : 'scale(1)',
                  transition: 'opacity 0.2s ease, transform 0.25s ease',
                }}
              >
                edit
              </span>
            </button>

            {/* 下拉菜单：删除选中 */}
            <div
              className="overflow-hidden"
              style={{
                position: 'absolute',
                right: 0,
                top: 'calc(100% - 2px)',
                zIndex: 50,
                width: 40,
                transform: showEditDropdown ? 'scaleY(1)' : 'scaleY(0)',
                transformOrigin: 'top center',
                opacity: showEditDropdown ? 1 : 0,
                transition: 'transform 0.25s ease, opacity 0.2s ease',
                background: `linear-gradient(180deg, ${colors.backgroundSidebar}f8 0%, ${colors.backgroundDark}f2 100%)`,
                backdropFilter: 'blur(20px)',
                borderRadius: '0 0 var(--theme-control-radius) var(--theme-control-radius)',
                border: 'var(--theme-control-border-width) solid var(--theme-control-container-border)',
                borderTop: 'none',
                boxShadow: showEditDropdown ? `0 8px 24px rgba(0,0,0,0.18)` : 'none',
                pointerEvents: showEditDropdown ? 'auto' : 'none',
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowEditDropdown(false);
                  onBatchDelete();
                }}
                disabled={selectedCount === 0}
                className="w-10 h-10 flex items-center justify-center transition-all"
                style={{
                  backgroundColor: selectedCount > 0 ? colors.error : colors.backgroundCard,
                  color: selectedCount > 0 ? '#fff' : colors.textMuted,
                  opacity: selectedCount > 0 ? 1 : 0.4,
                  cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
                  boxShadow: selectedCount > 0 ? `0 0 16px ${colors.error}60` : 'none',
                }}
                onMouseEnter={e => {
                  if (selectedCount > 0) e.currentTarget.style.backgroundColor = `${colors.error}dd`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = selectedCount > 0 ? colors.error : colors.backgroundCard;
                }}
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            </div>
          </div>
        )}
        {dataSource === 'local' && renderImportButton('upload_file')}
      </div>
    </div>
  );
});

export default LibraryToolbar;
