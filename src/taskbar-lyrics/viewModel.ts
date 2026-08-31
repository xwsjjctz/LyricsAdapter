export const TASKBAR_COVER_THUMB_SIZE = 128;

/** The dedicated renderer receives presentation data only, never player metadata. */
export interface TaskbarLyricsRendererState {
  coverUrl: string;
  line: string;
  nextLine: string;
}

export interface TaskbarLyricsViewModel {
  coverUrl: string | null;
  currentLine: string;
  nextLine: string;
}

function compactText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

/**
 * Keep the widget image surface deliberately narrower than the main renderer:
 * cached local covers and HTTPS provider artwork are the only accepted inputs.
 */
export function toTaskbarCoverUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'cover:') {
      parsed.searchParams.set('size', String(TASKBAR_COVER_THUMB_SIZE));
      return parsed.toString();
    }
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function createTaskbarLyricsViewModel(
  state: TaskbarLyricsRendererState,
): TaskbarLyricsViewModel {
  return {
    coverUrl: toTaskbarCoverUrl(state.coverUrl),
    currentLine: compactText(state.line) || '暂无歌词',
    nextLine: compactText(state.nextLine),
  };
}
