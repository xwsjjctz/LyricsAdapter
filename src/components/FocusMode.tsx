import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import { Track } from '../types';
import { themeManager } from '../services/themeManager';
import { registerCommand } from '../services/debugCommands';
import { settingsManager } from '../services/settingsManager';
import { ThemeConfig, THEME_IDS } from '../types/theme';
import { getDesktopAPI } from '../services/desktopAdapter';
import { resolveCoverUrl } from '../services/coverUrl';
import FocusBackdrop from './focus-mode/FocusBackdrop';
import FocusControls from './focus-mode/FocusControls';
import FocusCoverStage from './focus-mode/FocusCoverStage';
import FocusTrackMeta from './focus-mode/FocusTrackMeta';
import FocusTranslateButton from './focus-mode/FocusTranslateButton';
import { BACKDROP_ALPHA_EXIT_DURATION_MS } from './focus-mode/focusBackdropAlpha';
import { useFocusModeScale } from './focus-mode/focusModeScale';
import { useFocusPortraitLayout } from './focus-mode/useFocusPortraitLayout';
import { useFocusControlsIdle } from './focus-mode/useFocusControlsIdle';
import { FOCUS_CONTROLS_IDLE_MS } from './focus-mode/focusControlsIdle';
import { hasTrackLyrics } from './focus-mode/focusLyricsTrack';
import './focus-mode/FocusModeLayout.css';
import FocusLyrics from './focus-mode/FocusLyrics';
import { useWindowVisible } from '../hooks/useWindowVisible';
import { usePluginTranslation } from '../hooks/usePluginTranslation';
import {
  CLOCK_RESYNC_THRESHOLD_SECONDS,
  useFocusPlaybackClock,
} from './focus-mode/useFocusPlaybackClock';

// FocusMode 沉浸式深色风格的固定颜色（不受主题影响）
const FOCUS_MODE_COLORS = {
  textPrimary: '#ffffff',
  textSecondary: 'rgba(255, 255, 255, 0.7)',
  textMuted: 'rgba(255, 255, 255, 0.4)',
  backgroundCard: 'rgba(255, 255, 255, 0.08)',
  backgroundCardHover: 'rgba(255, 255, 255, 0.12)',
  borderLight: 'rgba(255, 255, 255, 0.1)',
};

interface FocusModeProps {
  track: Track | null;
  isVisible: boolean;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSkipNext: () => void;
  onSkipPrev: () => void;
  onSeek: (time: number) => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  playbackMode: 'order' | 'shuffle' | 'repeat-one';
  onTogglePlaybackMode: () => void;
  onToggleFocus: () => void;
  getCurrentPlaybackTime: () => number;
}

