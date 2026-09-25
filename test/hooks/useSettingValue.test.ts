import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingValue } from '@/components/settings/hooks/useSettingValue';
import { settingsManager } from '@/services/settingsManager';

const readRadius = () => settingsManager.getFocusBgBlurRadius();

describe('useSettingValue', () => {
  afterEach(() => {
    void settingsManager.setFocusBgBlurRadius(80);
  });

  it('reads the current value and follows later changes', async () => {
    const { result } = renderHook(() => useSettingValue(readRadius));
    expect(result.current).toBe(settingsManager.getFocusBgBlurRadius());

    await act(async () => { await settingsManager.setFocusBgBlurRadius(52); });

    expect(result.current).toBe(52);
  });
});
