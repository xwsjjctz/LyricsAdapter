import { z } from 'zod';
import type { TranslationRequest, TranslationResult } from './plugin';

const text = z.string().max(16_384);
const id = z.string().min(1).max(128);
const time = z.number().finite().nonnegative();
const language = z.string().regex(/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/).max(64);
const documentSchema = z.object({
  id, revision: id, trackId: id, sourceLanguage: language.optional(),
  lines: z.array(z.object({ id, text, startMs: time.optional(), endMs: time.optional(),
    words: z.array(z.object({ text, startMs: time, endMs: time })).max(2048).optional(),
  })).min(1).max(5000),
});
export function validateTranslationRequest(value: unknown): TranslationRequest {
  const request = z.object({ document: documentSchema, targetLanguage: language }).parse(value);
  if (JSON.stringify(request).length > 1_000_000 || new Set(request.document.lines.map(line => line.id)).size !== request.document.lines.length) {
    throw new Error('Invalid lyric document size or duplicate line ids');
  }
  return request as TranslationRequest;
}
export function validateTranslationResult(value: unknown, request: TranslationRequest): TranslationResult {
  const result = z.object({ documentId: id, documentRevision: id, targetLanguage: language,
    lines: z.array(z.object({ lineId: id, text })).max(5000),
  }).parse(value);
  const known = new Set(request.document.lines.map(line => line.id));
  const returned = new Set<string>();
  if (result.documentId !== request.document.id || result.documentRevision !== request.document.revision || result.targetLanguage !== request.targetLanguage
    || JSON.stringify(result).length > 1_000_000) throw new Error('Translation document identity mismatch or excessive result size');
  for (const line of result.lines) {
    if (!known.has(line.lineId) || returned.has(line.lineId)) throw new Error('Unknown or duplicate translation line id');
    returned.add(line.lineId);
  }
  return result;
}
