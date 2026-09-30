import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types';

const { writeAudioMetadata } = vi.hoisted(() => ({
  writeAudioMetadata: vi.fn(async (_path: string, _metadata: Record<string, unknown>) => ({ success: true })),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/services/desktopAdapter', () => ({ getDesktopAPI: () => ({ writeAudioMetadata }) }));
vi.mock('@/services/notificationService', () => ({ notify: vi.fn() }));
vi.mock('@/services/metadataCacheService', () => ({ metadataCacheService: {} }));

import MetadataEditorPopup from '@/components/MetadataEditorPopup';

const YRC = '[1000,900](1000,300,0)你(1300,600,0)好';
const wordLine = { time: 1, text: '你好', words: [{ time: 1, duration: 0.3, text: '你' }, { time: 1.3, duration: 0.6, text: '好' }] };
const yrcTrack: Track = {
  id: 't1', title: '歌', artist: 'A', album: 'B', duration: 90, audioUrl: '', filePath: '/music/t1.flac',
  lyrics: '你好', syncedLyrics: [wordLine], wordLyrics: YRC, wordLyricsFormat: 'yrc',
};

function renderEditor(track: Track) {
  const onUpdateTrack = vi.fn();
  render(<MetadataEditorPopup track={track} isOpen onUpdateTrack={onUpdateTrack} onClose={vi.fn()} onExited={vi.fn()} />);
  return { onUpdateTrack, lyrics: screen.getByLabelText('metadataView.fieldLyrics') as HTMLTextAreaElement };
}

describe('MetadataEditorPopup word-timed lyrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });

  it('edits the YRC source and saves it as word lyrics with fresh word timing', async () => {
    const { onUpdateTrack, lyrics } = renderEditor(yrcTrack);
    expect(lyrics.value).toBe(YRC);
    expect(screen.getByText('YRC')).toBeInTheDocument();

    fireEvent.change(lyrics, { target: { value: '[1000,900](1000,300,0)你(1300,600,0)们' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(onUpdateTrack).toHaveBeenCalled());
    expect(writeAudioMetadata).toHaveBeenCalledWith('/music/t1.flac', expect.objectContaining({
      wordLyrics: '[1000,900](1000,300,0)你(1300,600,0)们', wordLyricsFormat: 'yrc',
    }));
    expect(writeAudioMetadata.mock.calls[0]![1]).not.toHaveProperty('lyrics');
    const saved = onUpdateTrack.mock.calls[0]![0] as Track;
    expect(saved.lyrics).toBe('你们');
    expect(saved.wordLyrics).toBe('[1000,900](1000,300,0)你(1300,600,0)们');
    expect(saved.syncedLyrics?.[0]?.words?.map(word => word.text)).toEqual(['你', '们']);
  });

  it('refuses to save word lyrics that lost their timing', async () => {
    const { onUpdateTrack, lyrics } = renderEditor(yrcTrack);
    fireEvent.change(lyrics, { target: { value: '你们' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('metadataView.wordLyricsInvalid');
    expect(writeAudioMetadata).not.toHaveBeenCalled();
    expect(onUpdateTrack).not.toHaveBeenCalled();
  });

  it('keeps existing timing and the file lyrics tag when only the title changes', async () => {
    const { onUpdateTrack } = renderEditor(yrcTrack);
    fireEvent.change(screen.getByLabelText('metadataView.fieldTitle'), { target: { value: '新歌' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => expect(onUpdateTrack).toHaveBeenCalled());
    const written = writeAudioMetadata.mock.calls[0]![1];
    expect(written).not.toHaveProperty('lyrics');
    expect(written).not.toHaveProperty('wordLyrics');
    expect((onUpdateTrack.mock.calls[0]![0] as Track).syncedLyrics).toEqual([wordLine]);
  });
});
