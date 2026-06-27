import React, { memo } from 'react';
import { i18n } from '../services/i18n';
import { ThemeColors } from '../types/theme';

interface UniqueCategory {
  name: string;
  [key: string]: unknown;
}

interface LibraryToolbarProps {
  dataSource: 'local' | 'cloud';
  colors: ThemeColors;
  isEditMode: boolean;
  selectedCount: number;
  showEditDropdown: boolean;
  setShowEditDropdown: (v: boolean) => void;
  onToggleEditMode: () => void;
  onBatchDelete: () => void;
  onRefreshCloud?: () => void;
  isRefreshing?: boolean;
  filterType: 'default' | 'album' | 'artist';
  onFilterTypeChange: (t: 'default' | 'album' | 'artist') => void;
  onCategoryChange: (s: string | null) => void;
  uniqueAlbums: UniqueCategory[];
  uniqueArtists: UniqueCategory[];
  trackCount: number;
  importProgress?: { loaded: number; total: number } | null | undefined;
  loadProgress?: { loaded: number; total: number } | null | undefined;
  searchBox?: React.ReactNode | undefined;
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
  onRefreshCloud,
  isRefreshing = false,
  filterType,
  onFilterTypeChange,
  onCategoryChange,
  uniqueAlbums,
  uniqueArtists,
  trackCount,
  importProgress,
  loadProgress,
  searchBox,
}) => {
  return (
    <div className="mb-4 flex-shrink-0 flex items-center justify-between gap-5">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span
            className="flex size-10 items-center justify-center rounded-xl"
            style={{
              backgroundColor: colors.controlActive,
              color: colors.primary,
              boxShadow: `0 14px 30px -22px ${colors.glowColor}`,
            }}
          >
            <span className="material-symbols-outlined text-[22px]">{dataSource === 'cloud' ? 'cloud' : 'hard_drive'}</span>
          </span>
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight truncate" style={{ color: 'var(--theme-text-primary, #fff)' }}>
              {i18n.t(`sidebar.${dataSource}`)}
            </h1>
          </div>
        </div>
        <p className="mt-1 text-sm" style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
          {importProgress ? (
            `${i18n.t('library.importing')} ${importProgress.loaded}/${importProgress.total}`
          ) : dataSource === 'cloud' && loadProgress ? (
            `${i18n.t('library.loadingMetadata')} ${loadProgress.loaded}/${loadProgress.total}`
          ) : isEditMode ? (
            `${selectedCount} ${i18n.t('library.selectedCount')}`
          ) : (
            <>
              {trackCount} {i18n.t('library.trackCount')}
            </>
          )}
        </p>
        {(importProgress || (dataSource === 'cloud' && loadProgress)) && (
          <div className="mt-2 w-48 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: colors.backgroundCard }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${((importProgress || loadProgress)!.loaded / (importProgress || loadProgress)!.total) * 100}%`,
                backgroundColor: colors.primary,
              }}
            />
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        {searchBox}
        {dataSource === 'cloud' ? (
          /* Cloud：刷新按钮（替换编辑按钮） */
          <button
            onClick={onRefreshCloud}
            disabled={isRefreshing}
            className="w-10 h-10 flex items-center justify-center border shadow-xl"
            style={{
              backgroundColor: colors.control,
              color: colors.textSecondary,
              borderColor: colors.borderLight,
              borderRadius: '12px',
              transition: 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
              cursor: isRefreshing ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={e => { if (!isRefreshing) { e.currentTarget.style.backgroundColor = colors.controlHover; e.currentTarget.style.color = colors.primary; e.currentTarget.style.borderColor = colors.borderHover; } }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = colors.control; e.currentTarget.style.color = colors.textSecondary; e.currentTarget.style.borderColor = colors.borderLight; }}
            title={i18n.t('library.refresh')}
          >
            <span
              className={`material-symbols-outlined${isRefreshing ? ' animate-spin' : ''}`}
              style={{ fontSize: '22px' }}
            >
              refresh
            </span>
          </button>
        ) : (
          /* Local：编辑按钮 + 下拉删除菜单 */
          <div
            className="relative"
            onMouseEnter={() => isEditMode && setShowEditDropdown(true)}
            onMouseLeave={() => isEditMode && setShowEditDropdown(false)}
          >
            <button
              onClick={onToggleEditMode}
              className="w-10 h-10 flex items-center justify-center relative border shadow-xl"
              style={{
                backgroundColor: isEditMode ? colors.success : colors.control,
                color: isEditMode ? colors.textOnPrimary : colors.textSecondary,
                borderColor: isEditMode ? colors.success : colors.borderLight,
                boxShadow: isEditMode ? `0 14px 30px -18px ${colors.success}80` : 'none',
                borderRadius: showEditDropdown ? '12px 12px 0 0' : '12px',
                transition: 'border-radius 0.25s ease, background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease',
              }}
            >
              <span className="material-symbols-outlined absolute"
                style={{
                  opacity: isEditMode ? 1 : 0,
                  transform: isEditMode ? 'scale(1)' : 'scale(0.4)',
                  transition: 'opacity 0.2s ease, transform 0.25s ease',
                }}
              >
                check
              </span>
              <span className="material-symbols-outlined absolute"
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
                background: `linear-gradient(180deg, ${colors.surfaceElevated} 0%, ${colors.surface} 100%)`,
                backdropFilter: 'blur(20px)',
                borderRadius: '0 0 12px 12px',
                border: `1px solid ${colors.borderLight}`,
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
                className="w-10 h-10 flex items-center justify-center rounded-b-xl transition-all"
                style={{
                  backgroundColor: selectedCount > 0 ? colors.error : colors.backgroundCard,
                  color: selectedCount > 0 ? colors.textOnPrimary : colors.textMuted,
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
        <div
          className="flex items-center rounded-xl border p-0.5 shadow-xl"
          style={{
            borderColor: colors.borderLight,
            backgroundColor: colors.control,
            boxShadow: `0 14px 34px -30px ${colors.shadowColor}`,
          }}
        >
          <button
            onClick={() => {
              onFilterTypeChange('default');
              onCategoryChange(null);
            }}
            className="w-10 h-9 rounded-lg text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'default' ? colors.primary : 'transparent',
              color: filterType === 'default' ? colors.textOnPrimary : colors.textSecondary,
              boxShadow: filterType === 'default' ? `0 10px 24px -14px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined text-xl">list</span>
          </button>
          <button
            onClick={() => {
              onFilterTypeChange('album');
              onCategoryChange(uniqueAlbums.length > 0 ? uniqueAlbums[0]!.name : null);
            }}
            className="w-10 h-9 rounded-lg text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'album' ? colors.primary : 'transparent',
              color: filterType === 'album' ? colors.textOnPrimary : colors.textSecondary,
              boxShadow: filterType === 'album' ? `0 10px 24px -14px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined text-xl">album</span>
          </button>
          <button
            onClick={() => {
              onFilterTypeChange('artist');
              onCategoryChange(uniqueArtists.length > 0 ? uniqueArtists[0]!.name : null);
            }}
            className="w-10 h-9 rounded-lg text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'artist' ? colors.primary : 'transparent',
              color: filterType === 'artist' ? colors.textOnPrimary : colors.textSecondary,
              boxShadow: filterType === 'artist' ? `0 10px 24px -14px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined text-xl">artist</span>
          </button>
        </div>
      </div>
    </div>
  );
});

export default LibraryToolbar;
