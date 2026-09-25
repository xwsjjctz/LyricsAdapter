import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '@/components/ui';

describe('Switch', () => {
  it('exposes switch semantics and toggles to the opposite value', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} label="Online music" onChange={onChange} />);
    const control = screen.getByRole('switch', { name: 'Online music' });

    expect(control).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('links an optional description', () => {
    render(<Switch checked label="Font" describedBy="font-help" onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-describedby', 'font-help');
  });
});
