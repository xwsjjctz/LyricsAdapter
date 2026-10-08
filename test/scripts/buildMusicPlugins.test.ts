// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const buildScript = fileURLToPath(new URL('../../scripts/buildMusicPlugins.mjs', import.meta.url));
// These fixtures use local Git repositories and never contact a network remote.
const env = { ...process.env, GIT_ALLOW_PROTOCOL: 'file' };
let temporaryRoot: string;
let source: string;
let pinnedCommit: string;
let fixtureIndex = 0;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Git fixture failed');
  return result.stdout.trim();
}

function createProject(): string {
  const root = path.join(temporaryRoot, `project-${fixtureIndex++}`);
  mkdirSync(path.join(root, 'scripts'), { recursive: true });
  copyFileSync(buildScript, path.join(root, 'scripts/buildMusicPlugins.mjs'));
  git(root, 'init', '-q');
  git(root, 'submodule', 'add', '-q', source, 'music-source-plugins');
  git(path.join(root, 'music-source-plugins'), 'checkout', '-q', pinnedCommit);
  git(root, 'add', 'music-source-plugins');
  return root;
}

function removeSubmodule(root: string): void {
  git(root, 'submodule', 'deinit', '-f', '--', 'music-source-plugins');
  rmSync(path.join(root, '.git/modules/music-source-plugins'), { recursive: true, force: true });
}

function run(root: string) {
  // Invoke from elsewhere to verify the script resolves paths from its own file.
  return spawnSync(process.execPath, [path.join(root, 'scripts/buildMusicPlugins.mjs')], {
    cwd: temporaryRoot, env, encoding: 'utf8',
  });
}

beforeAll(() => {
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'lyrics-music-plugin-build-'));
  source = path.join(temporaryRoot, 'plugin-source');
  mkdirSync(path.join(source, 'scripts'), { recursive: true });
  writeFileSync(path.join(source, 'scripts/build.mjs'), `
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
mkdirSync(process.argv[2], { recursive: true });
writeFileSync(path.join(process.argv[2], 'version.txt'), readFileSync(path.join(root, 'version.txt')));
`);
  writeFileSync(path.join(source, 'version.txt'), 'pinned');
  git(source, 'init', '-q');
  git(source, '-c', 'user.name=Plugin Build Test', '-c', 'user.email=test@example.invalid', 'add', '.');
  git(source, '-c', 'user.name=Plugin Build Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Pinned fixture');
  pinnedCommit = git(source, 'rev-parse', 'HEAD');
  writeFileSync(path.join(source, 'version.txt'), 'remote-latest');
  git(source, 'add', '.');
  git(source, '-c', 'user.name=Plugin Build Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Newer fixture');
});

afterAll(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('music plugin build preparation', () => {
  it('initializes a missing submodule at the pinned commit and builds it', () => {
    const root = createProject();
    removeSubmodule(root);

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(git(path.join(root, 'music-source-plugins'), 'rev-parse', 'HEAD')).toBe(pinnedCommit);
    expect(readFileSync(path.join(root, 'dist-music-plugins/version.txt'), 'utf8')).toBe('pinned');
  });

  it('preserves local plugin edits when the build entry already exists', () => {
    const root = createProject();
    writeFileSync(path.join(root, 'music-source-plugins/version.txt'), 'local-edits');

    const result = run(root);

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(path.join(root, 'dist-music-plugins/version.txt'), 'utf8')).toBe('local-edits');
    expect(readFileSync(path.join(root, 'music-source-plugins/version.txt'), 'utf8')).toBe('local-edits');
  });

  it('reports an actionable error when the submodule cannot be restored', () => {
    const root = createProject();
    removeSubmodule(root);
    git(root, 'config', '-f', '.gitmodules', 'submodule.music-source-plugins.url', path.join(temporaryRoot, 'missing-remote'));

    const result = run(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('git submodule update --init --recursive -- music-source-plugins');
    expect(result.stderr).not.toContain('MODULE_NOT_FOUND');
    expect(existsSync(path.join(root, 'dist-music-plugins'))).toBe(false);
  });

  it('propagates build failures so Electron cannot start with stale plugin output', () => {
    const root = createProject();
    writeFileSync(path.join(root, 'music-source-plugins/scripts/build.mjs'), 'process.exit(17);');

    expect(run(root).status).toBe(17);
  });
});
