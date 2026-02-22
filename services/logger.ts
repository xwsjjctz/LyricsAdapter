/**
 * Enhanced logging system with level control
 *
 * Usage:
 * - logger.debug(...) - Development only, disabled in production
 * - logger.info(...) - Development only, disabled in production
 * - logger.warn(...) - Always enabled
 * - logger.error(...) - Always enabled
 */

type LogArgs = unknown[];

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Get the current log level based on environment
 */
function getLogLevel(): LogLevel {
  // Check if we're in development mode
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    return LogLevel.DEBUG;
  }

  // Check if we're in development mode via other means
  if (typeof window !== 'undefined' && window.__DEV__) {
    return LogLevel.DEBUG;
  }

  // Production: only show warnings and errors
  return LogLevel.WARN;
}

/**
 * Logger class with level control
 */
class Logger {
  private level: LogLevel;

  constructor() {
    this.level = getLogLevel();
  }

  /**
   * Set the log level programmatically
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Debug level logging - only in development
   */
  debug(...args: LogArgs): void {
    if (this.level <= LogLevel.DEBUG) {
      console.log('[DEBUG]', ...args);
    }
  }

  /**
   * Info level logging - only in development
   */
  info(...args: LogArgs): void {
    if (this.level <= LogLevel.INFO) {
      console.info('[INFO]', ...args);
    }
  }

  /**
   * Warning level logging - always enabled in production
   */
  warn(...args: LogArgs): void {
    if (this.level <= LogLevel.WARN) {
      console.warn('[WARN]', ...args);
    }
  }

  /**
   * Error level logging - always enabled
   */
  error(...args: LogArgs): void {
    if (this.level <= LogLevel.ERROR) {
      console.error('[ERROR]', ...args);
    }
  }

  /**
   * Create a scoped logger with a prefix
   * @example
   * const playbackLogger = logger.withScope('Playback');
   * playbackLogger.debug('Track changed');
   */
  withScope(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope);
  }
}

/**
 * Scoped logger with automatic prefix
 */
class ScopedLogger {
  constructor(private logger: Logger, private scope: string) {}

  private formatArgs(args: LogArgs): LogArgs {
    return [`[${this.scope}]`, ...args];
  }

  debug(...args: LogArgs): void {
    this.logger.debug(...this.formatArgs(args));
  }

  info(...args: LogArgs): void {
    this.logger.info(...this.formatArgs(args));
  }

  warn(...args: LogArgs): void {
    this.logger.warn(...this.formatArgs(args));
  }

  error(...args: LogArgs): void {
    this.logger.error(...this.formatArgs(args));
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();
