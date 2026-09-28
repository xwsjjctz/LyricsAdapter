import React from 'react';
import { useTranslation } from 'react-i18next';
import GsapModal from './GsapModal';
import Button from './ui/Button';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  /** `danger` for destructive actions, `primary` for everything else. */
  tone?: 'danger' | 'primary';
  /** Disables both actions while the confirmed work is in flight. */
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Two-action confirmation built on GsapModal; Escape and backdrop cancel. */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen, title, message, confirmLabel, tone = 'danger', busy = false, error, onConfirm, onCancel,
}) => {
  const { t } = useTranslation();
  const cancel = () => { if (!busy) onCancel(); };
  return (
    <GsapModal
      isOpen={isOpen}
      onDismiss={cancel}
      overlayClassName="z-50"
      overlayStyle={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      panelClassName="r-surface p-6 max-w-md w-full mx-4 shadow-2xl"
      panelStyle={{
        backgroundColor: 'var(--theme-background-dark)',
        border: '1px solid var(--theme-border-light)',
      }}
    >
      <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-text-primary)' }}>{title}</h3>
      <p className="mb-4" style={{ color: 'var(--theme-text-secondary)' }}>{message}</p>
      {error && <p role="alert" className="mb-4" style={{ color: 'var(--theme-error)' }}>{error}</p>}
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={cancel} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant={tone} onClick={onConfirm} disabled={busy}>{confirmLabel}</Button>
      </div>
    </GsapModal>
  );
};

export default ConfirmDialog;
