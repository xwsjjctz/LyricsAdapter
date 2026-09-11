import type { DomLyricPlayer } from '@applemusic-like-lyrics/core';

type LyricGroup = DomLyricPlayer['currentLyricGroups'][number];
type LyricLine = LyricGroup['mainLine'];

const PREPARE_AHEAD_MS = 600;
const ANIMATION_CHECK_INTERVAL_MS = 120;
const STATIC_ATTRIBUTE = 'data-focus-amll-static';

interface LineState {
  content: Element | null;
  lastCheck: number;
  suspended: boolean;
}

/**
 * Adapter for AMLL 0.5.2's DOM renderer. Keep its line layout and animation
 * objects: enable() already seeks/restarts those objects at the media time.
 * cancel() releases their browser effects while a settled line is inactive.
 * No private AMLL fields, extra frame loop, or React updates are required.
 */
export class FocusAmlAnimationBudget {
  private states = new WeakMap<HTMLElement, LineState>();

  update(groups: readonly LyricGroup[], currentTime: number, now = performance.now()): void {
    for (const group of groups) {
      this.updateLine(group.mainLine, group.isActive, currentTime, now);
      if (group.bgLine) this.updateLine(group.bgLine, group.isActive, currentTime, now);
    }
  }

  private updateLine(line: LyricLine, active: boolean, currentTime: number, now: number): void {
    const element = line.getElement();
    if (!element.isConnected) {
      // The core keeps line shells for the song after tearing down their words.
      // Do not let our cached content identity retain a detached word subtree.
      this.states.delete(element);
      element.removeAttribute(STATIC_ATTRIBUTE);
      return;
    }
    const main = element.firstElementChild;
    if (!main || typeof main.getAnimations !== 'function') return;

    const content = main.firstElementChild;
    // Ordinary LRC lines contain text nodes and optional balancing <br>s, not
    // masked words. Treating a <br> as word content adds a second alpha fade
    // (on top of the group's opacity) whenever wrapping changes the DOM.
    if (!content || content.tagName === 'BR') {
      this.states.delete(element);
      element.removeAttribute(STATIC_ATTRIBUTE);
      return;
    }
    let state = this.states.get(element);
    if (!state || state.content !== content) {
      // AMLL tears down and rebuilds word DOM when it leaves/re-enters overscan.
      element.removeAttribute(STATIC_ATTRIBUTE);
      state = { content, lastCheck: -Infinity, suspended: false };
      this.states.set(element, state);
    }

    const bright = Number.parseFloat(element.style.getPropertyValue('--bright-mask-alpha'));
    const dark = Number.parseFloat(element.style.getPropertyValue('--dark-mask-alpha'));
    const untilStart = line.getLine().startTime - currentTime;
    const preparing = untilStart >= 0 && untilStart <= PREPARE_AHEAD_MS;
    const uniform = Number.isFinite(bright) && bright === dark;

    if (active || preparing || !uniform) {
      if (state.suspended) {
        element.removeAttribute(STATIC_ATTRIBUTE);
        state.suspended = false;
        // A seek/resize may have happened while effects were cancelled. Let AMLL
        // regenerate masks and synchronize enabled words to its current clock.
        line.updateMaskImageSync();
      }
      return;
    }

    if (!content || now - state.lastCheck < ANIMATION_CHECK_INTERVAL_MS) return;
    state.lastCheck = now;
    const animations = main.getAnimations({ subtree: true });
    // Preserve the outgoing float/glow and opacity tails, including pending
    // animations. Uniform mask alpha alone does not mean the motion has ended.
    if (animations.some(animation => animation.pending || animation.playState === 'running')) return;

    for (const animation of animations) {
      if (animation.id === 'float-word'
        || animation.id.startsWith('emphasize-word-')
        || animation.id.startsWith('fade-word-')) {
        animation.cancel();
      }
    }
    // At rest AMLL's float returns to its neutral pose; do not commit transforms
    // into inline styles, which would double additive transforms on reactivation.
    element.setAttribute(STATIC_ATTRIBUTE, '');
    state.suspended = true;
  }
}
