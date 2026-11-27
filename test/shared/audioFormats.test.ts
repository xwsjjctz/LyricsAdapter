import { describe, expect, it } from 'vitest';
import { IMPORTABLE_AUDIO_ACCEPT, isImportableAudioName } from '../../src/shared/audioFormats';

describe('importable audio formats', () => {
  it('accepts MP3 and FLAC by extension, whatever the case or path', () => {
    expect(isImportableAudioName('Song.mp3')).toBe(true);
    expect(isImportableAudioName('/Music/Album/01 Intro.FLAC')).toBe(true);
    expect(isImportableAudioName('C:\\Music\\Song.Mp3')).toBe(true);
  });

  it('rejects other containers and names that only mention a format', () => {
    for (const name of ['Song.m4a', 'Song.wav', 'Song.ogg', 'Song.aac', 'mp3', 'Song.mp3.txt', 'Album']) {
      expect(isImportableAudioName(name)).toBe(false);
    }
  });

  it('offers the same formats to a file input', () => {
    expect(IMPORTABLE_AUDIO_ACCEPT).toBe('.mp3,.flac');
  });
});
