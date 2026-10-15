# 隐私政策 · Privacy Policy

最后更新 / Last updated: 2026-10-15

[中文](#中文) · [English](#english)

## 中文

LyricsAdapter 是一款开源桌面音乐播放器。本说明适用于从 [GitHub Releases](https://github.com/xwsjjctz/LyricsAdapter/releases) 获取的官方构建。

### 我们不收集任何数据

LyricsAdapter 不包含统计、遥测、广告或崩溃上报功能。开发者不会收集、接收或出售任何用户数据，也不运营任何接收用户数据的服务器。

### 保存在本机的数据

以下数据只保存在你的电脑上，不会上传给开发者：

- 曲库、播放状态和应用设置；
- 歌词、封面等缓存文件；
- 音乐源账号的登录凭据和 WebDAV 密码。这类敏感信息通过系统钥匙串（Electron `safeStorage`）加密后保存。

卸载应用并删除其数据目录即可清除上述数据。

### 应用会访问的网络服务

LyricsAdapter 只在以下情况下联网。这些服务会收到常规的网络请求信息（例如 IP 地址），并适用各自的隐私政策：

- **GitHub**：检查和下载应用更新，获取官方插件目录并下载、更新插件。
- **音乐源插件对应的服务**：例如 QQ 音乐、网易云音乐。只有在你安装并使用相应插件时才会访问，用于搜索、播放、下载歌曲和获取歌词、封面。
- **你自己配置的 WebDAV 服务器**：只有在你填写 WebDAV 地址后才会连接，用于同步和播放云端曲库。

### 第三方插件

插件运行各自的代码。你从官方插件仓库以外安装的插件不在本说明范围内，安装前请确认你信任其来源。

### 联系方式

如有疑问，请在 [GitHub Issues](https://github.com/xwsjjctz/LyricsAdapter/issues) 中提出。

## English

LyricsAdapter is an open-source desktop music player. This policy covers the official builds distributed through [GitHub Releases](https://github.com/xwsjjctz/LyricsAdapter/releases).

### We collect no data

LyricsAdapter contains no analytics, telemetry, advertising or crash reporting. The developer does not collect, receive or sell any user data, and runs no server that receives it.

### Data stored on your computer

The following data stays on your computer and is never sent to the developer:

- your library, playback state and settings;
- cached lyrics, covers and similar files;
- music-source login credentials and WebDAV passwords. These are encrypted with the system keychain (Electron `safeStorage`) before they are saved.

Uninstalling the app and deleting its data directory removes all of it.

### Network services the app uses

LyricsAdapter only goes online in the cases below. Each service receives ordinary request information, such as your IP address, and is governed by its own privacy policy:

- **GitHub**, to check for and download app updates, and to fetch the official plugin catalog and download or update plugins.
- **Services behind music-source plugins**, such as QQ Music or NetEase Cloud Music, only when you install and use that plugin, to search, play and download songs and to fetch lyrics and covers.
- **A WebDAV server you configure yourself**, only after you enter its address, to sync and play your cloud library.

### Third-party plugins

Plugins run their own code. Plugins installed from outside the official plugin repository are not covered by this policy; only install plugins from sources you trust.

### Contact

Questions can be raised in [GitHub Issues](https://github.com/xwsjjctz/LyricsAdapter/issues).
