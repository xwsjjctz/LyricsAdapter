import type { IpcResult } from '../../src/types/typedIpc';

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(error: string): IpcResult<T> {
  return { ok: false, error };
}

export function parsePayload<T>(
  schema: {
    safeParse: (payload: unknown) =>
      | { success: true; data: T }
      | { success: false; error: { message: string } };
  },
  payload: unknown,
): IpcResult<T> {
  const parsed = schema.safeParse(payload);
  return parsed.success ? ok(parsed.data) : fail(parsed.error.message);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
