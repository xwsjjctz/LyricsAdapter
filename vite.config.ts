import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');

    // Check if we should load Electron plugin (not for Tauri)
    const isTauri = process.env.TAURI === 'true' || process.env.npm_config_user_agent?.includes('tauri');

    return {
      base: './',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        tailwindcss(),
        // Only load Electron plugins if not in Tauri mode
        !isTauri ? electron([
          {
            // Main process file
            entry: 'electron/main.ts',
            vite: {
              build: {
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron']
                }
              }
            }
          },
          {
            // Preload file
            entry: 'electron/preload.ts',
            onstart(args) {
              args.reload();
            },
            vite: {
              build: {
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron']
                }
              }
            }
          }
        ]) : null
      ].filter(Boolean),
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          // 在非 Tauri 模式下（Electron 和浏览器），为 @tauri-apps 模块提供空实现
          ...(!isTauri ? {
            '@tauri-apps/api/window': path.resolve(__dirname, './src-tauri-stubs/window.js'),
            '@tauri-apps/api/core': path.resolve(__dirname, './src-tauri-stubs/core.js'),
            '@tauri-apps/plugin-dialog': path.resolve(__dirname, './src-tauri-stubs/dialog.js'),
          } : {})
        }
      },
      build: {
        rollupOptions: {
          // 在 Electron 生产构建时，将 @tauri-apps 模块标记为 external
          // 在 Tauri 生产构建时，不标记为 external，让 Tauri 运行时处理
          external: mode === 'production' && !isTauri ? ['@tauri-apps/api/core', '@tauri-apps/api/window', '@tauri-apps/plugin-dialog'] : []
        }
      },
      // 在 Tauri 开发模式下，优化构建以避免分析动态 import
      optimizeDeps: {
        exclude: isTauri ? ['@tauri-apps/api/window', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog'] : []
      }
    };
});
