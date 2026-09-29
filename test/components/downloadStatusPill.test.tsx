import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => (values?.['count'] != null ? `${key}:${values['count']}` : key) }),
}));

import DownloadStatusPill, { summarizeDownloads } from '@/components/wall/DownloadStatusPill';

const t = (key: string, values?: Record<string, unknown>) => (values?.['count'] != null ? `${key}:${values['count']}` : key);

describe('download status', () => {
  it('shows progress while any download runs, ignoring uploads', () => {
    expect(summarizeDownloads([
      { type: 'download', percent: 20 },
      { type: 'download', percent: 60 },
      { type: 'upload', percent: 90 },
      { type: 'download', percent: 100, status: 'completed', message: 'done' },
    ], t)).toEqual({ label: 'search.downloading:2 40%', progress: 0.4, tone: 'active' });
  });

  it('then shows a failure with its reason before a success', () => {
    expect(summarizeDownloads([
      { type: 'download', percent: 100, status: 'completed', message: 'A - B downloaded' },
      { type: 'download', percent: 0, status: 'error', message: 'VIP required' },
    ], t)).toEqual({ label: 'notifications.downloadFailed: VIP required', tone: 'error' });
  });

  it('shows the completion message, and nothing once everything cleared', () => {
    expect(summarizeDownloads([{ type: 'download', percent: 100, status: 'completed', message: 'A - B downloaded (FLAC unavailable)' }], t))
      .toEqual({ label: 'A - B downloaded (FLAC unavailable)', tone: 'done' });
    expect(summarizeDownloads([], t)).toBeNull();
  });

  it('renders an in-app status the user can see without notifications', () => {
    const { container, rerender } = render(<DownloadStatusPill progress={{}} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DownloadStatusPill progress={{ s1: { type: 'download', percent: 0, status: 'error', message: 'HTTP error: 403' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('notifications.downloadFailed: HTTP error: 403');
    expect(screen.getByRole('status')).toHaveClass('wall-status-pill--error');
  });
});
