import type { WebdavAccountProbe, WebdavCredentialMode } from '../../src/shared/ipcContract';
import { settingsStore } from './settingsStore';

/**
 * WebDAV credentials stay in the main process: the renderer names a URL and
 * whether the stored account applies, never an Authorization header. Stored
 * credentials are attached only to the configured server's origin, so the
 * proxy cannot be used to send them elsewhere.
 */
type WebdavAccount = WebdavAccountProbe;

const WEBDAV_CONFIG_KEY = 'webdav-config';

export function basicAuthorization(account: Pick<WebdavAccount, 'username' | 'password'>): string {
  return `Basic ${Buffer.from(`${account.username}:${account.password}`, 'utf8').toString('base64')}`;
}

function storedAccount(read: (key: string) => string | undefined): WebdavAccount {
  const raw = read(WEBDAV_CONFIG_KEY);
  if (!raw) throw new Error('WebDAV is not configured');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid WebDAV configuration');
  const { serverUrl, username, password } = value as Record<string, unknown>;
  if (typeof serverUrl !== 'string' || typeof username !== 'string' || typeof password !== 'string' || !serverUrl || !username) {
    throw new Error('WebDAV is not configured');
  }
  return { serverUrl, username, password };
}

/** The Authorization header for a request, or '' when it carries no credentials. */
export function webdavAuthorization(
  url: string,
  mode: WebdavCredentialMode,
  read: (key: string) => string | undefined = key => settingsStore.get(key),
): string {
  if (mode === 'none') return '';
  const account = storedAccount(read);
  if (new URL(url).origin !== new URL(account.serverUrl).origin) {
    throw new Error('WebDAV credentials apply only to the configured server');
  }
  return basicAuthorization(account);
}
