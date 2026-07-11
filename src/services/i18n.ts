/**
 * i18n minimal shim — only for module-level code that cannot use
 * react-i18next's `useTranslation()` hook (class components, utility
 * functions, module-level arrow functions).
 *
 * Most callers have been migrated. New code should always use:
 *
 *   import { useTranslation } from 'react-i18next';
 *   const { t } = useTranslation();
 *
 * This shim can be deleted once the last `i18n.t()` call site
 * (ErrorBoundary, shared.ts, SearchBox sub-components, …) is gone.
 */
import i18next from '../i18n';

/**
 * @deprecated Use `const { t } = useTranslation()` in components/hooks,
 *             or import `i18next` directly for imperative access.
 */
export const i18n = {
  t(key: string): string {
    return i18next.t(key) as string;
  },
};

export type Language = import('../i18n').Language;
export default i18next;
