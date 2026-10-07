// The HTML screen is already visible while storage and UI modules initialize.
const shownAt = performance.now();
const MIN_VISIBLE_MS = 350;
const REVEAL_FALLBACK_MS = 800;

export function dismissStartupScreen(): void {
  document.getElementById('app-startup')?.remove();
  const root = document.getElementById('root');
  root?.removeAttribute('inert');
  root?.removeAttribute('aria-hidden');
  document.documentElement.dataset['startup'] = 'ready';
}

/** Called only after local restoration has settled and React committed it. */
export function revealStartupScreen(): () => void {
  let screen = document.getElementById('app-startup');
  if (!screen) return () => {};
  let cancelled = false;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    cancelled = true;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    screen?.removeEventListener('animationend', onEnd);
    screen = null;
  };
  const finish = () => { cleanup(); dismissStartupScreen(); };
  const onEnd = (event: AnimationEvent) => {
    if (event.target === screen && event.animationName === 'startup-reveal') finish();
  };
  screen.addEventListener('animationend', onEnd);

  // Decode the bundled artwork and settle fonts/layout before revealing the
  // restored screen. Failed assets still release the screen using its gradient.
  const assets = Array.from(screen.querySelectorAll('img'), image => image.decode());
  if (document.fonts) assets.push(document.fonts.ready.then(() => undefined));
  void Promise.allSettled(assets).then(() => {
    if (cancelled) return;
    timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (cancelled || !screen?.isConnected) return;
          document.documentElement.dataset['startup'] = 'revealing';
          screen.classList.add('app-startup--revealing');
          // Release even if animationend is lost while minimized or CSS fails.
          timer = setTimeout(finish, REVEAL_FALLBACK_MS);
        });
      });
    }, Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt)));
  });
  return cleanup;
}
