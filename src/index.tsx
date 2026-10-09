import { createRoot } from 'react-dom/client';
import { appStorage } from './services/appStorage';
import { installInputModality } from './services/inputModality';
import { dismissStartupScreen } from './services/startupScreen';

// 初始化应用存储：主进程已有设置时以其为权威；仅在主存储为空时迁移
// allowlist 中的旧 localStorage 设置。UI 模块在初始化完成后才加载，避免
// theme/WebDAV/cookie 等单例在敏感值进入内存 cache 前读到空状态。

const platform = window.electron?.platform;
if (platform) {
  document.documentElement.classList.add('electron');
  if (platform === 'win32') {
    document.documentElement.dataset['windowEffect'] = 'acrylic';
  } else if (platform === 'darwin') {
    // Native vibrancy is gone; the translucent white wash on the root keeps
    // the desktop faintly visible and biases glass surfaces light.
    document.documentElement.dataset['windowEffect'] = 'translucent';
  }
}

async function bootstrap(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('Could not find root element');
    return;
  }

  installInputModality();
  try {
    await appStorage.init();
    const { installSettingsSync } = await import('./services/settingsSync');
    installSettingsSync();
    const root = createRoot(rootElement);
    const settingsSection = new URLSearchParams(location.search).get('settings-panel');
    if (platform === 'darwin' && settingsSection) {
      document.documentElement.dataset['settingsPanel'] = 'native';
      delete document.documentElement.dataset['windowEffect'];
      document.title = 'LyricsAdapter Settings';
      dismissStartupScreen();
      const { default: SettingsWindow } = await import('./components/settings/SettingsWindow');
      const sections = ['general', 'plugins', 'online', 'cloud', 'focus', 'shortcuts'];
      const section = sections.includes(settingsSection) ? settingsSection as import('./types/settingsPanel').SettingsSectionId : 'general';
      root.render(<SettingsWindow section={section} />);
    } else {
      const { default: App } = await import('./App');
      root.render(<App />);
    }
  } catch (err) {
    console.error("Failed to render React app:", err);
    dismissStartupScreen();
    rootElement.innerHTML = `
      <div style="padding: 20px; color: white; background: #800; border-radius: 8px; margin: 20px;">
        <h2>Startup Error</h2>
        <p>${err instanceof Error ? err.message : String(err)}</p>
        <p>Please check the browser console for details.</p>
      </div>
    `;
  }
}

void bootstrap();
