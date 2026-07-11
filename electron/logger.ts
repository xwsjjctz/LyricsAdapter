/**
 * Logger utility for Electron main process
 * Simple logging with levels and file output support
 */

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

class Logger {
  private level: LogLevel = LogLevel.DEBUG;
  private prefix = '[Main]';

  constructor() {
    // Check for environment variable
    if (process.env['NODE_ENV'] === 'production') {
      this.level = LogLevel.WARN;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.level <= level;
  }

  private formatMessage(level: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      // Error 的 message/stack 是不可枚举的，JSON.stringify 会丢失成 "{}"，
      // 这里单独处理，保证 catch 块里的真实错误信息能被记录下来。
      if (arg instanceof Error) return arg.stack || `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ');
    return `${timestamp} ${level} ${this.prefix} ${message}`;
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(this.formatMessage('[DEBUG]', ...args));
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('[INFO]', ...args));
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('[WARN]', ...args));
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('[ERROR]', ...args));
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

export const logger = new Logger();
export { LogLevel };
