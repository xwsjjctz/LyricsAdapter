# 音乐源插件

QQ 和网易云音乐协议实现维护在独立公开仓库 [LyricsAdapter-Music-Plugins](https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins)。主应用已移除插件子模块引用，协议源码在独立仓库开发，通过安装包接入应用。

## 启动与安装

主应用不附带音乐源插件，也不会在启动、检查、构建或打包时拉取或编译插件源码。无插件时本地音乐和 WebDAV 仍可使用，在线音乐设置不显示。

设置 → 插件是独立的管理页面，提供官方插件的下载安装、本地 `.laplugin` 安装包安装、启用/禁用、卸载和打开插件目录。官方列表优先读取插件仓库 `main/packages/catalog.json`，安装包直接从同一仓库的 `packages/` 下载，无需先创建 GitHub Release。目录不存在时兼容读取最新 Release；两者均无安装包时显示“暂无可下载版本”，网络失败不影响本地插件管理。

安装目录为持久化数据目录下的 `plugin/<id>/`，默认是 `~/.la/plugin/qq/` 与 `~/.la/plugin/netease/`。页面显示应用实际使用的目录；目录内只保存 `manifest.json` 和自包含的 `index.cjs`，无需用户安装 npm 依赖。原 `.la/music-plugins` 中的插件会自动迁移，目标已存在时保留现有安装和旧副本，避免覆盖。

首次安装立即可用；启用可用的音乐插件后，设置中显示在线音乐，来源列表和搜索只使用已启用的音乐源。禁用或卸载最后一个可用音乐插件会隐藏在线音乐设置，不删除歌曲、歌单或登录凭据。更新已安装插件后仍需重启，以便正在使用的代码保持一致。已开始的音频传输不主动中断。

`.laplugin` 是包含 manifest、打包代码及代码 SHA-256 的单文件安装包。下载安装同时校验官方仓库地址、下载大小、目录中的安装包摘要和版本、代码摘要、插件 ID 和 API 版本。Release 兼容下载也会检查 GitHub 提供的资产摘要（若存在）。插件仍以宿主 Node 权限运行，应只安装可信来源的代码。

## 插件开发

第三方作者请先阅读[通用插件 API](plugins/README.md)和兼容接口的[音乐源插件开发指南](development/music-plugin-development.md)：其中说明 API v1 的接入边界、provider 合同、可运行示例和安装包格式。当前自定义 ID 可以安装和被主进程调用，但还不能自动成为界面中的新音乐源。

在单独克隆的插件仓库中开发和打包，例如本机的 `../LyricsAdapter-Music-Plugins`：

```sh
cd ../LyricsAdapter-Music-Plugins
npm ci
npm run check
```

独立仓库的 `npm run package`（也由 `check` 调用）生成 `packages/qq.laplugin`、`packages/netease.laplugin` 和 `packages/catalog.json`。源码、目录和安装包一起提交至插件仓库的 `main` 后，主应用即可在线下载，用户不需要保留源码目录。独立仓库 CI 重新生成并比对分发文件，防止目录、安装包与源码不一致。

主项目 `music-plugins:build` 默认读取相邻的独立仓库，也可通过 `LYRICS_ADAPTER_MUSIC_PLUGIN_SOURCE` 指定源码目录；不会初始化子模块。`plugins:check` 检查公共 SDK，`music-plugins:check` 暂作为其别名。官方插件自己的完整检查仍在独立仓库执行。CI 检查公共 SDK 并打包开发示例，再单独检出固定版本的官方仓库生成协议集成测试夹具；应用构建和启动仍不依赖这些源码。

## 合同与兼容

合同定义在 `src/shared/musicPlugin.ts`，API 版本 1。宿主检查 manifest、入口范围和插件导出，通过统一 `music-plugin-call` 调用 provider。原有扫码与续期 bridge 是兼容转发，实际实现由插件提供。
插件只负责获取数据、解析地址和平台协议；播放器控制器和音乐库控制器继续拥有状态修改权限。
歌词缓存留在 renderer，音频代理与下载留在 Electron。插件提供流媒体请求头，宿主负责 Range、取消和进度。
QQ 登录续期只在插件内执行：宿主的定时续期与请求过期触发的续期共用同一次上游交换，结果由插件写回凭据。
网易云登录续期同样在插件内执行：有已保存登录时，使用该音乐源会每天延长一次会话并写回轮换后的 Cookie；请求返回需要登录（301）时先续期再重试一次。会话已失效时续期会被拒绝，仍需重新扫码。
`scripts/musicPluginContract.ts` 检查主项目公共 SDK 的旧音乐合同和类型化扩展注册；`plugins:check` 还在隔离 NodeNext 项目中验证生成 SDK 的类型及运行时导入。官方仓库的协议测试和主项目的实际安装/调用测试继续验证跨仓库兼容。

第一版继续保留 `qq` / `netease` 来源、旧歌曲 ID、Cookie 和凭据持久化键，因此不需要重写现有用户数据。新插件凭据使用 `music-plugin:<id>:secret:<name>`，按敏感数据策略加密。

第一版的界面、Cookie 管理和来源类型仍只认识 `qq` 与 `netease`：其他 ID 的插件可以安装并出现在列表中，但还没有入口使用它。

插件以宿主 Node 权限运行，当前机制面向可信官方插件，不提供第三方代码沙箱。第三方市场仍需额外的信任机制与必要的运行隔离。

## 验证

平台协议的回归测试在插件仓库中运行；主项目覆盖无插件启动、目录迁移、官方包下载校验、首次安装即时生效、启用状态持久化、安装更新、兼容性拒绝、renderer 转发和真实 Electron 集成。

插件页提供官方仓库的目录和手动下载安装；第三方市场和自动更新尚未实现；旧格式音乐插件更新仍需重启，新格式插件更新可在清理旧实例后按需加载。

真实 Electron 的 QQ 协议回归需要先构建测试夹具。在独立插件仓库运行下面的命令，路径可按实际 checkout 调整：

```sh
node scripts/build.mjs ../LyricsAdapter/dist-music-plugins
```

测试会将构建后的 QQ 插件复制到临时用户的 `plugin/qq`，不会将其作为应用资源加载。主应用的 `npm run check` 不依赖官方插件源码；QQ 凭据刷新真实协议测试需要这个可选夹具，其余插件测试使用独立测试包。

可验证 macOS 打包后的插件加载：先生成 `.app`，再运行：

```sh
LYRICS_ADAPTER_E2E_EXECUTABLE="$PWD/release/mac-arm64/LyricsAdapter.app/Contents/MacOS/LyricsAdapter" npm run test:e2e:run -- electron.music-plugins.spec.ts
```

该测试仍使用临时 HOME/userData，与真实用户数据隔离。
