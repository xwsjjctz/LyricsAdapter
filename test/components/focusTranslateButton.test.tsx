import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FocusTranslateButton from '@/components/focus-mode/FocusTranslateButton';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('FocusTranslateButton', () => {
  it('renders nothing when no translation provider can be used', () => {
    const { container } = render(<FocusTranslateButton status="unavailable" onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('requests a translation, then shows progress and the translated state', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<FocusTranslateButton status="idle" onToggle={onToggle} />);
    const idle = screen.getByRole('button', { name: 'plugins.translate' });
    expect(idle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(idle);
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(<FocusTranslateButton status="translating" onToggle={onToggle} />);
    const busy = screen.getByRole('button', { name: 'plugins.translating' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    rerender(<FocusTranslateButton status="translated" onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'plugins.translated' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers a retry and explains the failure in visible text', () => {
    render(<FocusTranslateButton status="error" onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'plugins.translateRetry' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('plugins.translationError');
  });
});