const FocusModeContent: React.FC<FocusModeProps> = memo(({
  track, isVisible, currentTime,
  isPlaying, onTogglePlay, onSkipNext, onSkipPrev, onSeek, volume, onVolumeChange, onToggleMute, playbackMode, onTogglePlaybackMode, onToggleFocus: _onToggleFocus, getCurrentPlaybackTime
}) => {
  const isLinux = getDesktopAPI()?.platform === 'linux';

  const [currentTheme, setCurrentTheme] = useState<ThemeConfig>(themeManager.getCurrentTheme());

  useEffect(() => {
    const unsubscribe = themeManager.subscribe(() => {
      setCurrentTheme(themeManager.getCurrentTheme());
    });
    return unsubscribe;
  }, []);

  const playerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const portrait = useFocusPortraitLayout();
  const portraitIdle = useFocusControlsIdle(portrait, isVisible, overlayRef);
  const [isPlayerVisible, setIsPlayerVisible] = useState(true);
  const playerHideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Global background transparency control for debugging
  const [bgBlurTrans, setBgBlurTrans] = useState(() => settingsManager.getBgBlurTrans());
  const [bgBlurRadius, setBgBlurRadius] = useState(() => settingsManager.getFocusBgBlurRadius());
  const [amllBackground, setAmllBackground] = useState(() => settingsManager.getFocusAmllBackgroundEnabled());
  const [lyricsFontSize, setLyricsFontSize] = useState(() => settingsManager.getFocusLyricsFontSize());
  const [lyricLineSpacing, setLyricLineSpacing] = useState(() => settingsManager.getFocusLyricLineSpacing());
  const [inactiveLyricBlur, setInactiveLyricBlur] = useState(() => settingsManager.getFocusInactiveLyricBlur());
  const [focusAmlLyricsEnabled, setFocusAmlLyricsEnabled] = useState(
    () => settingsManager.getFocusAmlLyricsEnabled(),
  );
  const viewportScale = useFocusModeScale();
  const focusScale = portrait ? 1 : viewportScale;
  // Keep lyric density stable as the window grows. The vh-based lyric viewport
  // gets taller instead, revealing more surrounding lines.
  const hasScaledLayout = focusScale > 1;

  // Sync with settingsManager when changed externally (e.g. from SettingsView slider)
  useEffect(() => {
    const unsubscribe = settingsManager.subscribe(() => {
      setBgBlurTrans(settingsManager.getBgBlurTrans());
      setBgBlurRadius(settingsManager.getFocusBgBlurRadius());
      setAmllBackground(settingsManager.getFocusAmllBackgroundEnabled());
      setLyricsFontSize(settingsManager.getFocusLyricsFontSize());
      setLyricLineSpacing(settingsManager.getFocusLyricLineSpacing());
      setInactiveLyricBlur(settingsManager.getFocusInactiveLyricBlur());
      setFocusAmlLyricsEnabled(settingsManager.getFocusAmlLyricsEnabled());
    });
    return unsubscribe;
  }, []);

  // Theme colors
  const colors = currentTheme.colors;
  // FocusMode uses fixed dark colors for immersive experience (except player controls)
  const focusColors = FOCUS_MODE_COLORS;
  const useDefaultThemeControlGlass = currentTheme.id === THEME_IDS.DEFAULT;

  // A minimized or hidden window keeps playing but stops every continuous
  // animation (clock, backdrop, lyrics). Controls still show the real state.
  const windowVisible = useWindowVisible();
  const isAnimating = isPlaying && windowVisible;

  const { activeCurrentTime, realtimeCurrentTimeRef } = useFocusPlaybackClock({
    trackId: track?.id,
    isVisible,
    currentTime,
    isPlaying: isAnimating,
    getCurrentPlaybackTime,
  });

  // Translation starts from the button under the track title; its state never touches playback.
  const translation = usePluginTranslation(hasTrackLyrics(track) ? track : null, isVisible);

  const progress = track && track.duration > 0 ? (activeCurrentTime / track.duration) * 100 : 0;

  // Handle player mouse enter
  const handlePlayerMouseEnter = () => {
    // Clear any pending hide timeout
    if (playerHideTimeoutRef.current) {
      clearTimeout(playerHideTimeoutRef.current);
      playerHideTimeoutRef.current = null;
    }
    setIsPlayerVisible(true);
  };

  // Handle player mouse leave
  const handlePlayerMouseLeave = () => {
    if (playerHideTimeoutRef.current) clearTimeout(playerHideTimeoutRef.current);
    // Set timeout to hide player after 1 second
    playerHideTimeoutRef.current = setTimeout(() => {
      setIsPlayerVisible(false);
    }, FOCUS_CONTROLS_IDLE_MS);
  };

  // Cleanup player hide timeout on unmount
  useEffect(() => {
    return () => {
      if (playerHideTimeoutRef.current) {
        clearTimeout(playerHideTimeoutRef.current);
      }
    };
  }, []);

  // Persist bgBlurTrans to settingsManager when it changes
  useEffect(() => {
    settingsManager.setBgBlurTrans(bgBlurTrans);
  }, [bgBlurTrans]);

  // Register global debug function for background transparency
  useEffect(() => {
    return registerCommand(
      'bg_blur_trans',
      (value: number) => {
        if (typeof value === 'number' && value >= 0 && value <= 1) {
          setBgBlurTrans(value);
        }
      },
      'Set FocusMode background transparency (0~1), e.g. bg_blur_trans(0.92)'
    );
  }, []);

  // Reset player visibility when focus mode becomes visible
  useEffect(() => {
    if (isVisible && !portrait) {
      setIsPlayerVisible(true);
      // Clear any pending hide timeout
      if (playerHideTimeoutRef.current) {
        clearTimeout(playerHideTimeoutRef.current);
        playerHideTimeoutRef.current = null;
      }
      // Start hide timer - mouse enter will cancel it if mouse is over player
      playerHideTimeoutRef.current = setTimeout(() => {
        setIsPlayerVisible(false);
      }, FOCUS_CONTROLS_IDLE_MS);
    }
  }, [isVisible, portrait]);

  // Tracks without artwork use the app-icon default cover as their backdrop too.
  const coverUrl = track ? resolveCoverUrl(track.coverUrl) : undefined;

  const handleLyricSeek = useCallback((lyricTime: number) => {
    onSeek(lyricTime);
    // A lyric click is explicit playback intent, matching the previous Focus Mode behavior.
    if (!isPlaying) onTogglePlay();
  }, [isPlaying, onSeek, onTogglePlay]);

  // Keep the Windows glass outside the content opacity layer. An ancestor with
  // opacity < 1 would cut off its access to the animated backdrop canvas.
  const externalControlGlass = getDesktopAPI()?.platform === 'win32' && !portrait;
  const focusControls = <FocusControls
    track={track} colors={colors} isPlaying={isPlaying}
    isPlayerVisible={portrait ? portraitIdle.shown : isPlayerVisible} isFocusVisible={isVisible}
    activeCurrentTime={activeCurrentTime} progress={progress} volume={volume} playbackMode={playbackMode}
    playerRef={playerRef} onSeek={onSeek} onTogglePlay={onTogglePlay} onSkipNext={onSkipNext} onSkipPrev={onSkipPrev}
    onVolumeChange={onVolumeChange} onToggleMute={onToggleMute} onTogglePlaybackMode={onTogglePlaybackMode}
    onMouseEnter={portrait ? portraitIdle.nativeStart : handlePlayerMouseEnter}
    onMouseLeave={portrait ? portraitIdle.nativeEnd : handlePlayerMouseLeave}
    glassMaterial={useDefaultThemeControlGlass} scale={focusScale} portrait={portrait}
  />;

  return (
    <div ref={overlayRef} data-focus-layout={portrait ? 'portrait' : 'landscape'}
      onPointerDownCapture={portraitIdle.pointerDown} onClickCapture={portraitIdle.click}
      onPointerMoveCapture={portrait ? portraitIdle.pointerMove : undefined}
      onPointerLeave={portrait ? portraitIdle.pointerLeave : undefined}
      onKeyDownCapture={portrait ? portraitIdle.keyboardActivity : undefined}
      className={`focus-mode-overlay fixed inset-0 z-[120] transition-transform duration-600 ease-in-out motion-reduce:transition-none overflow-hidden ${isVisible ? 'translate-y-0' : 'translate-y-full pointer-events-none'}${isLinux ? ' rounded-lg' : ''}`}>
      <FocusBackdrop
        amllBackground={amllBackground}
        trackId={track?.id}
        coverUrl={coverUrl}
        isVisible={isVisible}
        isPlaying={isAnimating}
        isLinux={isLinux}
        opacity={bgBlurTrans}
        blurRadius={bgBlurRadius}
      />

      <div data-focus-controls-visible={portrait ? portraitIdle.shown : isPlayerVisible}
        className={`focus-mode-content relative h-full flex flex-col z-10 overflow-hidden transition-opacity duration-600 ease-in-out motion-reduce:transition-none ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
        {/* Spacer to avoid content behind titlebar */}
        <div className="focus-top-spacer shrink-0 pt-12" style={hasScaledLayout ? { paddingTop: `${48 * focusScale}px` } : undefined} />

        {/* Content Section */}
        <main
          className="focus-main flex-1 flex items-center justify-center overflow-visible mb-24 mx-auto w-full flex-row pl-0 pr-4 lg:pl-0 lg:pr-8 gap-20 lg:gap-32 max-w-5xl translate-x-6 lg:translate-x-6"
          data-focus-has-lyrics={hasTrackLyrics(track)}
          style={hasScaledLayout ? {
            marginBottom: `${96 * focusScale}px`,
            maxWidth: `${1024 * focusScale}px`,
            paddingRight: `${32 * focusScale}px`,
            gap: `${128 * focusScale}px`,
            // Override Tailwind's translate property; transform would add a second offset.
            translate: `${24 * focusScale}px 0`,
          } : undefined}
        >

          {/* Cover & Title */}
          <div
            className="focus-artwork-column flex-none flex flex-col items-center justify-center w-auto p-6"
            style={hasScaledLayout ? { padding: `${24 * focusScale}px` } : undefined}
          >
            <FocusCoverStage coverUrl={coverUrl} isPlaying={isPlaying} scale={focusScale} />
            <FocusTrackMeta
              track={track}
              textPrimary={focusColors.textPrimary}
              textMuted={focusColors.textMuted}
              scale={focusScale}
            >
              <FocusTranslateButton status={translation.status} onToggle={translation.toggle} scale={focusScale} />
            </FocusTrackMeta>
          </div>

          {/* Lyrics */}
          <FocusLyrics
            track={track}
            translations={translation.lines}
            currentTime={activeCurrentTime}
            currentTimeRef={realtimeCurrentTimeRef}
            isPlaying={isAnimating}
            isVisible={isVisible}
            useAmlLyrics={focusAmlLyricsEnabled}
            portrait={portrait}
            fontSize={lyricsFontSize}
            lineSpacing={lyricLineSpacing}
            inactiveBlur={inactiveLyricBlur}
            textPrimary={focusColors.textPrimary}
            textSecondary={focusColors.textSecondary}
            textMuted={focusColors.textMuted}
            onSeek={handleLyricSeek}
          />
        </main>

        <div>{!externalControlGlass && focusControls}</div>
      </div>
      {externalControlGlass && focusControls}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison for React.memo
  // FocusMode is expensive to render, so we want to minimize re-renders

  // Always re-render when visibility changes
  if (prevProps.isVisible !== nextProps.isVisible) return false;

  // Re-render when track changes
  if (prevProps.track !== nextProps.track) return false;

  // Re-render when playback state changes
  if (prevProps.isPlaying !== nextProps.isPlaying) return false;

  // Re-render when volume changes
  if (prevProps.volume !== nextProps.volume) return false;

  // Check callbacks
  if (prevProps.onTogglePlay !== nextProps.onTogglePlay) return false;
  if (prevProps.onSkipNext !== nextProps.onSkipNext) return false;
  if (prevProps.onSkipPrev !== nextProps.onSkipPrev) return false;
  if (prevProps.onSeek !== nextProps.onSeek) return false;
  if (prevProps.onVolumeChange !== nextProps.onVolumeChange) return false;
  if (prevProps.onToggleMute !== nextProps.onToggleMute) return false;
  if (prevProps.playbackMode !== nextProps.playbackMode) return false;
  if (prevProps.onTogglePlaybackMode !== nextProps.onTogglePlaybackMode) return false;
  if (prevProps.onToggleFocus !== nextProps.onToggleFocus) return false;
  if (prevProps.getCurrentPlaybackTime !== nextProps.getCurrentPlaybackTime) return false;
  // Keep the prop threshold aligned with the layout-effect drift correction;
  // otherwise a 0.25–0.5s restoration drift could be filtered before paint.
  if (!nextProps.isPlaying && prevProps.currentTime !== nextProps.currentTime) return false;
  const timeDiff = Math.abs(prevProps.currentTime - nextProps.currentTime);
  if (timeDiff >= CLOCK_RESYNC_THRESHOLD_SECONDS) return false;

  // All props are effectively the same, skip re-render
  return true;
});

FocusModeContent.displayName = 'FocusModeContent';

// The page slide and the classic backdrop's exit alpha both finish around 600ms.
// Keep a small buffer before unmounting the backdrop so the final frame is
// painted and the exit remains interruptible.
const FOCUS_MODE_EXIT_DURATION_MS = BACKDROP_ALPHA_EXIT_DURATION_MS + 100;

/**
 * Keep the content mounted just long enough for its exit transition, then
 * unmount the heavy full-screen layers completely. Playback lives outside this
 * component, so releasing FocusMode has no effect on background audio.
 */
const FocusMode: React.FC<FocusModeProps> = (props) => {
  const [shouldMountContent, setShouldMountContent] = useState(props.isVisible);
  const [isPresented, setIsPresented] = useState(false);
  const isExitTransitionRef = useRef(false);

  useLayoutEffect(() => {
    if (props.isVisible) {
      const isReversingExit = isExitTransitionRef.current && shouldMountContent;
      isExitTransitionRef.current = false;
      setShouldMountContent(true);
      if (isReversingExit) {
        // The existing DOM and CSS transitions are still alive. Reverse them
        // immediately from their computed state instead of staging a new entry.
        setIsPresented(true);
        return;
      }

      let presentFrame = 0;
      const mountFrame = window.requestAnimationFrame(() => {
        presentFrame = window.requestAnimationFrame(() => {
          setIsPresented(true);
        });
      });
      return () => {
        window.cancelAnimationFrame(mountFrame);
        if (presentFrame) window.cancelAnimationFrame(presentFrame);
      };
    }

    setIsPresented(false);
    if (!shouldMountContent) {
      isExitTransitionRef.current = false;
      return;
    }

    isExitTransitionRef.current = true;
    const timer = window.setTimeout(() => {
      isExitTransitionRef.current = false;
      setShouldMountContent(false);
    }, FOCUS_MODE_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [props.isVisible, shouldMountContent]);

  return shouldMountContent
    ? <FocusModeContent {...props} isVisible={isPresented} />
    : null;
};

FocusMode.displayName = 'FocusMode';

export default memo(FocusMode);
