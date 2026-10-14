/**
 * The renderer's single origin: every window loads `app://localhost` in both
 * development and production (see appProtocol.ts).
 *
 * Local media and cover bytes are readable cross-origin only by this origin,
 * so Web Audio analysis and canvas colour sampling work in the app without
 * exposing the files to any other page.
 */
export const RENDERER_ORIGIN = 'app://localhost';

export const RENDERER_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': RENDERER_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
};
