type LogArgs = unknown[];

const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;

export const logger = {
  debug: (...args: LogArgs) => {
    if (isDev) {
      console.log(...args);
    }
  },
  info: (...args: LogArgs) => {
    if (isDev) {
      console.info(...args);
    }
  },
  warn: (...args: LogArgs) => {
    console.warn(...args);
  },
  error: (...args: LogArgs) => {
    console.error(...args);
  }
};
