import { describe, it, expect, vi, beforeEach } from 'vitest';
import { settingsManager } from '@/services/settingsManager';

beforeEach(() => {
  localStorage.clear();
  // Reset singleton internal state to defaults
  (settingsManager as any).downloadPath = '';
  (settingsManager as any).floatingPanel = false;
  (settingsManager as any).bgBlurTrans = 1.0;
  (settingsManager as any).qqMusicEnabled = false;
});

describe('downloadPath', () => {
  it('should default to empty string', () => {
    expect(settingsManager.getDownloadPath()).toBe('');
    expect(settingsManager.hasDownloadPath()).toBe(false);
  });

  it('should set and get download path', () => {
    settingsManager.setDownloadPath('/music/downloads');
    expect(settingsManager.getDownloadPath()).toBe('/music/downloads');
    expect(settingsManager.hasDownloadPath()).toBe(true);
  });

  it('should persist to localStorage', () => {
    settingsManager.setDownloadPath('/custom/path');
    expect(localStorage.getItem('la_download_path')).toBe('/custom/path');
  });

  it('should accept empty path', () => {
    settingsManager.setDownloadPath('');
    expect(settingsManager.hasDownloadPath()).toBe(false);
  });
});

describe('floatingPanel', () => {
  it('should default to false', () => {
    expect(settingsManager.getFloatingPanel()).toBe(false);
  });

  it('should set and get floating panel', () => {
    settingsManager.setFloatingPanel(true);
    expect(settingsManager.getFloatingPanel()).toBe(true);
  });

  it('should toggle back to false', () => {
    settingsManager.setFloatingPanel(true);
    settingsManager.setFloatingPanel(false);
    expect(settingsManager.getFloatingPanel()).toBe(false);
  });

  it('should persist to localStorage', () => {
    settingsManager.setFloatingPanel(true);
    expect(localStorage.getItem('la_floating_panel')).toBe('true');
  });
});

describe('bgBlurTrans', () => {
  it('should default to 1.0', () => {
    expect(settingsManager.getBgBlurTrans()).toBe(1.0);
  });

  it('should set and get value', () => {
    settingsManager.setBgBlurTrans(0.5);
    expect(settingsManager.getBgBlurTrans()).toBe(0.5);
  });

  it('should clamp to 0 min', () => {
    settingsManager.setBgBlurTrans(-0.5);
    expect(settingsManager.getBgBlurTrans()).toBe(0);
  });

  it('should clamp to 1 max', () => {
    settingsManager.setBgBlurTrans(1.5);
    expect(settingsManager.getBgBlurTrans()).toBe(1);
  });

  it('should persist to localStorage', () => {
    settingsManager.setBgBlurTrans(0.3);
    expect(localStorage.getItem('la_bg_blur_trans')).toBe('0.3');
  });
});

describe('qqMusicEnabled', () => {
  it('should default to false', () => {
    expect(settingsManager.getQqMusicEnabled()).toBe(false);
  });

  it('should set and get', () => {
    settingsManager.setQqMusicEnabled(true);
    expect(settingsManager.getQqMusicEnabled()).toBe(true);
  });

  it('should persist to localStorage', () => {
    settingsManager.setQqMusicEnabled(true);
    expect(localStorage.getItem('la_qq_music_enabled')).toBe('true');
  });
});

describe('subscribe', () => {
  it('should notify listeners when floatingPanel changes', () => {
    const listener = vi.fn();
    settingsManager.subscribe(listener);
    settingsManager.setFloatingPanel(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should notify listeners when bgBlurTrans changes', () => {
    const listener = vi.fn();
    settingsManager.subscribe(listener);
    settingsManager.setBgBlurTrans(0.5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should notify listeners when qqMusicEnabled changes', () => {
    const listener = vi.fn();
    settingsManager.subscribe(listener);
    settingsManager.setQqMusicEnabled(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should stop notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = settingsManager.subscribe(listener);
    unsubscribe();
    settingsManager.setFloatingPanel(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('should not notify when downloadPath changes', () => {
    // downloadPath does not call notify()
    const listener = vi.fn();
    settingsManager.subscribe(listener);
    settingsManager.setDownloadPath('/path');
    expect(listener).not.toHaveBeenCalled();
  });
});
