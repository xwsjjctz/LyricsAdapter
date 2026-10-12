// @vitest-environment node
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const beforePack = require('../../scripts/checkMacRelease.cjs');
const { verifyReleaseArtifacts } = require('../../scripts/verifyReleaseArtifacts.cjs');
const { version } = require('../../package.json');
const credentials = { CSC_LINK: 'certificate', CSC_KEY_PASSWORD: 'password', APPLE_ID: 'developer@example.test',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-password', APPLE_TEAM_ID: 'TEAM123456' };
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

describe('macOS release prerequisites', () => {
  it('rejects missing notarization credentials without exposing configured secrets', () => {
    expect(() => beforePack.checkMacReleaseCredentials({ ...credentials, APPLE_TEAM_ID: '' }))
      .toThrow('APPLE_TEAM_ID');
    expect(() => beforePack.checkMacReleaseCredentials(credentials)).not.toThrow();
  });

  it('permits a local directory build but prevents disabling signing for a distributable', () => {
    const context = { electronPlatformName: 'darwin', targets: [], packager: {
      platformSpecificBuildOptions: { forceCodeSigning: false, notarize: false },
    } };
    expect(() => beforePack(context)).not.toThrow();
    expect(() => beforePack({ ...context, targets: [{ name: 'dmg' }] })).toThrow('requires forceCodeSigning');
    vi.stubEnv('LYRICSADAPTER_UNSIGNED_MAC', '1');
    expect(() => beforePack({ ...context, targets: [{ name: 'dmg' }] })).not.toThrow();
    vi.unstubAllEnvs();
    expect(() => beforePack({ electronPlatformName: 'win32' })).not.toThrow();
  });

  function artifacts(extensions = ['dmg', 'zip']) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'la-release-'));
    roots.push(directory);
    const files = extensions.map(extension => {
      const name = `LyricsAdapter-${version}-mac-arm64.${extension}`;
      const bytes = Buffer.from(`fixture ${extension}`);
      fs.writeFileSync(path.join(directory, name), bytes);
      return { url: name, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length };
    });
    // JSON is valid YAML and avoids executing a packager or using signing credentials in unit tests.
    fs.writeFileSync(path.join(directory, 'latest-mac.yml'), JSON.stringify({ version, files }));
    return { directory, files };
  }

  it('requires the ZIP as well as the installer in the update metadata', () => {
    expect(() => verifyReleaseArtifacts(artifacts().directory, 'mac')).not.toThrow();
    expect(() => verifyReleaseArtifacts(artifacts(['dmg']).directory, 'mac')).toThrow('missing .zip');
  });

  it('requires the Windows installer blockmap used by differential updates', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'la-release-'));
    roots.push(directory);
    const name = `LyricsAdapter-Setup-${version}.exe`;
    const bytes = Buffer.from('fixture exe');
    fs.writeFileSync(path.join(directory, name), bytes);
    const files = [{ url: name, sha512: createHash('sha512').update(bytes).digest('base64'), size: bytes.length }];
    fs.writeFileSync(path.join(directory, 'latest.yml'), JSON.stringify({ version, files }));
    expect(() => verifyReleaseArtifacts(directory, 'win')).toThrow('.exe.blockmap');
    fs.writeFileSync(path.join(directory, `${name}.blockmap`), 'blockmap');
    expect(() => verifyReleaseArtifacts(directory, 'win')).not.toThrow();
  });

  it('rejects modified artifacts and missing metadata before upload', () => {
    const { directory, files } = artifacts();
    fs.appendFileSync(path.join(directory, files[0]!.url), 'changed');
    expect(() => verifyReleaseArtifacts(directory, 'mac')).toThrow('checksum or size mismatch');
    fs.unlinkSync(path.join(directory, 'latest-mac.yml'));
    expect(() => verifyReleaseArtifacts(directory, 'mac')).toThrow();
  });
});
