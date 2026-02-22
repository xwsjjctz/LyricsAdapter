/**
 * Unified error handling system
 *
 * Usage:
 * - throw new AppError('Failed to load track', 'TRACK_LOAD_ERROR')
 * - handleError(error, 'ContextName')
 */

import { logger } from '../services/logger';

/**
 * Application error class with additional context
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }

  /**
   * Convert error to plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      recoverable: this.recoverable,
      details: this.details,
      stack: this.stack,
    };
  }
}

/**
 * Error codes for categorization
 */
export enum ErrorCode {
  // File system errors
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',

  // Metadata errors
  METADATA_PARSE_FAILED = 'METADATA_PARSE_FAILED',
  METADATA_INVALID = 'METADATA_INVALID',

  // Network errors
  NETWORK_REQUEST_FAILED = 'NETWORK_REQUEST_FAILED',
  NETWORK_TIMEOUT = 'NETWORK_TIMEOUT',

  // Playback errors
  PLAYBACK_FAILED = 'PLAYBACK_FAILED',
  AUDIO_SOURCE_NOT_SUPPORTED = 'AUDIO_SOURCE_NOT_SUPPORTED',
  AUDIO_DECODE_FAILED = 'AUDIO_DECODE_FAILED',

  // Storage errors
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',
  STORAGE_ACCESS_DENIED = 'STORAGE_ACCESS_DENIED',

  // Validation errors
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  INVALID_STATE = 'INVALID_STATE',

  // Unknown errors
  UNKNOWN = 'UNKNOWN',
}

/**
 * Handle and normalize errors
 * @param error - The error to handle
 * @param context - Context where the error occurred
 * @param options - Additional options
 * @returns Normalized AppError
 */
export function handleError(
  error: unknown,
  context: string,
  options?: { fallbackMessage?: string; code?: ErrorCode }
): AppError {
  const { fallbackMessage = 'An error occurred', code = ErrorCode.UNKNOWN } = options || {};

  // Already an AppError
  if (error instanceof AppError) {
    logger.error(`[${context}]`, error.message, { code: error.code, details: error.details });
    return error;
  }

  // Standard Error
  if (error instanceof Error) {
    const appError = new AppError(
      error.message || fallbackMessage,
      code,
      true,
      { originalMessage: error.message, stack: error.stack }
    );
    logger.error(`[${context}]`, error.message, { stack: error.stack });
    return appError;
  }

  // String error
  if (typeof error === 'string') {
    const appError = new AppError(error, code, true);
    logger.error(`[${context}]`, error);
    return appError;
  }

  // Unknown error type
  const appError = new AppError(fallbackMessage, code, true, { originalError: error });
  logger.error(`[${context}]`, 'Unknown error', error);
  return appError;
}

/**
 * Wrap an async function with error handling
 * @param fn - The async function to wrap
 * @param context - Context for error messages
 * @param options - Additional options
 * @returns Wrapped function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context: string,
  options?: { fallbackMessage?: string; code?: ErrorCode }
): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await fn(...args);
    } catch (error) {
      throw handleError(error, context, options);
    }
  }) as T;
}

/**
 * Safely execute a function and return null on error
 * @param fn - The function to execute
 * @param context - Context for error logging
 * @returns Result of the function or null on error
 */
export async function safeExecute<T>(
  fn: () => Promise<T> | T,
  context: string
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    handleError(error, context);
    return null;
  }
}

/**
 * Create an error result object
 */
export interface ErrorResult {
  success: false;
  error: {
    message: string;
    code: string;
    recoverable: boolean;
    details?: Record<string, unknown>;
  };
}

/**
 * Create a success result object
 */
export interface SuccessResult<T = unknown> {
  success: true;
  data: T;
}

/**
 * Convert an error to an error result object
 */
export function errorResult(error: AppError): ErrorResult {
  return {
    success: false,
    error: {
      message: error.message,
      code: error.code,
      recoverable: error.recoverable,
      details: error.details,
    },
  };
}

/**
 * Type guard for error results
 */
export function isErrorResult(result: unknown): result is ErrorResult {
  return typeof result === 'object' && result !== null && 'success' in result && result.success === false;
}

/**
 * Common error creators
 */
export const Errors = {
  fileNotFound: (filePath: string) =>
    new AppError(`File not found: ${filePath}`, ErrorCode.FILE_NOT_FOUND, false),

  fileReadFailed: (filePath: string, originalError?: Error) =>
    new AppError(
      `Failed to read file: ${filePath}`,
      ErrorCode.FILE_READ_FAILED,
      true,
      { originalError: originalError?.message }
    ),

  metadataParseFailed: (fileName: string, originalError?: Error) =>
    new AppError(
      `Failed to parse metadata for: ${fileName}`,
      ErrorCode.METADATA_PARSE_FAILED,
      true,
      { originalError: originalError?.message }
    ),

  playbackFailed: (trackTitle: string, originalError?: Error) =>
    new AppError(
      `Playback failed for: ${trackTitle}`,
      ErrorCode.PLAYBACK_FAILED,
      true,
      { originalError: originalError?.message }
    ),

  networkRequestFailed: (url: string, originalError?: Error) =>
    new AppError(
      `Network request failed: ${url}`,
      ErrorCode.NETWORK_REQUEST_FAILED,
      true,
      { url, originalError: originalError?.message }
    ),

  storageQuotaExceeded: () =>
    new AppError(
      'Storage quota exceeded',
      ErrorCode.STORAGE_QUOTA_EXCEEDED,
      false
    ),

  invalidArgument: (argName: string, expectedType: string) =>
    new AppError(
      `Invalid argument: ${argName} (expected ${expectedType})`,
      ErrorCode.INVALID_ARGUMENT,
      false
    ),
};
