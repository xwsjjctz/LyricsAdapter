// Node.js fetch (undici) proxy preload.
//
// Electron's main-process fetch does NOT read HTTP_PROXY/HTTPS_PROXY env vars
// by default — Node's global fetch uses a plain agent with no proxy. This
// means every WebDAV request from the main process goes direct even when a
// system proxy is configured.
//
// Loaded via `NODE_OPTIONS=--require=scripts/proxy-preload.cjs` (see
// package.json `electron:dev` / `electron:build`), this wires undici's
// EnvHttpProxyAgent as the global dispatcher so main-process fetch honours
// the proxy env vars. No business code is touched.
//
// If no proxy env vars are present, EnvHttpProxyAgent is a no-op (direct).
try {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');
  setGlobalDispatcher(new EnvHttpProxyAgent());
  // eslint-disable-next-line no-console
  console.log('[proxy-preload] Main-process fetch now honours HTTP_PROXY/HTTPS_PROXY env vars');
} catch (e) {
  // undici is built into Node.js 18+; if it's somehow unavailable, silently
  // fall back to direct connections (no proxy).
  // eslint-disable-next-line no-console
  console.warn('[proxy-preload] undici unavailable, main-process fetch stays direct:', e.message);
}
