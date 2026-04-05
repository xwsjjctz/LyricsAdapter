
import React, { memo, useState, useEffect } from 'react';
import { Track } from '../types';
import { i18n } from '../services/i18n';
import { themeManager } from '../services/themeManager';
import { ThemeConfig } from '../types/theme';

interface QueuePanelProps {
  tracks: Track[];
  currentTrackIndex: number;
  isOpen: boolean;
  onTrackSelect: (index: number) => void;
}

const QueuePanel: React.FC<QueuePanelProps> = memo(({ tracks, currentTrackIndex, isOpen, onTrackSelect }) => {
  // Force re-render when language changes
  const [, setLanguageVersion] = useState(0);
  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

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

  const colors = currentTheme.colors;

  return (
    <aside className={`w-80 glass border-l flex flex-col h-full z-20 transition-all duration-500 transform ${isOpen ? 'translate-x-0' : 'translate-x-full fixed right-0'}`} style={{ borderColor: colors.borderLight }}>
      <div className="p-6 h-full flex flex-col">
        <h2 className="text-xl font-bold mb-6 flex items-center gap-2" style={{ color: colors.textPrimary }}>
          {i18n.t('queue.upNext')}
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: colors.backgroundCard, color: colors.textMuted }}>{tracks.length}</span>
        </h2>
        
        <div className="flex-1 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
          {tracks.length > 0 ? (
            tracks.map((track, index) => (
              <div 
                key={track.id}
                onClick={() => onTrackSelect(index)}
                className="flex items-center gap-3 p-3 rounded-xl transition-all cursor-pointer group border"
                style={{
                  backgroundColor: index === currentTrackIndex ? `${colors.primary}20` : colors.backgroundCard,
                  borderColor: index === currentTrackIndex ? `${colors.primary}30` : 'transparent',
                }}
                onMouseEnter={e => { if (index !== currentTrackIndex) e.currentTarget.style.backgroundColor = colors.backgroundCardHover; }}
                onMouseLeave={e => { if (index !== currentTrackIndex) e.currentTarget.style.backgroundColor = colors.backgroundCard; }}
              >
                <div 
                  className="size-12 rounded-lg bg-cover bg-center shrink-0 shadow-md group-hover:scale-105 transition-transform" 
                  style={{backgroundImage: `url('${track.coverUrl}')`}}
                ></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate transition-colors" style={{ color: index === currentTrackIndex ? colors.primary : colors.textPrimary }}>
                    {track.title}
                  </p>
                  <p className="text-xs truncate" style={{ color: colors.textMuted }}>{track.artist}</p>
                </div>
                {index === currentTrackIndex && (
                  <div className="size-4 flex items-center justify-center">
                    <div className="flex gap-0.5 items-end h-3">
                      <div className="w-0.5 animate-[bounce_0.6s_infinite_0s]" style={{ backgroundColor: colors.primary }}></div>
                      <div className="w-0.5 animate-[bounce_0.6s_infinite_0.2s]" style={{ backgroundColor: colors.primary }}></div>
                      <div className="w-0.5 animate-[bounce_0.6s_infinite_0.4s]" style={{ backgroundColor: colors.primary }}></div>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="flex-1 flex items-center justify-center flex-col text-center px-4" style={{ opacity: 0.2, color: colors.textMuted }}>
              <span className="material-symbols-outlined text-4xl mb-4">playlist_add</span>
              <p className="text-sm">{i18n.t('queue.emptyHint')}</p>
            </div>
          )}
        </div>

        <div className="mt-6 pt-6 border-t" style={{ borderColor: colors.borderLight }}>
          <button className="w-full py-3 rounded-xl border transition-colors text-sm font-semibold tracking-wide" style={{ borderColor: colors.borderLight, color: colors.textSecondary }}>
            {i18n.t('queue.viewFullQueue')}
          </button>
        </div>
      </div>
    </aside>
  );
});

QueuePanel.displayName = 'QueuePanel';

export default QueuePanel;
