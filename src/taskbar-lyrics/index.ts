import {
  createTaskbarLyricsViewModel,
  type TaskbarLyricsRendererState,
} from './viewModel';
import './style.css';

export interface TaskbarLyricsBridge {
  onState(callback: (state: TaskbarLyricsRendererState) => void): () => void;
}

declare global {
  interface Window {
    taskbarLyrics?: TaskbarLyricsBridge;
  }
}

interface TaskbarLyricsElements {
  widget: HTMLElement;
  artworkImage: HTMLImageElement;
  artworkPlaceholder: HTMLElement;
  currentLyric: HTMLElement;
  nextLyric: HTMLElement;
}

function requiredElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing taskbar lyrics element: ${id}`);
  return element as T;
}

function resolveElements(document: Document): TaskbarLyricsElements {
  return {
    widget: requiredElement(document, 'taskbar-lyrics-widget'),
    artworkImage: requiredElement<HTMLImageElement>(document, 'artwork-image'),
    artworkPlaceholder: requiredElement(document, 'artwork-placeholder'),
    currentLyric: requiredElement(document, 'current-lyric'),
    nextLyric: requiredElement(document, 'next-lyric'),
  };
}

export function mountTaskbarLyricsWidget(
  document: Document,
  bridge: TaskbarLyricsBridge | undefined,
): () => void {
  const elements = resolveElements(document);
  let expectedCoverUrl = '';

  const showArtworkPlaceholder = () => {
    elements.artworkImage.hidden = true;
    elements.artworkPlaceholder.hidden = false;
  };

  const handleArtworkLoad = () => {
    if (!expectedCoverUrl || elements.artworkImage.src !== expectedCoverUrl) return;
    elements.artworkImage.hidden = false;
    elements.artworkPlaceholder.hidden = true;
  };

  const handleArtworkError = () => {
    if (elements.artworkImage.src !== expectedCoverUrl) return;
    showArtworkPlaceholder();
  };

  const updateArtwork = (coverUrl: string | null) => {
    const nextCoverUrl = coverUrl ?? '';
    if (nextCoverUrl === expectedCoverUrl) return;

    expectedCoverUrl = nextCoverUrl;
    showArtworkPlaceholder();
    if (nextCoverUrl) {
      elements.artworkImage.src = nextCoverUrl;
    } else {
      elements.artworkImage.removeAttribute('src');
    }
  };

  const render = (state: TaskbarLyricsRendererState) => {
    const viewModel = createTaskbarLyricsViewModel(state);
    elements.widget.hidden = false;
    elements.widget.classList.toggle('is-single-line', viewModel.nextLine.length === 0);
    elements.currentLyric.textContent = viewModel.currentLine;
    elements.nextLyric.textContent = viewModel.nextLine;
    updateArtwork(viewModel.coverUrl);
  };

  elements.artworkImage.addEventListener('load', handleArtworkLoad);
  elements.artworkImage.addEventListener('error', handleArtworkError);
  const unsubscribe = bridge?.onState(render) ?? (() => {});

  return () => {
    unsubscribe();
    elements.artworkImage.removeEventListener('load', handleArtworkLoad);
    elements.artworkImage.removeEventListener('error', handleArtworkError);
  };
}

if (document.getElementById('taskbar-lyrics-widget')) {
  const unmount = mountTaskbarLyricsWidget(document, window.taskbarLyrics);
  window.addEventListener('pagehide', unmount, { once: true });
}
