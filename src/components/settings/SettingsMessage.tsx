import type { ReactNode } from 'react';

export type SettingsMessageTone = 'success' | 'error';

/**
 * The result of a settings action, shown right under the control that started it.
 * Errors are alerts and stay until the next attempt; successes are polite status lines.
 */
export default function SettingsMessage({ tone, children }: { tone: SettingsMessageTone; children: ReactNode }) {
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className="settings-message" data-tone={tone}>
      <span className="material-symbols-rounded" aria-hidden="true">{tone === 'error' ? 'error' : 'check_circle'}</span>
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}
