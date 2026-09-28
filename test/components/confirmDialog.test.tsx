import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '@/components/ConfirmDialog';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

function Harness({ onConfirm = vi.fn(), busy = false }: { onConfirm?: () => void; busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <ConfirmDialog isOpen={open} title="Remove?" message="Gone for good" confirmLabel="Remove"
        busy={busy} onConfirm={onConfirm} onCancel={() => setOpen(false)} />
    </>
  );
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });

  it('is a labelled modal dialog that takes focus', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Remove?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it('keeps Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const cancel = screen.getByRole('button', { name: 'common.cancel' });
    const confirm = screen.getByRole('button', { name: 'Remove' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('cancels on Escape without reaching window shortcuts and restores focus', async () => {
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Remove' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onWindowKey).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    window.removeEventListener('keydown', onWindowKey);
  });

  it('blocks both actions while busy', () => {
    const onConfirm = vi.fn();
    render(<Harness busy onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
