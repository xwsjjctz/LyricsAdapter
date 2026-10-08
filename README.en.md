<div align="center">

<img src="app-icon.png" width="120" height="120" alt="LyricsAdapter logo">

# LyricsAdapter

**A desktop player built around local music and synchronized lyrics.**

Listen to your own collection, connect a WebDAV library, or add QQ Music and NetEase Cloud Music.

[Download](https://github.com/xwsjjctz/LyricsAdapter/releases) · [简体中文](README.md)

</div>

## Get started

Download the installer for your device from [Releases](https://github.com/xwsjjctz/LyricsAdapter/releases). The current release configuration provides a `.dmg` for Apple Silicon Macs and an `.exe` installer for Windows x64.

1. Open the app and select **Local** in the sidebar.
2. Use the import button at the top right of the library to select **MP3 or FLAC** files, or drag multiple audio files into the library area.
3. Click a track to play it, then use **Focus Mode** in the bottom controls to view synchronized lyrics.

Local playback requires no login. Importing reads the title, artist, album, artwork, and embedded lyrics from your files.

## Library and playback

### Playback controls

The bottom bar provides play/pause, previous/next track, seeking, volume, and mute controls. Sequential playback, shuffle, and repeat-one modes are available.

The app remembers your library, current track, playback position, volume, and other state, and restores playback paused when reopened. You can browse another library or open a playlist while the current song continues playing.

### Find music

The search box at the top of the library searches both local tracks and loaded cloud tracks. It matches titles, artists, albums, and filenames, including Chinese pinyin. With third-party sources enabled, it also shows online songs.

Click a local or cloud result to locate and play it. Use the arrow keys to select a result, `Enter` to confirm, and `Esc` to dismiss search. The locate-current-track button takes you back to the song playing in the list.

### Organize your local library

Turn on **Edit Mode** at the top of the library to:

- Drag tracks to change their order.
- Select several tracks, or select all, for bulk removal.
- Remove an individual track using its delete button.
- Open a track's metadata editor to change its title, artist, album, or lyrics, or import new artwork.

Saving metadata for a local track writes the changes back to its audio file. Removal only removes the library entry by default; the original file is deleted only if you select the option to delete the local audio file as well.

## Lyrics and Focus Mode

Focus Mode displays album artwork, an artwork-based background, and scrolling lyrics alongside playback controls. Click a timed lyric to jump to that point and play.

- **Line-synchronized lyrics:** Embedded LRC lyrics scroll with playback.
- **Word-synchronized lyrics:** Songs with word timing, such as QRC or YRC lyrics, support karaoke highlighting.
- **Display settings:** Adjust background opacity, background blur, lyric font size, and line spacing in Settings.

When lyrics are unavailable, the app shows a corresponding message. You can add lyrics through a local track's metadata editor; synchronized scrolling requires timestamps in the lyrics.

### System lyrics and media controls

| Platform | System lyrics |
| --- | --- |
| macOS | Current lyrics in the menu bar, with previous, play/pause, and next controls. |
| Windows | Taskbar lyrics with karaoke highlighting and playback controls on hover. |

Playback information is also shared with system media controls so you can view the current song and control playback.

## WebDAV library

Open **Settings** at the bottom of the sidebar. Enter your server URL, account, and app password in the WebDAV section, test the connection, and save. Then select **Cloud** in the sidebar.

- Load music from your server into a track list and stream it.
- Refresh the cloud library using its refresh button.
- Find loaded cloud tracks through the search box at the top.

Cloud playback requires a working network connection. Uploading local files or online songs to WebDAV is currently disabled. Cloud library loading, playback, refresh, and existing metadata caching remain unchanged.

## Online music and playlists

### Enable sources and sign in

1. Open **Settings → Online Music** and enable **Add Third-Party Music Source**.
2. Select QQ Music or NetEase Cloud Music in the third-party source section that appears below.
3. Scan the QR code with the provider's mobile app and confirm login, or enter a Cookie manually and save.

QQ Music requires valid login credentials to appear in online search. NetEase supports anonymous search and preview playback. Personal playlists require login to the corresponding provider. Playback, downloads, and available quality depend on the resources returned by the provider and your account permissions.

### Search, listen, and download

Return to the library and enter keywords in the top search box. Online results identify their QQ or NetEase source. Click a song to listen; preview history is available in the sidebar's **Online Queue**.

The download button on result cards offers three quality choices:

| Quality | Option |
| --- | --- |
| Standard | 128 kbps |
| High quality | 320 kbps |
| Lossless | FLAC |

Before downloading, choose a destination folder in the third-party source settings, or enter a path such as `~/Music`. Completed downloads are added to the local library with available song information, artwork, and lyrics written to the file.

### Browse playlists

After login, the sidebar's playlist section loads playlists from the corresponding providers. Open a playlist to view its tracks, then click a song to play it. Longer playlists load more tracks as you scroll down.

Use the playlist section's edit button to hide or show playlists. This only changes their visibility in the app's sidebar; it does not delete playlists from the provider.

### Music source plugins

QQ Music and NetEase implementations are maintained in the independent [LyricsAdapter-Music-Plugins](https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins) repository. Both plugins ship with the app. In Settings → Online Music → Music source plugins, you can install a local plugin folder, inspect versions, and enable or disable each plugin. Restart after installing or updating a plugin.

Disabling a plugin preserves tracks, playlists, and credentials. Online marketplace and automatic updates are not implemented yet.

## Appearance and shortcuts

Use the light/dark button at the bottom of the sidebar to switch appearance. The button at the top left collapses or expands the sidebar, and dragging its right edge adjusts its width.

Settings offers Chinese, English, Japanese, Korean, German, and French interfaces. Windows also includes a toggle for the updated Focus Mode font.

Common default shortcuts use `⌘` on macOS and `Ctrl` on Windows:

| Action | Shortcut |
| --- | --- |
| Play/pause | `Space` |
| Previous/next track | `⌘ / Ctrl` + `← / →` |
| Seek backward/forward 5 seconds | `← / →` |
| Seek backward/forward 30 seconds | `Alt` + `← / →` |
| Decrease/increase volume | `↓ / ↑` |
| Mute/unmute | `M` |
| Cycle playback mode | `Tab` |
| Enter/exit Focus Mode | `⌘ / Ctrl` + `Enter` |
| Focus search | `⌘ / Ctrl` + `F` |
| Open Settings | `⌘ / Ctrl` + `,` |

In **Settings → Shortcuts**, click a key combination to change it. Press `Esc` to cancel, or `Backspace` or `Delete` to clear the binding. You can also restore the defaults.

## Development

Use Node 24.19.0 or a later 24.x version. Initialize the plugin submodule before installing dependencies:

```sh
git submodule update --init --recursive
npm ci
npm run electron:dev
```

`npm run check` validates both the application and its music plugins. See [music source plugins](docs/music-source-plugins.md) for plugin installation and the runtime contract, and [DEBUGGING.md](DEBUGGING.md) for isolated test data.

## License and credits

The project uses [GPLv3](LICENSE), and the app icon uses [CC BY 4.0](app-icon-LICENSE). See the [third-party notices](docs/THIRD_PARTY_NOTICES.md) for component and design credits.
