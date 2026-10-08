# 音乐源插件

QQ 和网易云音乐协议实现维护在独立公开仓库 [LyricsAdapter-Music-Plugins](https://github.com/xwsjjctz/LyricsAdapter-Music-Plugins)。主项目通过 `music-source-plugins` submodule 固定随应用提供的插件版本，协议源码不再属于主项目。

## 开发

```sh
git submodule update --init --recursive
npm ci
npm run music-plugins:check
npm run check
```

`npm run dev`、`npm run electron:dev`、`npm run electron:debug`、`npm run build` 会先构建插件；Electron 打包复制 `dist-music-plugins` 到 resources/music-plugins。插件为自包含 CJS 文件，开发和安装包使用同一加载合同。

## 使用

在设置 → 在线音乐中开启在线音乐功能，音乐源插件管理区列出名称、版本、来源和启用状态。
“安装本地插件”接受含 `manifest.json` 与 `.cjs` 入口的目录。安装后的代码放在持久化数据目录 `.la/music-plugins/<id>/`，优先于随应用提供的同 ID 插件。安装和更新需要重启；禁用即时阻止新的接口请求、播放地址解析与下载请求，重新启用恢复调用。
本地安装的插件可在同一区域卸载，卸载后恢复使用随应用提供的同 ID 插件；已加载的代码运行到重启为止。随应用提供的版本高于本地安装版本时宿主改用随应用版本，也拒绝安装比它更旧的包，因此应用升级不会被旧的本地安装遮蔽。无法通过校验的本地安装不会回退到随应用代码，而是带着错误信息留在列表中，等待替换或卸载。
禁用、更新或卸载不删除曲目、歌单或登录凭据。已开始的音频传输不主动中断。

## 合同与兼容

合同定义在 `src/shared/musicPlugin.ts`，API 版本 1。宿主检查 manifest、入口范围和插件导出，通过统一 `music-plugin-call` 调用 provider。原有扫码与续期 bridge 是兼容转发，实际实现由插件提供。
插件只负责获取数据、解析地址和平台协议；播放器控制器和音乐库控制器继续拥有状态修改权限。
歌词缓存留在 renderer，音频代理与下载留在 Electron。插件提供流媒体请求头，宿主负责 Range、取消和进度。
QQ 登录续期只在插件内执行：宿主的定时续期与请求过期触发的续期共用同一次上游交换，结果由插件写回凭据。
网易云登录续期同样在插件内执行：有已保存登录时，使用该音乐源会每天延长一次会话并写回轮换后的 Cookie；请求返回需要登录（301）时先续期再重试一次。会话已失效时续期会被拒绝，仍需重新扫码。
`test/shared/musicPluginContract.test.ts` 在 `npm run typecheck:test` 中比对宿主合同与 submodule 的 SDK 类型，两边不一致时检查失败。

第一版继续保留 `qq` / `netease` 来源、旧歌曲 ID、Cookie 和凭据持久化键，因此不需要重写现有用户数据。新插件凭据使用 `music-plugin:<id>:secret:<name>`，按敏感数据策略加密。

第一版的界面、Cookie 管理和来源类型仍只认识 `qq` 与 `netease`：其他 ID 的插件可以安装并出现在列表中，但还没有入口使用它。

插件以宿主 Node 权限运行，当前机制面向可信官方插件，不提供第三方代码沙箱。未来市场需在此基础上加入可信目录、下载校验、兼容筛选、更新提示与必要的运行隔离。

## 验证

平台协议的回归测试在插件仓库中运行；主项目覆盖运行时加载、启用状态持久化、安装更新、兼容性拒绝、renderer 转发和真实 Electron 集成。

在线插件市场、自动更新和热更新尚未实现。本地安装是第一版可用的分发入口。

可验证 macOS 打包后的插件加载：先生成 `.app`，再运行：

```sh
LYRICS_ADAPTER_E2E_EXECUTABLE="$PWD/release/mac-arm64/LyricsAdapter.app/Contents/MacOS/LyricsAdapter" npm run test:e2e:run -- electron.music-plugins.spec.ts
```

该测试仍使用临时 HOME/userData，与真实用户数据隔离。
