import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DomLyricPlayer } from '@applemusic-like-lyrics/core';
import { FocusAmlAnimationBudget } from '@/components/focus-mode/focusAmlAnimationBudget';

type Group = DomLyricPlayer['currentLyricGroups'][number];

function fixture() {
  const element = document.createElement('div');
  element.innerHTML = '<div class="test_lyricMainLine"><span>Keep these words</span></div>';
  element.style.setProperty('--bright-mask-alpha', '0.2');
  element.style.setProperty('--dark-mask-alpha', '0.2');
  document.body.append(element);
  const animation = {
    id: 'float-word', pending: false, playState: 'paused',
    cancel: vi.fn(),
  };
  const mask = { ...animation, id: 'fade-word-test-0', cancel: vi.fn() };
  const getAnimations = vi.fn(() => [animation, mask]);
  Object.defineProperty(element.firstElementChild, 'getAnimations', { value: getAnimations });
  const updateMaskImageSync = vi.fn();
  const line = {
    getElement: () => element,
    getLine: () => ({ startTime: 10_000 }),
    updateMaskImageSync,
  };
  const group = { mainLine: line, isActive: false } as unknown as Group;
  return { element, group, animation, mask, getAnimations, updateMaskImageSync };
}

afterEach(() => { document.body.replaceChildren(); });

describe('AMLL inactive animation budget', () => {
  it('never applies the word fade to ordinary lyrics as wrapping comes and goes', () => {
    const f = fixture();
    const main = f.element.firstElementChild!;
    const budget = new FocusAmlAnimationBudget();
    for (const html of ['Ordinary lyrics', 'Ordinary<br>wrapped lyrics', 'Ordinary lyrics']) {
      main.innerHTML = html;
      budget.update([f.group], 0, 200);
      expect(f.element).not.toHaveAttribute('data-focus-amll-static');
    }
    expect(f.getAnimations).not.toHaveBeenCalled();
  });

  it('cancels inactive word effects without changing glyph DOM or inline transforms', () => {
    const f = fixture();
    const word = f.element.querySelector('span')!;
    const budget = new FocusAmlAnimationBudget();
    budget.update([f.group], 0, 0);
    expect(f.animation.cancel).toHaveBeenCalledOnce();
    expect(f.mask.cancel).toHaveBeenCalledOnce();
    expect(f.element).toHaveAttribute('data-focus-amll-static');
    expect(f.element.querySelector('span')).toBe(word);
    expect(word.style.transform).toBe('');
    // No native animation scans on every frame once a row is settled.
    budget.update([f.group], 0, 16);
    expect(f.getAnimations).toHaveBeenCalledOnce();
  });

  it.each(['active', 'preparing', 'nonuniform', 'running', 'pending'])('preserves %s lines and motion tails', (condition) => {
    const f = fixture();
    if (condition === 'active') f.group.isActive = true;
    if (condition === 'nonuniform') f.element.style.setProperty('--bright-mask-alpha', '0.8');
    if (condition === 'running') f.animation.playState = 'running';
    if (condition === 'pending') f.animation.pending = true;
    new FocusAmlAnimationBudget().update([f.group], condition === 'preparing' ? 9_500 : 0, 0);
    expect(f.animation.cancel).not.toHaveBeenCalled();
    expect(f.mask.cancel).not.toHaveBeenCalled();
    expect(f.element).not.toHaveAttribute('data-focus-amll-static');
  });

  it('restores AMLL mask/clock synchronization before painting a reactivated row', () => {
    const f = fixture();
    const budget = new FocusAmlAnimationBudget();
    budget.update([f.group], 0, 0);
    f.group.isActive = true;
    budget.update([f.group], 10_250, 16);
    expect(f.element).not.toHaveAttribute('data-focus-amll-static');
    expect(f.updateMaskImageSync).toHaveBeenCalledOnce();
    budget.update([f.group], 10_266, 32);
    expect(f.updateMaskImageSync).toHaveBeenCalledOnce();
  });

  it('prepares an upcoming row even inside the animation-scan interval', () => {
    const f = fixture();
    const budget = new FocusAmlAnimationBudget();
    budget.update([f.group], 9_350, 0);
    budget.update([f.group], 9_450, 16);
    expect(f.element).not.toHaveAttribute('data-focus-amll-static');
    expect(f.updateMaskImageSync).toHaveBeenCalledOnce();
  });

  it('handles recreated word content and mask animations after scrolling or resizing', () => {
    const f = fixture();
    const budget = new FocusAmlAnimationBudget();
    budget.update([f.group], 0, 0);
    f.element.firstElementChild!.innerHTML = '<span>Rebuilt words</span>';
    f.group.isActive = true;
    budget.update([f.group], 10_000, 16);
    expect(f.element).not.toHaveAttribute('data-focus-amll-static');
    f.group.isActive = false;
    budget.update([f.group], 0, 32);
    expect(f.mask.cancel).toHaveBeenCalledTimes(2);
    // A resize can replace only masks, leaving the word DOM intact.
    budget.update([f.group], 0, 200);
    expect(f.mask.cancel).toHaveBeenCalledTimes(3);
  });

  it('drops suspended state when the core detaches a line shell', () => {
    const f = fixture();
    const budget = new FocusAmlAnimationBudget();
    budget.update([f.group], 0, 0);
    f.element.remove();
    budget.update([f.group], 0, 16);
    expect(f.element).not.toHaveAttribute('data-focus-amll-static');
    document.body.append(f.element);
    budget.update([f.group], 0, 32);
    expect(f.mask.cancel).toHaveBeenCalledTimes(2);
  });

  it('preserves active duet/background groups and skips detached lyric DOM', () => {
    const f = fixture();
    const bg = fixture();
    f.group.bgLine = bg.group.mainLine;
    f.group.isActive = true;
    new FocusAmlAnimationBudget().update([f.group], 0, 0);
    expect(bg.mask.cancel).not.toHaveBeenCalled();
    f.element.remove();
    f.group.isActive = false;
    new FocusAmlAnimationBudget().update([f.group], 0, 0);
    expect(f.getAnimations).not.toHaveBeenCalled();
    expect(bg.mask.cancel).toHaveBeenCalledOnce();
  });
});
