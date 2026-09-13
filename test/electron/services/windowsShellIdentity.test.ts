// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(),
  },
  shell: {
    readShortcutLink: vi.fn(),
    writeShortcutLink: vi.fn(),
  },
}));

import {
  repairWindowsShellIdentity,
  type WindowsShellIdentityDependencies,
} from '@/../electron/services/windowsShellIdentity';

const programsDirectory = 'C:\\Users\\tester\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs';
const executablePath = 'C:\\Users\\tester\\AppData\\Local\\Programs\\lyrics-adapter\\LyricsAdapter.exe';
const appShortcutPath = `${programsDirectory}\\LyricsAdapter.lnk`;
const developmentShortcutPath = `${programsDirectory}\\Electron.lnk`;

function createDependencies(
  overrides: Partial<WindowsShellIdentityDependencies> = {},
): WindowsShellIdentityDependencies {
  const shortcuts = new Map([
    [appShortcutPath, {
      target: executablePath,
      appUserModelId: 'electron.app.LyricsAdapter',
    }],
    [developmentShortcutPath, {
      target: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
      appUserModelId: 'com.lyricsadapter.app',
    }],
  ]);
  return {
    platform: 'win32',
    isPackaged: true,
    programsDirectory,
    executablePath,
    exists: filePath => shortcuts.has(filePath),
    readShortcut: filePath => shortcuts.get(filePath)!,
    writeShortcut: vi.fn(() => true),
    removeFile: vi.fn(),
    ...overrides,
  };
}

describe('repairWindowsShellIdentity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the installed shortcut and removes the colliding development shortcut', () => {
    const dependencies = createDependencies();

    expect(repairWindowsShellIdentity(dependencies)).toEqual({
      appShortcutUpdated: true,
      staleDevelopmentShortcutRemoved: true,
      reason: 'ready',
    });
    expect(dependencies.writeShortcut).toHaveBeenCalledWith(
      appShortcutPath,
      'update',
      expect.objectContaining({
        target: executablePath,
        cwd: 'C:\\Users\\tester\\AppData\\Local\\Programs\\lyrics-adapter',
        icon: executablePath,
        iconIndex: 0,
        appUserModelId: 'com.lyricsadapter.app',
      }),
    );
    expect(dependencies.removeFile).toHaveBeenCalledWith(developmentShortcutPath);
  });

  it('does not touch shortcuts when an unpacked build is not the installed target', () => {
    const dependencies = createDependencies({
      executablePath: 'C:\\workspace\\LyricsAdapter\\release\\win-unpacked\\LyricsAdapter.exe',
    });

    expect(repairWindowsShellIdentity(dependencies)).toEqual({
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: false,
      reason: 'different-installation',
    });
    expect(dependencies.writeShortcut).not.toHaveBeenCalled();
    expect(dependencies.removeFile).not.toHaveBeenCalled();
  });

  it('preserves unrelated Electron shortcuts', () => {
    const dependencies = createDependencies({
      readShortcut: filePath => filePath === developmentShortcutPath
        ? {
          target: 'C:\\Tools\\electron.exe',
          appUserModelId: 'com.other.application',
        }
        : {
          target: executablePath,
          appUserModelId: 'electron.app.LyricsAdapter',
        },
    });

    expect(repairWindowsShellIdentity(dependencies)).toMatchObject({
      appShortcutUpdated: true,
      staleDevelopmentShortcutRemoved: false,
      reason: 'ready',
    });
    expect(dependencies.removeFile).not.toHaveBeenCalled();
  });

  it('removes the stale development shortcut without rewriting a current app shortcut', () => {
    const dependencies = createDependencies({
      readShortcut: filePath => filePath === developmentShortcutPath
        ? {
          target: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
          appUserModelId: 'com.lyricsadapter.app',
        }
        : {
          target: executablePath,
          cwd: 'C:\\Users\\tester\\AppData\\Local\\Programs\\lyrics-adapter',
          icon: executablePath,
          iconIndex: 0,
          appUserModelId: 'com.lyricsadapter.app',
        },
    });

    expect(repairWindowsShellIdentity(dependencies)).toEqual({
      appShortcutUpdated: false,
      staleDevelopmentShortcutRemoved: true,
      reason: 'ready',
    });
    expect(dependencies.writeShortcut).not.toHaveBeenCalled();
    expect(dependencies.removeFile).toHaveBeenCalledWith(developmentShortcutPath);
  });
});
