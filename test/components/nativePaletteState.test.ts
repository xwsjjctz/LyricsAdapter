import { describe, expect, it, vi } from 'vitest';
import {
  dispatchForwardedShortcut,
  toNativePaletteState,
  toNativeRows,
  toSfSymbol,
} from '@/components/palette/nativePaletteState';
import type { PaletteItem } from '@/components/palette/usePaletteItems';

const item = (overrides: Partial<PaletteItem>): PaletteItem => ({
  key: overrides.title ?? 'row', section: 'Local', title: 'Row', run: vi.fn(), ...overrides,
});
const t = (key: string) => key;

describe('native palette state', () => {
  it('maps Material icons to SF Symbols with a visible fallback', () => {
    expect(toSfSymbol('settings')).toBe('gearshape');
    expect(toSfSymbol('queue_music')).toBe('music.note.list');
    expect(toSfSymbol('not_a_symbol')).toBe('circle.dashed');
    expect(toSfSymbol(undefined)).toBe('circle.dashed');
  });

  it('emits a section header only where the section changes', () => {
    const rows = toNativeRows([
      item({ title: 'A', section: 'Local' }),
      item({ title: 'B', section: 'Local' }),
      item({ title: 'C', section: 'Online' }),
    ]);
    expect(rows.map(row => row.section)).toEqual(['Local', '', 'Online']);
  });

  it('passes only covers the main process can fetch', () => {
    const rows = toNativeRows([
      item({ title: 'cover', coverUrl: 'cover://track/1?size=96' }),
      item({ title: 'https', coverUrl: 'https://example.com/a.jpg' }),
      item({ title: 'default', coverUrl: 'app://localhost/default-cover.jpg' }),
      item({ title: 'blob', coverUrl: 'blob:http://localhost/abc' }),
      item({ title: 'relative', coverUrl: '/img/a.png' }),
      item({ title: 'huge', coverUrl: `data:image/png;base64,${'a'.repeat(9000)}` }),
    ]);
    expect(rows.map(row => row.cover)).toEqual([
      'cover://track/1?size=96', 'https://example.com/a.jpg', 'app://localhost/default-cover.jpg', null, null, null,
    ]);
  });

  it('marks nested commands and clamps selection to the rows sent', () => {
    const command = { id: 'x', title: 'X', icon: 'tune', group: 'settings' as const, children: () => [] };
    const state = toNativePaletteState({
      open: true, darkMode: true, mode: 'commands', modes: ['library', 'commands'], query: 'q',
      trail: ['Language'], loading: false, selected: 9, items: [item({ title: 'X', command })], t,
    });
    expect(state.rows[0]!.nested).toBe(true);
    expect(state.selected).toBe(0);
    expect(state.modeIndex).toBe(1);
    expect(state.searchSymbol).toBe('bolt');
    expect(state.trail).toBe('Language ›');
  });

  it('sends no rows while closed', () => {
    const state = toNativePaletteState({
      open: false, darkMode: false, mode: 'library', modes: ['library', 'commands'], query: '',
      trail: [], loading: false, selected: 0, items: [item({})], t,
    });
    expect(state.rows).toEqual([]);
    expect(state.selected).toBe(-1);
  });

  it('replays forwarded Cmd chords as keydown events with a DOM code', () => {
    const target = new EventTarget();
    const events: KeyboardEvent[] = [];
    target.addEventListener('keydown', event => events.push(event as KeyboardEvent));
    dispatchForwardedShortcut('k', 1, target);
    dispatchForwardedShortcut('ArrowRight', 1 | 8, target);
    expect(events.map(event => [event.key, event.code, event.metaKey, event.shiftKey])).toEqual([
      ['k', 'KeyK', true, false],
      ['ArrowRight', 'ArrowRight', true, true],
    ]);
  });
});
