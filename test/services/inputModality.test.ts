import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installInputModality, lastInputWasKeyboard } from '@/services/inputModality';

describe('inputModality', () => {
  let uninstall: () => void;
  beforeEach(() => { uninstall = installInputModality(); });
  afterEach(() => uninstall());

  const press = (key: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  const point = () => document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));

  it('starts as keyboard so focus stays visible until a pointer is used', () => {
    expect(lastInputWasKeyboard()).toBe(true);
    expect(document.documentElement.dataset['inputModality']).toBe('keyboard');
  });

  it('switches to pointer on pointerdown and back to keyboard on navigation keys', () => {
    point();
    expect(lastInputWasKeyboard()).toBe(false);
    expect(document.documentElement.dataset['inputModality']).toBe('pointer');

    press('Tab');
    expect(lastInputWasKeyboard()).toBe(true);
    expect(document.documentElement.dataset['inputModality']).toBe('keyboard');
  });

  it('ignores bare modifiers and app shortcuts so a pointer session keeps rings hidden', () => {
    point();
    press('Meta');
    press('k', { metaKey: true });
    press('Shift');
    expect(lastInputWasKeyboard()).toBe(false);
  });
});
