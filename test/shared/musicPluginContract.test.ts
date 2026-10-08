import { describe, expect, it } from 'vitest';
import type * as Host from '../../src/shared/musicPlugin';
import type * as HostModel from '../../src/shared/onlineMusic';
import type * as Sdk from '../../music-source-plugins/src/sdk';

// The plugin repository keeps its own copy of the contract. These assignments fail
// `npm run typecheck:test` when the pinned submodule and the host drift apart.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const inSync: {
  plugin: Mutual<Host.MusicPlugin, Sdk.MusicPlugin>;
  host: Mutual<Host.MusicPluginHost, Sdk.PluginHost>;
  provider: Mutual<HostModel.OnlineMusicProvider, Sdk.OnlineMusicProvider>;
  song: Mutual<HostModel.OnlineSong, Sdk.OnlineSong>;
  url: Mutual<HostModel.OnlineUrlResult, Sdk.OnlineUrlResult>;
  lyrics: Mutual<HostModel.OnlineLyricsResult, Sdk.OnlineLyricsResult>;
  playlist: Mutual<HostModel.PlaylistInfo, Sdk.PlaylistInfo>;
} = { plugin: true, host: true, provider: true, song: true, url: true, lyrics: true, playlist: true };

describe('music plugin contract', () => {
  it('matches the SDK types of the pinned plugin repository', () => {
    expect(Object.values(inSync).every(Boolean)).toBe(true);
  });
});
