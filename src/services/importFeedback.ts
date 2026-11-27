import type { TFunction } from 'i18next';
import { notify } from './notificationService';

/** A pick or drop held nothing importable; without this the import ends with no sign of why. */
export function notifyNothingImportable(t: TFunction): void {
  void notify(t('notifications.importNothingTitle'), t('notifications.importNothingBody'), { silent: true });
}

/** A folder scan stopped at its limit, so only the first `count` songs are being imported. */
export function notifyImportTruncated(t: TFunction, count: number): void {
  void notify(
    t('notifications.importTruncatedTitle'),
    t('notifications.importTruncatedBody', { count }),
    { silent: true },
  );
}
