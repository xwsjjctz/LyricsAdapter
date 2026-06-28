import { z } from 'zod';

const httpUrlSchema = z.string().url().refine(value => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'Only http and https URLs are allowed');

export const typedIpcSchemas = {
  filePath: z.object({
    filePath: z.string().min(1),
  }),
  library: z.unknown(),
  webdavPropfind: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    depth: z.enum(['0', '1']),
  }),
  webdavRange: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    start: z.number().int(),
    end: z.number().int(),
  }),
  webdavPut: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
    data: z.instanceof(ArrayBuffer),
    contentType: z.string().min(1),
  }),
  webdavDelete: z.object({
    url: httpUrlSchema,
    authHeader: z.string(),
  }),
  downloadAudio: z.object({
    url: httpUrlSchema,
    cookieString: z.string(),
  }),
};

export type TypedIpcSchemas = typeof typedIpcSchemas;
