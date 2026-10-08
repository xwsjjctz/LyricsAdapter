# 版本演进与兼容迁移

## 四种版本各管什么

| 字段/版本 | 当前 | 迭代约定 |
| --- | --- | --- |
| `manifestVersion` | 1 | 清单解析和包语义；不兼容结构才增加版本 |
| `coreApi` | 1.0.0 | 生命周期和基础服务；插件声明要求范围 |
| `extensionApis[type]` | music.source / lyrics.translation 各 1.0.0 | 每个扩展独立演进，音乐变化不强迫翻译插件升级 |
| 插件 `version` / SDK 包版本 | 插件自行维护 / SDK 1.1.0 | 插件发布版本、开发工具版本；不能代替宿主能力判断 |
| 更新清单 `schemaVersion` | 1 | 分发信息独立演进，不改变已有运行时 API |

API 的 patch 修正实现而不改契约；minor 只增加可选字段、新方法或新能力，不删除字段、不改变已有单位/默认行为/语义；major 才允许不兼容变化。新必需服务方法通过 `coreApi: "^1.1.0"` 声明最低版本，而不是假设用户都安装最新宿主。扩展点也声明自己的最低版本。

范围当前支持精确版本、`^`、`~`。例如 `^1.0.0` 可接受 1.x，拒绝 2.x；`~1.2.0` 接受 1.2 的后续 patch；`^0.2.1` 不跨 0.2，`^0.0.1` 只接受同 patch。不支持 npm 任意复杂范围和预发布 API，避免双方理解不同。

## 可选能力与未来 API

插件核心功能写在 `extensionApis`，增强功能写在 `optionalExtensionApis`。旧宿主在认识或满足增强功能之前会跳过它，仍可激活基本功能。`context.apiVersions.extensionApis` 只含成功协商的能力：

```ts
if (context.apiVersions.extensionApis['lyrics.translation']) {
  context.extensions.register('lyrics.translation', 'default', translationProvider);
}
```

未来需要注音、注释、词典、Focus 面板、命令或播放器控制时：

1. 先明确数据和权限边界，并给扩展点一个独立名字和版本。
2. 在公共 SDK 增加类型；在宿主实现注册校验、消费者和必要 IPC。
3. 只公开稳定 DTO 和意图接口；不要暴露 React 内部状态、文件路径、数据库或通用 IPC。
4. 对旧契约增加兼容测试，同时测试新插件要求更高版本时能被旧宿主明确拒绝。
5. 同步更新 API 参考、可运行示例、变更记录和兼容矩阵。

`register` 只接受宿主已实现并且清单已协商的扩展。未知字符串不会获得隐式调用通道。插件也不能凭一项网络/歌词权限直接注入网页。

## 旧音乐 API v1

当前继续接受以下格式，无需重新打包 QQ/网易云已有插件：

```json
{
  "id": "netease", "name": "网易云音乐", "version": "0.1.0",
  "apiVersion": 1, "main": "index.cjs", "requiresCookie": false,
  "capabilities": ["search", "stream", "lyrics", "playlists"]
}
```

宿主继续调用 `createPlugin(host)`，保留 readSecret/writeSecrets、全部音乐方法、QQ/网易云旧 IPC 登录动作、历史凭据和启用设置。旧插件更新继续使用重启生效行为，避免改变其未提供清理接口的运行语义。新格式音乐插件则使用 `activate`，停用时释放注册，更新后下次请求加载新入口。

迁移可以复用原 provider，不必重写服务协议：

```ts
import type { PluginContext } from '@lyrics-adapter/plugin-sdk';
import { createPlugin } from './legacy-implementation';

export function activate(context: PluginContext) {
  const plugin = createPlugin({
    logger: context.logger,
    readSecret: name => context.secrets.get(name),
    writeSecrets: entries => {
      for (const [name, value] of Object.entries(entries)) context.secrets.set(name, value);
    },
  });
  context.extensions.register('music.source', 'default', plugin);
}
```

清单替换为 `manifestVersion: 1`、`coreApi: "^1.0.0"`、`extensionApis: { "music.source": "^1.0.0" }`、对应 provider 声明，并加上 `permissions.secrets: "own"`。ID 维持 `qq` 或 `netease` 时凭据继续使用已有映射。API 格式更换不等于旧 music.source 数据模型取消兼容。

| 包格式 | 构造入口 | 当前支持 | 更新生效 |
| --- | --- | --- | --- |
| 旧 apiVersion: 1 | createPlugin(host) | 保留 | 重启 |
| manifestVersion: 1 + 可协商 API | activate(context) | 支持 | 下次请求 |
| 更高 manifestVersion / 不支持的必需 API | 不执行 | 显示不兼容原因 | 需更新宿主或兼容包 |
| 不支持的可选扩展 | 基本功能仍可激活 | 跳过可选扩展 | 无需阻断基本功能 |

旧 API 目前标记为兼容接口，没有移除日期。后续弃用应先在文档/发布说明中声明替代接口和迁移窗口，至少覆盖两个后续宿主 minor 版本；真正移除必须经过明确的宿主/API major 决策。此为维护约定，当前实现不会自动到期关闭旧插件。

## 初始变更记录

- Core 1.0.0：版本协商、惰性激活、注册清理、Scoped storage/secrets/configuration、受限 SDK 文本请求。
- music.source 1.0.0：保留旧音乐 DTO 和行为，将源 ID 扩展为 string 并增加通用注册入口。
- lyrics.translation 1.0.0：不可变歌词文档、稳定行 ID、独立译文、取消/超时/结果校验，接入专注模式两种渲染器。
- SDK 包 1.0.0：可生成和打包，尚未发布 npm；提供开发示例和宿主契约测试。
- SDK 包 1.1.0：新增可选更新来源、更新清单和宿主管理接口类型；Core 与两个扩展点仍为 1.0.0。旧清单与 API v1 继续兼容。分发流程见[插件更新与分发](updates.md)。
