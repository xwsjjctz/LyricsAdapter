import { comparePluginVersions as compareVersions, isPluginVersion as isVersion } from '../../src/shared/pluginUpdate';

const REPOSITORY = 'xwsjjctz/LyricsAdapter';

interface GitHubRelease {
  tag_name?: unknown;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ({ name?: string; state?: string } | null)[];
}

export function allowsPrereleaseUpdates(version: string): boolean {
  return version.startsWith('0.') || version.includes('-');
}

/** Find a published installer even when the release has no updater metadata. */
export async function findMacInstaller(currentVersion: string, arch: string) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub Releases returned HTTP ${response.status}`);
  const releases: unknown = await response.json();
  if (!Array.isArray(releases)) throw new Error('Invalid GitHub Releases response');

  const allowPrerelease = allowsPrereleaseUpdates(currentVersion);
  let latest: { version: string; url: string } | undefined;
  for (const release of releases as (GitHubRelease | null)[]) {
    if (!release || release.draft !== false || !Array.isArray(release.assets)) continue;
    const tag = release.tag_name;
    if (typeof tag !== 'string') continue;
    const version = tag.replace(/^v/, '');
    if (!isVersion(version) || (!allowPrerelease && (release.prerelease || version.split('+', 1)[0]!.includes('-')))) continue;
    if (compareVersions(version, latest?.version ?? currentVersion) <= 0) continue;

    const assetName = `LyricsAdapter-${version}-mac-${arch}.dmg`;
    if (!release.assets.some(asset => asset?.name === assetName && asset.state === 'uploaded')) continue;

    latest = { version, url: `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(tag)}#assets` };
  }
  return latest;
}
