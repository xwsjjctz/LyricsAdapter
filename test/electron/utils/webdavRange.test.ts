import { describe, expect, it } from 'vitest';
import { readArrayBufferWithLimit, validateWebDAVRangeResponse } from '@/electron/utils/webdavRange';

describe('validateWebDAVRangeResponse', () => {
  it('allows full non-range responses for small metadata files', () => {
    expect(validateWebDAVRangeResponse(200, null, '120', -1, -1)).toEqual({ success: true });
  });

  it('rejects 200 OK responses to explicit range requests', () => {
    const result = validateWebDAVRangeResponse(200, null, '5000000', 0, 1023);

    expect(result.success).toBe(false);
    expect(result.error).toContain('expected 206');
  });

  it('accepts a matching 206 Content-Range response', () => {
    expect(validateWebDAVRangeResponse(206, 'bytes 0-1023/5000000', '1024', 0, 1023)).toEqual({
      success: true,
      maxBytes: 1024,
    });
  });

  it('rejects a Content-Range outside the requested range', () => {
    const result = validateWebDAVRangeResponse(206, 'bytes 0-2048/5000000', '2049', 0, 1023);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unexpected Content-Range');
  });

  it('rejects a declared body length larger than the accepted range', () => {
    const result = validateWebDAVRangeResponse(206, 'bytes 0-1023/5000000', '2048', 0, 1023);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Content-Length too large');
  });
});

describe('readArrayBufferWithLimit', () => {
  it('rejects body streams that exceed the validated range size', async () => {
    const response = new Response(new Uint8Array([1, 2, 3, 4]));

    await expect(readArrayBufferWithLimit(response, 3)).rejects.toThrow('exceeded range limit');
  });

  it('reads body streams within the validated range size', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    const buffer = await readArrayBufferWithLimit(response, 3);

    expect([...new Uint8Array(buffer)]).toEqual([1, 2, 3]);
  });
});
