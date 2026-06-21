import '@testing-library/jest-dom';

/**
 * Vitest jsdom 环境不一定自动暴露 localStorage 全局变量，
 * 这里手动提供一份内存 mock，确保依赖 localStorage 的模块（settingsManager、shortcuts 等）可正常加载。
 */
if (typeof globalThis.localStorage === 'undefined' ||
    typeof globalThis.localStorage.getItem !== 'function') {
  const store: Record<string, string> = {};

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => {
        for (const k of Object.keys(store)) {
          delete store[k];
        }
      },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    },
    writable: false,
    configurable: true,
  });
}
