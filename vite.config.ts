/// <reference types="vitest/config" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    return {
      base: './',
      // Renderer source lives under src/. Keeping the Vite root there lets
      // index.html's root-relative `/index.tsx` and `/index.css` resolve to
      // src/index.tsx / src/index.css, while `publicDir` below keeps the
      // repo-root public/ (fonts) served at /fonts/... unchanged.
      root: 'src',
      publicDir: path.resolve(__dirname, 'public'),
      server: {
        port: 3000,
        host: '0.0.0.0',
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
            // Entry/out paths resolve relative to Vite `root` (now src/), so
            // make them repo-root-absolute to keep electron/ at the project
            // root and its build output at repo-root dist-electron/.
            entry: path.resolve(__dirname, 'electron/main.ts'),
            vite: {
              build: {
                outDir: path.resolve(__dirname, 'dist-electron'),
                rollupOptions: {
                  external: ['electron']
                }
              }
            }
          },
          {
            entry: path.resolve(__dirname, 'electron/preload.ts'),
            onstart(args) {
              args.reload();
            },
            vite: {
              build: {
                outDir: path.resolve(__dirname, 'dist-electron'),
                lib: {
                  entry: path.resolve(__dirname, 'electron/preload.ts'),
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
            entry: path.resolve(__dirname, 'electron/cleanup.ts'),
            vite: {
              build: {
                outDir: path.resolve(__dirname, 'dist-electron'),
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
          external: mode === 'production' ? ['electron'] : []
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
