/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    return {
      base: './',
      // Vite root stays at the repo root: vite-plugin-electron spawns Electron
      // with cwd = server.config.root, so it must be the repo root for Electron
      // to find package.json's `main`. Renderer source lives under src/ and is
      // referenced from index.html via /src/index.tsx, /src/index.css. The `@`
      // alias below also points at src/.
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Allow cross-origin requests from app://localhost (used in dev mode
        // by the app:// protocol proxy for origin-unified localStorage/IndexedDB).
        cors: {
          origin: ['app://localhost', 'http://localhost:3000'],
          credentials: true,
        },
        // HMR must use explicit host:port because the page origin is app://localhost
        // (no port). Without this, the HMR client would try ws://localhost:80 which
        // fails. By setting host+port explicitly, Vite injects __HMR_HOSTNAME__ and
        // __HMR_PORT__ into the client so it connects to ws://localhost:3000.
        hmr: {
          protocol: 'ws',
          host: 'localhost',
          port: 3000,
        },
      },
      plugins: [
        react(),
        // `optimize: { minify: false }` disables Tailwind v4's internal
        // lightningcss pass, which otherwise strips the standard
        // `backdrop-filter` declaration and keeps only the `-webkit-` form.
        // Chromium 148 / Electron 42 no longer honours the `-webkit-` prefix
        // for backdrop-filter, so the packaged app lost every frosted-glass
        // surface (dev was fine because Tailwind skips this pass in serve
        // mode). With Tailwind's pass off, Vite's CSS minifier (esbuild,
        // configured below) does the minification and preserves both forms.
        tailwindcss({ optimize: false }),
        electron([
          {
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
            entry: 'electron/preload.ts',
            onstart(args) {
              args.reload();
            },
            vite: {
              build: {
                outDir: 'dist-electron',
                lib: {
                  entry: 'electron/preload.ts',
                  formats: ['cjs'],
                  fileName: () => 'preload.cjs'
                },
                rollupOptions: {
                  external: ['electron']
                }
              }
            }
          },
          {
            entry: 'electron/cleanup.ts',
            vite: {
              build: {
                outDir: 'dist-electron',
                rollupOptions: {
                  external: ['electron']
                }
              }
            }
          }
        ])
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, 'src')
        }
      },
      build: {
        // Output must land at repo-root dist/ — windowManager.ts, appProtocol.ts
        // and electron-builder extraResources all reference <root>/dist.
        outDir: path.resolve(__dirname, 'dist'),
        chunkSizeWarningLimit: 2000,
        // Use esbuild for CSS minification. Vite's default ('lightningcss'
        // when installed) strips the standard `backdrop-filter` and keeps only
        // the `-webkit-` form, which Chromium 148 / Electron 42 ignores.
        // esbuild preserves both declarations.
        cssMinify: 'esbuild',
        rollupOptions: {
          external: mode === 'production' ? ['electron'] : [],
          output: {
            // Rolldown (Vite 8) requires manualChunks as a function, not an object.
            manualChunks(id: string) {
              if (id.includes('node_modules/gsap')) return 'gsap';
              if (id.includes('node_modules/pinyin-pro')) return 'pinyin-pro';
            },
          },
        }
      },
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./test/setup.ts'],
        include: ['test/**/*.test.{ts,tsx}'],
        coverage: {
          provider: 'v8',
          include: [
            'src/services/**/*.ts',
            'src/hooks/**/*.ts',
            'src/components/**/*.tsx',
            'electron/utils/**/*.ts',
          ],
        },
      },
    };
});
