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
    <div className="mb-4 flex-shrink-0 flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-extrabold" style={{ color: 'var(--theme-text-primary, #fff)' }}>
          {i18n.t(`sidebar.${dataSource}`)}
        </h1>
        <p style={{ color: 'var(--theme-text-muted, rgba(255,255,255,0.4))' }}>
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
      <div className="flex items-center gap-2">
        {searchBox}
        <div
          className="relative"
          onMouseEnter={() => isEditMode && setShowEditDropdown(true)}
          onMouseLeave={() => isEditMode && setShowEditDropdown(false)}
        >
          <button
            onClick={onToggleEditMode}
            className="w-10 h-10 flex items-center justify-center relative shadow-xl"
            style={{
              backgroundColor: isEditMode ? colors.success : colors.backgroundCard,
              color: isEditMode ? '#fff' : colors.textSecondary,
              boxShadow: isEditMode ? `0 0 20px ${colors.success}80` : undefined,
              borderRadius: showEditDropdown ? '12px 12px 0 0' : '12px',
              transition: 'border-radius 0.25s ease, background-color 0.2s ease, box-shadow 0.2s ease',
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
              background: `linear-gradient(180deg, ${colors.backgroundSidebar}f8 0%, ${colors.backgroundDark}f2 100%)`,
              backdropFilter: 'blur(20px)',
              borderRadius: '0 0 12px 12px',
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
        <div className="flex items-center rounded-xl border shadow-xl" style={{ borderColor: colors.borderLight, backgroundColor: colors.backgroundCard }}>
          <button
            onClick={() => {
              onFilterTypeChange('default');
              onCategoryChange(null);
            }}
            className="w-10 h-[38px] rounded-l-lg text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'default' ? colors.primary : 'transparent',
              color: filterType === 'default' ? '#fff' : colors.textSecondary,
              boxShadow: filterType === 'default' ? `0 0 20px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined text-xl">list</span>
          </button>
          <button
            onClick={() => {
              onFilterTypeChange('album');
              onCategoryChange(uniqueAlbums.length > 0 ? uniqueAlbums[0]!.name : null);
            }}
            className="w-10 h-[38px] text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'album' ? colors.primary : 'transparent',
              color: filterType === 'album' ? '#fff' : colors.textSecondary,
              boxShadow: filterType === 'album' ? `0 0 20px ${colors.glowColor}` : 'none',
            }}
          >
            <span className="material-symbols-outlined text-xl">album</span>
          </button>
          <button
            onClick={() => {
              onFilterTypeChange('artist');
              onCategoryChange(uniqueArtists.length > 0 ? uniqueArtists[0]!.name : null);
            }}
            className="w-10 h-[38px] rounded-r-lg text-sm transition-all flex items-center justify-center"
            style={{
              backgroundColor: filterType === 'artist' ? colors.primary : 'transparent',
              color: filterType === 'artist' ? '#fff' : colors.textSecondary,
              boxShadow: filterType === 'artist' ? `0 0 20px ${colors.glowColor}` : 'none',
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
