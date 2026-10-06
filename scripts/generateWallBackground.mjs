import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

// One-time asset preparation, never part of app startup or rendering. Reuses
// the opaque, square app-icon crop already shipped as the default cover.
const source = await readFile(new URL('../public/default-cover.jpg', import.meta.url));
const destination = new URL('../public/wall-background.jpg', import.meta.url);
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to reuse an installed browser.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
try {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();

    // Soft colour fields need no Retina-sized source. 256² RGBA pixels occupy
    // 256 KiB before any browser-specific surface allocation.
    const size = 256;
    const blur = 24;
    const padding = blur * 3;
    const padded = document.createElement('canvas');
    padded.width = padded.height = size + padding * 2;
    const edges = padded.getContext('2d');
    const sourceSlices = [[0, 1], [0, image.width], [image.width - 1, 1]];
    const targetSlices = [[0, padding], [padding, size], [padding + size, padding]];
    // Extend edge pixels so the baked blur has no transparent/dark fringe.
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        edges.drawImage(image,
          sourceSlices[x][0], sourceSlices[y][0], sourceSlices[x][1], sourceSlices[y][1],
          targetSlices[x][0], targetSlices[y][0], targetSlices[x][1], targetSlices[y][1]);
      }
    }
    const output = document.createElement('canvas');
    output.width = output.height = size;
    const context = output.getContext('2d', { alpha: false });
    context.filter = `blur(${blur}px)`;
    context.drawImage(padded, -padding, -padding);
    return output.toDataURL('image/jpeg', 0.9);
  }, `data:image/jpeg;base64,${source.toString('base64')}`);
  const bitmap = Buffer.from(dataUrl.split(',')[1], 'base64');
  await writeFile(destination, bitmap);
  console.log(`Generated public/wall-background.jpg (256 × 256, ${bitmap.length} bytes)`);
} finally {
  await browser.close();
}
