// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageMocks = vi.hoisted(() => {
  interface Representation {
    scaleFactor?: number;
    width?: number;
    height?: number;
    buffer?: Buffer;
  }

  const symbolWidths: Record<string, number> = {
    'backward.end.fill': 18,
    'play.fill': 13,
    'pause.fill': 12,
    'forward.end.fill': 18,
  };

  class MockNativeImage {
    readonly representations: Representation[] = [];
    template = false;

    constructor(
      readonly name: string,
      private width: number,
      private height: number,
      private empty = false,
    ) {}

    isEmpty(): boolean {
      return this.empty && this.representations.length === 0;
    }

    resize(): MockNativeImage {
      return new MockNativeImage(this.name, this.width, 14, this.empty);
    }

    getSize(): { width: number; height: number } {
      return { width: this.width, height: this.height };
    }

    toBitmap({ scaleFactor = 1 }: { scaleFactor?: number } = {}): Buffer {
      return Buffer.alloc(
        this.width * scaleFactor * this.height * scaleFactor * 4,
        0xff,
      );
    }

    addRepresentation(options: Representation): void {
      this.representations.push(options);
      const scaleFactor = options.scaleFactor ?? 1;
      this.width = (options.width ?? 0) / scaleFactor;
      this.height = (options.height ?? 0) / scaleFactor;
      this.empty = false;
    }

    setTemplateImage(template: boolean): void {
      this.template = template;
    }
  }

  return {
    MockNativeImage,
    createEmpty: vi.fn(() => new MockNativeImage('composite', 0, 0, true)),
    createFromNamedImage: vi.fn((name: string) => new MockNativeImage(
      name,
      symbolWidths[name] ?? 0,
      14,
      !(name in symbolWidths),
    )),
  };
});

vi.mock('electron', () => ({
  nativeImage: {
    createEmpty: imageMocks.createEmpty,
    createFromNamedImage: imageMocks.createFromNamedImage,
  },
}));

import {
  MENU_BAR_CONTROL_STRIP_WIDTH,
  createMenuBarControlImage,
} from '@/../electron/services/menuBarControlImage';

function byteAt(buffer: Buffer, width: number, x: number, y: number): number {
  return buffer[((y * width) + x) * 4] ?? 0;
}

describe('menuBarControlImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('composes previous, pause, and next SF Symbols into 1x and 2x template representations', () => {
    const image = createMenuBarControlImage(true, 355) as InstanceType<
      typeof imageMocks.MockNativeImage
    >;

    expect(image).toBeTruthy();
    expect(imageMocks.createFromNamedImage.mock.calls.map(([name]) => name)).toEqual([
      'backward.end.fill',
      'pause.fill',
      'forward.end.fill',
    ]);
    expect(image.representations).toHaveLength(2);
    expect(image.representations.map(({ scaleFactor, width, height }) => ({
      scaleFactor, width, height,
    }))).toEqual([
      { scaleFactor: 1, width: 355, height: 16 },
      { scaleFactor: 2, width: 710, height: 32 },
    ]);
    expect(image.template).toBe(true);

    const bitmap = image.representations[0]!.buffer!;
    expect(byteAt(bitmap, 355, 0, 0)).toBe(0);
    expect(byteAt(bitmap, 355, 128, 1)).toBe(0xff);
    expect(byteAt(bitmap, 355, 171, 1)).toBe(0xff);
    expect(byteAt(bitmap, 355, 208, 1)).toBe(0xff);

    const retinaBitmap = image.representations[1]!.buffer!;
    expect(byteAt(retinaBitmap, 710, 0, 0)).toBe(0);
    expect(byteAt(retinaBitmap, 710, 256, 2)).toBe(0xff);
    expect(byteAt(retinaBitmap, 710, 342, 2)).toBe(0xff);
    expect(byteAt(retinaBitmap, 710, 416, 2)).toBe(0xff);
  });

  it('uses the play symbol while paused', () => {
    expect(createMenuBarControlImage(false, 355)).toBeTruthy();
    expect(imageMocks.createFromNamedImage.mock.calls.map(([name]) => name)).toEqual([
      'backward.end.fill',
      'play.fill',
      'forward.end.fill',
    ]);
  });

  it('returns null when macOS cannot provide a required symbol', () => {
    imageMocks.createFromNamedImage.mockImplementationOnce(
      () => new imageMocks.MockNativeImage('missing', 0, 0, true),
    );

    expect(createMenuBarControlImage(true, 355)).toBeNull();
    expect(imageMocks.createEmpty).not.toHaveBeenCalled();
  });

  it('keeps the transparent canvas at least as wide as the compact hit strip', () => {
    const image = createMenuBarControlImage(true, 1) as InstanceType<
      typeof imageMocks.MockNativeImage
    >;

    expect(image.representations[0]).toEqual(expect.objectContaining({
      scaleFactor: 1,
      width: MENU_BAR_CONTROL_STRIP_WIDTH,
      height: 16,
    }));
  });
});
