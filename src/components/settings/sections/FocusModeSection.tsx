import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getDesktopAPI } from '../../../services/desktopAdapter';
import { settingsManager } from '../../../services/settingsManager';
import { Switch } from '../../ui';
import { useSettingValue } from '../hooks/useSettingValue';
import type { SettingsTheme } from '../shared';

const BG_OPACITY_PERSIST_DELAY_MS = 500;

const readBgBlurTrans = () => settingsManager.getBgBlurTrans();
const readBlurRadius = () => settingsManager.getFocusBgBlurRadius();
const readFontSize = () => settingsManager.getFocusLyricsFontSize();
const readLineSpacing = () => settingsManager.getFocusLyricLineSpacing();
const readEnhancedFont = () => settingsManager.getFocusEnhancedFontEnabled();

interface RangeRowProps {
  theme: SettingsTheme;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function RangeRow({ theme, label, value, min, max, step, display, onChange }: RangeRowProps) {
  const { colors } = theme;
  return (
    <div className="settings-row" style={{ borderColor: colors.borderLight }}>
      <span className="settings-row__label" style={{ color: colors.textSecondary }}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums w-10 text-right" style={{ color: colors.textMuted }}>{display}</span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={event => onChange(Number(event.target.value))}
          className={theme.rangeClassName}
          style={theme.rangeStyle(((value - min) / (max - min)) * 100)}
        />
      </div>
    </div>
  );
}

/** Focus mode appearance: backdrop and scrolling lyrics. */
export default function FocusModeSection({ theme }: { theme: SettingsTheme }) {
  const { t } = useTranslation();
  const { colors } = theme;
  const storedOpacity = useSettingValue(readBgBlurTrans);
  const blurRadius = useSettingValue(readBlurRadius);
  const fontSize = useSettingValue(readFontSize);
  const lineSpacing = useSettingValue(readLineSpacing);
  const enhancedFont = useSettingValue(readEnhancedFont);
  const isWindows = getDesktopAPI()?.platform === 'win32';

  // Opacity previews live while dragging and persists once the slider settles.
  const [opacity, setOpacity] = useState(storedOpacity);
  useEffect(() => setOpacity(storedOpacity), [storedOpacity]);
  useEffect(() => {
    if (opacity === storedOpacity) return;
    const timer = setTimeout(() => { void settingsManager.setBgBlurTrans(opacity); }, BG_OPACITY_PERSIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [opacity, storedOpacity]);

  return (
    <div className="settings-card r-card border" style={{ backgroundColor: colors.backgroundCard, borderColor: colors.borderLight }}>
      <RangeRow theme={theme} label={t('settings.bgBlurTrans')} value={opacity} min={0} max={1} step={0.01}
        display={opacity.toFixed(2)}
        onChange={value => {
          setOpacity(value);
          const preview = (window as unknown as { bg_blur_trans?: (value: number) => void }).bg_blur_trans;
          if (typeof preview === 'function') preview(value);
        }} />
      <RangeRow theme={theme} label={t('settings.focusBgBlurRadius')} value={blurRadius} min={40} max={80} step={1}
        display={`${blurRadius}px`} onChange={value => { void settingsManager.setFocusBgBlurRadius(value); }} />
      <RangeRow theme={theme} label={t('settings.focusLyricsFontSize')} value={fontSize} min={24} max={40} step={1}
        display={`${fontSize}px`} onChange={value => { void settingsManager.setFocusLyricsFontSize(value); }} />
      <RangeRow theme={theme} label={t('settings.focusLyricLineSpacing')} value={lineSpacing} min={12} max={48} step={1}
        display={`${lineSpacing}px`} onChange={value => { void settingsManager.setFocusLyricLineSpacing(value); }} />
      {isWindows && (
        <div className="settings-row" style={{ borderColor: colors.borderLight }}>
          <div className="min-w-0">
            <div className="settings-row__label" style={{ color: colors.textSecondary }}>{t('settings.focusEnhancedFontEnabled')}</div>
            <div id="focus-enhanced-font-description" className="mt-0.5 text-xs" style={{ color: colors.textMuted }}>
              {t('settings.focusEnhancedFontEnabledDesc')}
            </div>
          </div>
          <Switch checked={enhancedFont} label={t('settings.focusEnhancedFontEnabled')}
            describedBy="focus-enhanced-font-description"
            onChange={enabled => { void settingsManager.setFocusEnhancedFontEnabled(enabled); }} />
        </div>
      )}
    </div>
  );
}
