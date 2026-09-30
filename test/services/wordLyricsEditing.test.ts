import { describe, expect, it } from 'vitest';
import {
  applyEditedWordLyrics,
  editableWordLyricsText,
} from '@/shared/wordLyricsEditing';

const QRC_XML = '<?xml version="1.0" encoding="utf-8"?>\n'
  + '<QrcInfos>\n<QrcHeadInfo SaveTime="1" Version="100"/>\n<LyricInfo LyricCount="1">\n'
  + '<Lyric_1 LyricType="1" LyricContent="[ti:Hero]\n'
  + '[1000,700]我(1000,300)们(1300,400)\n'
  + '[2000,500]that&apos;s(2000,500)\n'
  + '"/>\n</LyricInfo>\n</QrcInfos>';

describe('editableWordLyricsText', () => {
  it('shows the decoded QRC lyric body instead of the XML envelope', () => {
    expect(editableWordLyricsText(QRC_XML, 'qrc')).toBe(
      "[ti:Hero]\n[1000,700]我(1000,300)们(1300,400)\n[2000,500]that's(2000,500)\n",
    );
  });

  it('edits YRC text as-is', () => {
    const yrc = '[1000,900](1000,300,0)你(1300,600,0)好';
    expect(editableWordLyricsText(yrc, 'yrc')).toBe(yrc);
  });
});

describe('applyEditedWordLyrics', () => {
  it('writes edited QRC back into the original envelope and reparses word timing', () => {
    const edited = '[1000,700]你(1000,300)们(1300,400)\n[2000,500]"quoted" & <tag>(2000,500)\n';
    const result = applyEditedWordLyrics(edited, 'qrc', QRC_XML);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wordLyrics.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<QrcInfos>')).toBe(true);
    expect(result.wordLyrics).toContain('<QrcHeadInfo SaveTime="1" Version="100"/>');
    expect(result.wordLyrics).toContain('&quot;quoted&quot; &amp; &lt;tag&gt;');
    expect(editableWordLyricsText(result.wordLyrics, 'qrc')).toBe(edited);
    expect(result.lyrics).toBe('你们\n"quoted" & <tag>');
    expect(result.syncedLyrics[0]).toEqual({
      time: 1,
      text: '你们',
      words: [
        { time: 1, duration: 0.3, text: '你' },
        { time: 1.3, duration: 0.4, text: '们' },
      ],
    });
  });

  it('keeps dollar signs literal when replacing QRC content', () => {
    const result = applyEditedWordLyrics("[1000,500]$&$'(1000,500)", 'qrc', QRC_XML);
    expect(result.ok && editableWordLyricsText(result.wordLyrics, 'qrc')).toBe("[1000,500]$&$'(1000,500)");
  });

  it('wraps QRC text in a minimal envelope when no original payload exists', () => {
    const result = applyEditedWordLyrics('[1000,500]嗨(1000,500)', 'qrc');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wordLyrics).toContain('<QrcInfos>');
    expect(result.syncedLyrics[0]?.text).toBe('嗨');
  });

  it('stores edited YRC unchanged', () => {
    const yrc = '{"t":0,"c":[{"tx":"作词: "}]}\n[1000,900](1000,300,0)你(1300,600,0)好';
    const result = applyEditedWordLyrics(yrc, 'yrc');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wordLyrics).toBe(yrc);
    expect(result.syncedLyrics.some(line => line.text === '你好')).toBe(true);
  });

  it('rejects text that no longer carries word timing', () => {
    expect(applyEditedWordLyrics('只是纯文本', 'qrc', QRC_XML)).toEqual({ ok: false });
    expect(applyEditedWordLyrics('[00:01.00]逐行 LRC', 'yrc')).toEqual({ ok: false });
  });
});
