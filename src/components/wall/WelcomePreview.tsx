import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import WallWelcome from './WallWelcome';

interface WelcomePreviewProps {
  onClose: () => void;
  onImport?: (() => void) | undefined;
}

/**
 * The empty-library welcome page shown over a library that already has songs, so it can be
 * tried after the first launch. Esc, the close button or a click outside ends it.
 */
export default function WelcomePreview({ onClose, onImport }: WelcomePreviewProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, []);
  return (
    <div className="welcome-preview" data-controlbar-passthrough onMouseDown={onClose}>
      <div ref={panelRef} className="welcome-preview__page" role="dialog" aria-modal="true" aria-label={t('settings.welcomePreview')} tabIndex={-1}
        onMouseDown={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}>
        <button type="button" className="wall-float__button welcome-preview__close" onClick={onClose} aria-label={t('welcome.closePreview')}>
          <span className="material-symbols-rounded" aria-hidden="true">close</span>
        </button>
        <WallWelcome onImport={onImport ? () => { onClose(); onImport(); } : undefined} />
      </div>
    </div>
  );
}
