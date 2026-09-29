import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/app'),
    getPath: vi.fn(() => '/user-data'),
  },
  ipcMain: { handle: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn(),
    createFromDataURL: vi.fn(),
  },
  Notification: class {},
}));

vi.mock('@/../electron/windowManager', () => ({ getWindow: vi.fn() }));
vi.mock('@/../electron/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  buildNotificationArtworkSvg,
  isNotificationPermissionError,
  reportNotificationFailure,
} from '@/../electron/ipc/notificationHandlers';
import { logger } from '@/../electron/logger';

describe('notification artwork composition', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stacks batch covers with the first track in front and adds the app badge', () => {
    const first = 'data:image/png;base64,FIRST';
    const second = 'data:image/png;base64,SECOND';
    const third = 'data:image/png;base64,THIRD';
    const appIcon = 'data:image/png;base64,APP';

    const svg = buildNotificationArtworkSvg([first, second, third], appIcon);

    expect(svg).toContain('width="256" height="256"');
    expect(svg).toContain(appIcon);
    expect(svg.indexOf(third)).toBeLessThan(svg.indexOf(second));
    expect(svg.indexOf(second)).toBeLessThan(svg.indexOf(first));
    expect(svg).toContain('cx="224" cy="224"');
    expect(svg).toContain('width="40" height="40"');
  });
});

describe('notification failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it('recognizes the localized macOS "not allowed" error', () => {
    expect(isNotificationPermissionError('未能完成操作。（UNErrorDomain错误1。）')).toBe(true);
    expect(isNotificationPermissionError('The operation couldn’t be completed. (UNErrorDomain error 1.)')).toBe(true);
    expect(isNotificationPermissionError('(UNErrorDomain error 10.)')).toBe(false);
    expect(isNotificationPermissionError('some other failure')).toBe(false);
  });

  it('explains a missing permission once instead of logging an error each time', () => {
    reportNotificationFailure('(UNErrorDomain error 1.)');
    reportNotificationFailure('(UNErrorDomain error 1.)');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
    reportNotificationFailure('something else');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
