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
      isEditMode={false}
      selectedCount={0}
      showEditDropdown={false}
      setShowEditDropdown={vi.fn()}
      onToggleEditMode={vi.fn()}
      onBatchDelete={vi.fn()}
      onImportClick={vi.fn()}
      onRefreshCloud={vi.fn()}
      trackCount={0}
      searchBox={<div className="global-search-box" />}
    />,
  );
}

describe('LibraryToolbar fixed-size actions', () => {
  it('prevents the local upload and edit controls from shrinking', () => {
    const { container } = renderToolbar('local');
    const actions = container.querySelector('.library-toolbar-actions');
    const uploadButton = actions?.querySelector('button[aria-label]');
    const editWrapper = actions?.querySelector('.relative');

    expect(uploadButton).toHaveClass('w-10', 'h-10', 'shrink-0');
    expect(editWrapper).toHaveClass('shrink-0');
  });

  it('prevents both cloud action buttons from shrinking', () => {
    const { container } = renderToolbar('cloud');
    const actionButtons = container.querySelectorAll('.library-toolbar-actions > button');

    expect(actionButtons).toHaveLength(2);
    actionButtons.forEach(button => expect(button).toHaveClass('w-10', 'h-10', 'shrink-0'));
  });
});
