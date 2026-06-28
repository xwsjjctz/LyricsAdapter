import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('App shell', () => {
  it('keeps App.tsx as a thin composition entrypoint', () => {
    const appPath = path.resolve(process.cwd(), 'App.tsx');
    const lineCount = fs.readFileSync(appPath, 'utf-8').trim().split('\n').length;

    expect(lineCount).toBeLessThanOrEqual(200);
  });
});
