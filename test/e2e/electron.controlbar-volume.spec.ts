import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

const repo = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

test('macOS web volume panel supports hover, speaker mute, dragging and keyboard control', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'macOS controlbar fallback');
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'la-volume-panel-')));
  const isolatedHome = path.join(root, 'home');
  const userData = path.join(root, 'data');
  await mkdir(path.join(isolatedHome, '.la'), { recursive: true });
  await mkdir(userData);
  await writeFile(path.join(isolatedHome, '.la/settings.json'), JSON.stringify({ 'app-language': 'en' }));
  const env = Object.fromEntries(Object.entries({ ...process.env,
    HOME: isolatedHome, USERPROFILE: isolatedHome, APPDATA: path.join(root, 'appdata'),
    LOCALAPPDATA: path.join(root, 'local'), XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CACHE_HOME: path.join(root, 'cache'),
    NODE_ENV: 'test', LYRICS_ADAPTER_E2E_STATIC: '1', LYRICS_ADAPTER_DISABLE_NATIVE_GLASS: '1',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  delete env['ELECTRON_RUN_AS_NODE'];
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({ cwd: root, args: [`--user-data-dir=${userData}`, repo], env });
    const page = await app.firstWindow();
    const button = page.getByTestId('main-volume-button');
    const panel = page.locator('.macos-volume-slider-shell');
    await expect(page.getByTestId('main-controlbar')).toHaveCSS('background-color', /(?:\/ 0\.3|, 0\.3)\)$/);
    await expect(page.getByTestId('main-controlbar')).toHaveCSS('backdrop-filter', /blur\(24px\)/);
    await button.hover();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const slider = page.getByRole('slider', { name: 'Volume', exact: true });
    await expect(slider).not.toBeFocused();
    await expect(panel.getByRole('button')).toHaveCount(0);
    const initial = Number(await slider.inputValue());
    expect(initial).toBeGreaterThan(0);
    await slider.press('ArrowUp');
    await expect(slider).toHaveValue(String(initial + 0.01));
    await page.mouse.move(20, 100);
    await page.waitForTimeout(700);
    await expect(panel).toBeVisible();
    await slider.press('Home');
    await expect(slider).toHaveValue('0');
    await slider.press('End');
    await expect(slider).toHaveValue('1');
    const rect = (await slider.boundingBox())!;
    expect(rect.width).toBe(24);
    expect(rect.height).toBe(108);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height * 0.75);
    expect(Number(await slider.inputValue())).toBeLessThan(0.5);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width + 80, rect.y + rect.height * 0.25, { steps: 8 });
    await page.waitForTimeout(700);
    await expect(panel).toBeVisible();
    await page.mouse.up();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(Number(await slider.inputValue())).toBeGreaterThan(0.5);
    const beforeMute = await slider.inputValue();
    await button.click();
    await expect(slider).toHaveValue('0');
    await expect(button).toHaveAccessibleName('Unmute');
    await button.click();
    await expect(slider).toHaveValue(beforeMute);
    await expect(panel.locator('.macos-volume-value')).toHaveText(`${Math.round(Number(beforeMute) * 100)}%`);
    await page.mouse.move(20, 100);
    await expect(panel).not.toBeVisible();
    await button.hover();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('opacity', '1');
    await expect(panel).toHaveCSS('background-color', /(?:\/ 0\.3|, 0\.3)\)$/);
    await expect(panel).toHaveCSS('backdrop-filter', /blur\(24px\)/);
    await page.screenshot({ path: testInfo.outputPath('volume-panel.png') });
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
    await expect(panel).not.toBeVisible();
    // The unified appearance keeps retired day/night controls out of the palette.
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('Tab');
    await page.locator('.command-palette__input').fill('Night Mode');
    await expect(page.getByRole('option')).toHaveCount(0);
    await page.locator('.command-palette-backdrop').click({ position: { x: 5, y: 100 } });
    await expect(page.locator('.command-palette-backdrop')).toHaveCount(0);
    await button.hover();
    await expect(panel).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/theme-is-transitioning/);
    await expect(panel).toHaveCSS('opacity', '1');
    await page.mouse.click(20, 100);
    await expect(panel).not.toBeVisible();
    await button.hover();
    await button.click();
    await expect(panel).toBeVisible();
    await page.mouse.move(20, 100);
    await expect(panel).not.toBeVisible();
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
