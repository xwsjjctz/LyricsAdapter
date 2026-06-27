interface RangeValidationResult {
  success: boolean;
  maxBytes?: number;
  error?: string;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function validateWebDAVRangeResponse(
  status: number,
  contentRange: string | null,
  contentLength: string | null,
  start: number,
  end: number,
): RangeValidationResult {
  const isRangeRequest = start >= 0 || end >= 0;
  if (!isRangeRequest) {
    return status >= 200 && status < 300
      ? { success: true }
      : { success: false, error: `Range fetch failed: ${status}` };
  }

  if (start < 0 || end < start) {
    return { success: false, error: `Invalid range: ${start}-${end}` };
  }

  const requestedBytes = end - start + 1;

  if (status !== 206) {
    return { success: false, error: `Range request expected 206 Partial Content, got ${status}` };
  }

  const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match?.[1] || !match[2]) {
    return { success: false, error: 'Missing or invalid Content-Range header' };
  }

  const actualStart = Number.parseInt(match[1], 10);
  const actualEnd = Number.parseInt(match[2], 10);
  if (actualStart !== start || actualEnd < actualStart || actualEnd > end) {
    return { success: false, error: `Unexpected Content-Range: ${contentRange}` };
  }

  const rangeBytes = actualEnd - actualStart + 1;
  if (rangeBytes > requestedBytes) {
    return { success: false, error: `Range response too large: ${rangeBytes} bytes` };
  }

  const declaredLength = parsePositiveInt(contentLength);
  if (declaredLength !== null && declaredLength > rangeBytes) {
    return { success: false, error: `Range Content-Length too large: ${declaredLength} bytes` };
  }

  return { success: true, maxBytes: rangeBytes };
}

export async function readArrayBufferWithLimit(response: Response, maxBytes?: number): Promise<ArrayBuffer> {
  if (!maxBytes) return response.arrayBuffer();

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error(`Response body exceeded range limit: ${buffer.byteLength} > ${maxBytes}`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Response body exceeded range limit: ${total} > ${maxBytes}`);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return merged.buffer;
}
