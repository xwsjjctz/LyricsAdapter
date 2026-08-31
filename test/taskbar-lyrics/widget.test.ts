import {
  createTaskbarLyricsViewModel,
  TASKBAR_COVER_THUMB_SIZE,
  type TaskbarLyricsRendererState,
  toTaskbarCoverUrl,
} from '../../src/taskbar-lyrics/viewModel';
import {
  mountTaskbarLyricsWidget,
  type TaskbarLyricsBridge,
} from '../../src/taskbar-lyrics/index';

function state(
  overrides: Partial<TaskbarLyricsRendererState> = {},
): TaskbarLyricsRendererState {
  return {
    coverUrl: 'cover://track-1.jpg',
    line: '当前歌词',
    nextLine: '下一句歌词',
    ...overrides,
  };
}

function installMarkup(): void {
  document.body.innerHTML = `
    <main id="taskbar-lyrics-widget" hidden>
      <div class="artwork">
        <span id="artwork-placeholder">♫</span>
        <img id="artwork-image" alt="" hidden />
      </div>
      <div class="lyrics">
        <div id="current-lyric"></div>
        <div id="next-lyric"></div>
      </div>
    </main>
  `;
}

describe('taskbar lyrics view model', () => {
  it('accepts only cover and HTTPS artwork and requests a 128px cover thumbnail', () => {
    const local = toTaskbarCoverUrl('cover://track.jpg?v=123');
    expect(local).not.toBeNull();
    expect(new URL(local!).protocol).toBe('cover:');
    expect(new URL(local!).searchParams.get('size')).toBe(String(TASKBAR_COVER_THUMB_SIZE));
    expect(toTaskbarCoverUrl('https://example.com/cover.jpg')).toBe('https://example.com/cover.jpg');
    expect(toTaskbarCoverUrl('http://example.com/cover.jpg')).toBeNull();
    expect(toTaskbarCoverUrl('file:///C:/private.jpg')).toBeNull();
    expect(toTaskbarCoverUrl('javascript:alert(1)')).toBeNull();
  });

  it('never substitutes title or artist for an empty lyric', () => {
    expect(createTaskbarLyricsViewModel(state({ line: '', nextLine: '' }))).toMatchObject({
      currentLine: '暂无歌词',
      nextLine: '',
    });
  });
});

describe('taskbar lyrics widget', () => {
  it('renders only cover and lyrics, with a placeholder on image failure', () => {
    installMarkup();
    let publish: ((nextState: TaskbarLyricsRendererState) => void) | undefined;
    const unsubscribe = vi.fn();
    const bridge: TaskbarLyricsBridge = {
      onState(callback) {
        publish = callback;
        return unsubscribe;
      },
    };
    const unmount = mountTaskbarLyricsWidget(document, bridge);

    publish?.({
      ...state(),
      // Extra input is deliberately ignored by the presentation-only view.
      title: '不应显示的歌名',
      artist: '不应显示的歌手',
    } as TaskbarLyricsRendererState);

    const widget = document.getElementById('taskbar-lyrics-widget')!;
    const image = document.getElementById('artwork-image') as HTMLImageElement;
    const placeholder = document.getElementById('artwork-placeholder')!;
    expect(widget.hidden).toBe(false);
    expect(document.getElementById('current-lyric')).toHaveTextContent('当前歌词');
    expect(document.getElementById('next-lyric')).toHaveTextContent('下一句歌词');
    expect(widget).not.toHaveTextContent('不应显示的歌名');
    expect(widget).not.toHaveTextContent('不应显示的歌手');
    expect(widget.querySelector('button')).toBeNull();
    expect(image.hidden).toBe(true);
    expect(placeholder.hidden).toBe(false);

    image.dispatchEvent(new Event('load'));
    expect(image.hidden).toBe(false);
    expect(placeholder.hidden).toBe(true);

    image.dispatchEvent(new Event('error'));
    expect(image.hidden).toBe(true);
    expect(placeholder.hidden).toBe(false);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
