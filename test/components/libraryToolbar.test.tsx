import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryToolbar from '@/components/LibraryToolbar';
import { themeManager } from '@/services/themeManager';
import type { SlotId } from '@/types';

const colors = themeManager.getCurrentTheme().colors;

function renderToolbar(dataSource: SlotId) {
  return render(
    <LibraryToolbar
      dataSource={dataSource}
      colors={colors}
      onImportClick={vi.fn()}
      onRefreshCloud={vi.fn()}
      trackCount={0}
      searchBox={<div className="global-search-box" />}
    />,
  );
}

describe('LibraryToolbar fixed-size actions', () => {
  it('keeps only the fixed-size import control beside local search', () => {
    const { container } = renderToolbar('local');
    const actions = container.querySelector('.library-toolbar-actions');
    const uploadButton = actions?.querySelector('button[aria-label]');
    const buttons = actions?.querySelectorAll('button');

    expect(uploadButton).toHaveClass('w-10', 'h-10', 'shrink-0');
    expect(buttons).toHaveLength(1);
  });

  it('keeps cloud refresh fixed-size while audio upload is unavailable', () => {
    const { container } = renderToolbar('cloud');
    const actionButtons = container.querySelectorAll('.library-toolbar-actions > button');

    expect(actionButtons).toHaveLength(1);
    expect(actionButtons[0]).toHaveTextContent('refresh');
    actionButtons.forEach(button => expect(button).toHaveClass('w-10', 'h-10', 'shrink-0'));
  });
});
