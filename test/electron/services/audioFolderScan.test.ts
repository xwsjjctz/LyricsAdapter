// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectImportableAudio } from '../../../electron/services/audioFolderScan';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'la-audio-scan-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function touch(...segments: string[]): Promise<string> {
  const filePath = path.join(root, ...segments);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '');
  return filePath;
}

describe('collectImportableAudio', () => {
  it('lists MP3 and FLAC beneath a folder, its own files first and in natural order', async () => {
    const ten = await touch('Album', '10 Ten.mp3');
    const two = await touch('Album', '2 Two.flac');
    const discTwo = await touch('Album', 'CD2', '1 One.MP3');
    await touch('Album', 'cover.jpg');
    await touch('Album', 'notes.m4a');

    expect(await collectImportableAudio([root])).toEqual({ filePaths: [two, ten, discTwo], truncated: false });
  });

  it('skips hidden folders and AppleDouble files', async () => {
    await touch('.Trash', 'Deleted.mp3');
    await touch('Music', '._Song.mp3');
    const song = await touch('Music', 'Song.mp3');

    expect((await collectImportableAudio([root])).filePaths).toEqual([song]);
  });

  it.skipIf(process.platform === 'win32')('does not follow symbolic links inside a folder', async () => {
    const song = await touch('Real', 'Song.mp3');
    await fs.symlink(root, path.join(root, 'Real', 'Loop'), 'dir');
    await fs.symlink(song, path.join(root, 'Real', 'Alias.mp3'));

    expect(await collectImportableAudio([root])).toEqual({ filePaths: [song], truncated: false });
  });

  it('takes loose files next to folders, lists each file once and ignores what it cannot use', async () => {
    const song = await touch('Album', 'Song.flac');
    const loose = await touch('Loose.mp3');
    const text = await touch('notes.txt');

    const scan = await collectImportableAudio([song, path.join(root, 'Album'), loose, text, path.join(root, 'missing')]);
    expect(scan).toEqual({ filePaths: [song, loose], truncated: false });
  });

  it('reports truncation only when a limit cuts the list short', async () => {
    await touch('a.mp3');
    await touch('b.mp3');
    await touch('Sub', 'c.mp3');

    expect(await collectImportableAudio([root], { files: 3, directories: 10 })).toMatchObject({ truncated: false });

    const byFiles = await collectImportableAudio([root], { files: 2, directories: 10 });
    expect(byFiles.filePaths).toHaveLength(2);
    expect(byFiles.truncated).toBe(true);

    const byFolders = await collectImportableAudio([root], { files: 10, directories: 1 });
    expect(byFolders.filePaths).toHaveLength(2);
    expect(byFolders.truncated).toBe(true);
  });
});
