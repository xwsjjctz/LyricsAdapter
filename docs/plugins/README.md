# LyricsAdapter 插件 API

本文档对应当前源码实现的核心 API **1.0.0**。插件安装在应用数据目录的 `plugin/<plugin-id>/`，默认是 `~/.la/plugin`。没有插件也可以启动应用。

- [快速开始](getting-started.md)：构建、打包、安装并验证一个插件。
- [API 参考](api.md)：清单、生命周期、核心服务和两个可用扩展点。
- [版本演进与旧接口迁移](versioning.md)：兼容范围、可选能力、弃用规则和音乐源迁移。
- [插件更新与分发](updates.md)：声明来源、生成清单、发布新版和失败恢复。
- [完整 TypeScript 契约](../../src/shared/plugin.ts)、[可打包 SDK](../../packages/plugin-sdk/index.ts)。
- [可运行的对照译文示例](../../examples/plugins/lyric-translation/index.ts)。该示例演示按行返回文本，不调用真实翻译服务。

当前扩展点是 `music.source@1.0.0` 和 `lyrics.translation@1.0.0`。新音乐源接口延续已有音乐数据模型，界面的音乐源选择仍接入 QQ/网易云；第三方自定义音乐源 ID 可以在宿主层注册和调用，但尚未进入搜索、播放槽和登录 UI。翻译插件则可以使用自定义 ID，在插件页选择后供专注模式使用。

播放器控制、媒体库写入、命令、任意页面/React 组件注入、桌面歌词扩展目前没有公开 API。后续在有实际需求时逐项增加独立扩展点，避免让第三方依赖内部组件、私有状态或 Electron IPC。

插件运行于 Electron 主进程的 Node 环境，安装意味着信任插件代码。SDK 服务限制作用于 SDK 调用；Node 插件仍能直接使用 Node API，因此当前运行时不是安全沙箱，也不能强制阻止插件绕过网络白名单。异步超时无法中断阻塞事件循环的代码。进程隔离和不可信代码沙箱属于后续独立工作。
