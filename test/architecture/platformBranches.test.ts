import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Browser mode is supported, but the desktop/browser difference belongs to the
// adapter layer (services and repositories). Application layers ask for a
// capability through the adapter instead of branching on the platform.
const root = path.resolve(__dirname, '../..');
const APPLICATION_LAYERS = ['src/hooks', 'src/controllers', 'src/viewmodels', 'src/components', 'src/commands'];

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir)).flatMap(name => {
    const relative = path.join(dir, name);
    if (statSync(path.join(root, relative)).isDirectory()) return sourceFiles(relative);
    return /\.tsx?$/.test(relative) ? [relative] : [];
  });
}

describe('platform branches', () => {
  it('keeps isDesktop() out of application layers', () => {
    const offenders = APPLICATION_LAYERS.flatMap(sourceFiles)
      .filter(file => /\bisDesktop\s*\(/.test(readFileSync(path.join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
