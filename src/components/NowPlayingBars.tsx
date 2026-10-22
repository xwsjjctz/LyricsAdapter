/** Bars over the current song's cover in the list, moving while it plays and resting when paused. */
export default function NowPlayingBars({ animated }: { animated: boolean }) {
  return (
    <span className={`now-playing-bars${animated ? ' now-playing-bars--animated' : ''}`} aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}
