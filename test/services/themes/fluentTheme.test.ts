import { describe, expect, it } from 'vitest';
import { readableForeground } from '@/services/colorUtils';
import { predefinedThemes, getDefaultTheme } from '@/services/themes/predefinedThemes';
import { supportsFluentAppearance, withFluentAppearance } from '@/services/themes/fluentTheme';
import { THEME_IDS } from '@/types/theme';

const theme = (id: string) => predefinedThemes.find(candidate => candidate.id === id)!;

describe('withFluentAppearance', () => {
  it('keeps the accent and the Mica tint but takes Fluent neutrals and shapes', () => {
    const base = getDefaultTheme();
    const fluent = withFluentAppearance(base);
    expect(fluent.designLanguage).toBe('fluent');
    expect(fluent.colors.primary).toBe(base.colors.primary);
    expect(fluent.colors.backgroundGradientStart).toBe(base.colors.backgroundGradientStart);
    expect(fluent.colors.textPrimary).toBe('#ffffff');
    expect(fluent.appearance).toMatchObject({ controlRadius: '4px', surfaceRadius: '8px', textHeadingWeight: '600' });
    expect(fluent.controls?.primaryButtonForeground).toBe(readableForeground(base.colors.primary));
  });

  it('uses the light Fluent palette for light themes', () => {
    expect(withFluentAppearance(theme(THEME_IDS.DEFAULT_LIGHT)).colors.textPrimary).toBe('rgba(0, 0, 0, 0.896)');
  });

  it('leaves themes with their own shape language alone', () => {
    const brutalist = theme(THEME_IDS.BRUTALIST);
    expect(supportsFluentAppearance(brutalist)).toBe(false);
    expect(withFluentAppearance(brutalist)).toBe(brutalist);
  });

  it('does not mutate the predefined theme', () => {
    const base = getDefaultTheme();
    const before = structuredClone(base);
    withFluentAppearance(base);
    expect(base).toEqual(before);
  });
});
