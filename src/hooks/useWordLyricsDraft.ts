import { useState } from 'react';
import type { Track } from '../types';
import type { WordLyricsFormat } from '../shared/lrcParser';
import { editableWordLyricsText } from '../shared/wordLyricsEditing';

export interface WordLyricsDraft {
  /** True when the lyrics field edits the track's QRC/YRC body directly. */
  active: boolean;
  format: WordLyricsFormat | undefined;
  /** The stored payload the edit is applied to (keeps the QRC envelope). */
  original: string | undefined;
  text: string;
  changed: boolean;
  setText: (text: string) => void;
}

/** Editable QRC/YRC text for a local track that stores word-timed lyrics. */
export function useWordLyricsDraft(track: Track): WordLyricsDraft {
  const format = track.wordLyrics ? track.wordLyricsFormat : undefined;
  const [baseline] = useState(() => (format ? editableWordLyricsText(track.wordLyrics!, format) : ''));
  const [text, setText] = useState(baseline);
  return {
    active: format !== undefined,
    format,
    original: format ? track.wordLyrics : undefined,
    text,
    changed: format !== undefined && text !== baseline,
    setText,
  };
}
