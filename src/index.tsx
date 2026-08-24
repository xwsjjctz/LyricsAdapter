import { createRoot } from 'react-dom/client';
import { appStorage } from './services/appStorage';

// 初始化应用存储：主进程已有设置时以其为权威；仅在主存储为空时迁移
// allowlist 中的旧 localStorage 设置。UI 模块在初始化完成后才加载，避免
// theme/WebDAV/cookie 等单例在敏感值进入内存 cache 前读到空状态。

const platform = window.electron?.platform;
if (platform) {
  document.documentElement.classList.add('electron');
  if (platform === 'win32') {
    document.documentElement.dataset['windowEffect'] = 'acrylic';
  } else if (platform === 'darwin') {
    document.documentElement.dataset['windowEffect'] = 'vibrancy';
  }
}

async function bootstrap(): Promise<void> {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error('Could not find root element');
    return;
  }

  try {
    await appStorage.init();
    const { default: App } = await import('./App');
    const root = createRoot(rootElement);
    root.render(<App />);
  } catch (err) {
    console.error("Failed to render React app:", err);
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
