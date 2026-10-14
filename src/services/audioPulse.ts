/**
 * Read-only spectrum tap on the player's <audio> element, for visuals that
 * move with the music.
 *
 * The tap uses `captureStream()`, so playback output never passes through
 * Web Audio: a suspended context or a source the tap cannot read (a WebDAV
 * CDN without CORS) only leaves the visuals calm, never the speakers silent.
 *
 * The playback owner attaches the element; visuals retain the tap while they
 * are shown and sample it once per animation frame.
 */
import { logger } from './logger';

/** Mean band energies of the current frame, each in [0, 1]. */
export interface AudioPulseBands {
  bass: number;
  high: number;
  overall: number;
}

const FFT_SIZE = 2048;
const SMOOTHING = 0.55;
const BASS_HZ: readonly [number, number] = [40, 160];
const HIGH_HZ: readonly [number, number] = [2500, 9000];
const OVERALL_HZ: readonly [number, number] = [40, 9000];

interface CapturableMedia extends HTMLMediaElement {
  captureStream?: () => MediaStream;
}

interface Tap {
  context: AudioContext;
  analyser: AnalyserNode;
  bins: Uint8Array<ArrayBuffer>;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  sourceTrackId: string | null;
}

let element: CapturableMedia | null = null;
let tap: Tap | null = null;
let retainers = 0;

/** Media sources served by the app's own protocols can be analysed in CORS mode. */
export function isAnalysableAudioUrl(url: string): boolean {
  return url.startsWith('audio://') || url.startsWith('stream://');
}

function createTap(): Tap {
  const context = new AudioContext({ latencyHint: 'playback' });
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = SMOOTHING;
  // A muted sink keeps the analyser in the rendered graph without adding output.
  const sink = context.createGain();
  sink.gain.value = 0;
  analyser.connect(sink);
  sink.connect(context.destination);
  return { context, analyser, bins: new Uint8Array(analyser.frequencyBinCount), stream: null, source: null, sourceTrackId: null };
}

function disconnectSource(current: Tap): void {
  current.source?.disconnect();
  current.source = null;
  current.sourceTrackId = null;
}

/** Follow the captured stream's live audio track; it changes with each source. */
function connectLatestTrack(current: Tap): void {
  const track = current.stream?.getAudioTracks().filter(t => t.readyState === 'live').at(-1);
  if (!track) {
    disconnectSource(current);
    return;
  }
  if (track.id === current.sourceTrackId) return;
  disconnectSource(current);
  try {
    current.source = current.context.createMediaStreamSource(new MediaStream([track]));
    current.source.connect(current.analyser);
    current.sourceTrackId = track.id;
  } catch (error) {
    logger.debug('[AudioPulse] cannot read the captured track:', error);
  }
}

const handleStreamTracksChanged = () => {
  if (tap) connectLatestTrack(tap);
};

function releaseStream(current: Tap): void {
  if (current.stream) {
    current.stream.removeEventListener('addtrack', handleStreamTracksChanged);
    current.stream.removeEventListener('removetrack', handleStreamTracksChanged);
    // Stopping captured tracks frees the capture; the element keeps playing.
    for (const track of current.stream.getTracks()) track.stop();
  }
  current.stream = null;
  disconnectSource(current);
}

/** Capture lazily: a cross-origin source refuses capture until a readable one loads. */
function ensureStream(current: Tap): void {
  if (current.stream || !element?.captureStream) return;
  try {
    current.stream = element.captureStream();
  } catch (error) {
    logger.debug('[AudioPulse] capture unavailable for this source:', error);
    return;
  }
  current.stream.addEventListener('addtrack', handleStreamTracksChanged);
  current.stream.addEventListener('removetrack', handleStreamTracksChanged);
  connectLatestTrack(current);
}

const handleMediaPlaying = () => {
  if (!tap) return;
  if (tap.context.state === 'suspended') void tap.context.resume().catch(() => undefined);
  ensureStream(tap);
  connectLatestTrack(tap);
};

/** Called by the playback owner whenever its media element mounts or unmounts. */
export function attachAudioPulse(next: HTMLAudioElement | null): void {
  if (next === element) return;
  element?.removeEventListener('playing', handleMediaPlaying);
  element?.removeEventListener('loadedmetadata', handleMediaPlaying);
  if (tap) releaseStream(tap);
  element = next;
  element?.addEventListener('playing', handleMediaPlaying);
  element?.addEventListener('loadedmetadata', handleMediaPlaying);
  if (tap && element) handleMediaPlaying();
}

/** Keep the tap running while a visual needs it; call the returned function to let go. */
export function retainAudioPulse(): () => void {
  retainers += 1;
  if (!tap) {
    try {
      tap = createTap();
    } catch (error) {
      logger.warn('[AudioPulse] Web Audio unavailable:', error);
    }
  }
  if (tap && element) handleMediaPlaying();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    retainers -= 1;
    if (retainers > 0 || !tap) return;
    const closing = tap;
    tap = null;
    releaseStream(closing);
    void closing.context.close().catch(() => undefined);
  };
}

function bandMean(bins: Uint8Array, binHz: number, [low, high]: readonly [number, number]): number {
  const start = Math.max(1, Math.floor(low / binHz));
  const end = Math.min(bins.length - 1, Math.ceil(high / binHz));
  let sum = 0;
  for (let i = start; i <= end; i += 1) sum += bins[i]!;
  return end >= start ? sum / ((end - start + 1) * 255) : 0;
}

/** This frame's band energies, or null while nothing readable is playing. */
export function sampleAudioPulse(): AudioPulseBands | null {
  if (!tap?.source || tap.context.state !== 'running') return null;
  tap.analyser.getByteFrequencyData(tap.bins);
  const binHz = tap.context.sampleRate / FFT_SIZE;
  return {
    bass: bandMean(tap.bins, binHz, BASS_HZ),
    high: bandMean(tap.bins, binHz, HIGH_HZ),
    overall: bandMean(tap.bins, binHz, OVERALL_HZ),
  };
}
