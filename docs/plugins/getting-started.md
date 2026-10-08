# 开发第一个插件

## 环境和 SDK

使用主项目 `package.json` 指定的 Node 版本，目前为 `>=24.19.0 <25`。在主项目根目录执行：

```bash
npm ci
npm run plugins:check
npm run plugins:package
npm run electron:dev
```

`plugins:check` 检查公共契约、生成 SDK，并在独立 NodeNext 项目中验证包的类型和运行时导入；`plugins:package` 将 [示例目录](../../examples/plugins/lyric-translation/manifest.json) 打包为 `dist-plugins/example-translation.laplugin`。开发启动不依赖这些命令，未安装任何插件也能启动。

进入「设置 → 插件 → 安装本地插件」，选择这个文件。出现「歌词对照翻译」后选择「对照译文示例」。可修改示例的译文前缀并保存，进入有歌词的歌曲的专注模式，在两种歌词渲染器中都能看到对照文本。安装只添加能力，翻译默认关闭；选择翻译插件后，宿主才会把歌词交给它。

示例是契约演示，没有真实翻译效果。接入翻译服务时，将服务的 HTTPS origin 写入 `permissions.network`，在 `translate` 中通过 `context.network.fetchText` 调用服务，并将请求的 `signal` 传入。密钥使用 `context.secrets`，不要放在配置字段或普通存储中。

## 在独立仓库使用

SDK 包已具备可打包结构，目前尚未发布到 npm。先在主项目生成 tarball：

```bash
npm run plugin-sdk:build
npm pack ./packages/plugin-sdk --pack-destination /tmp
```

在插件仓库安装 `/tmp/lyrics-adapter-plugin-sdk-1.0.0.tgz` 作为开发依赖，然后导入公共类型：

```ts
import type { PluginContext, LyricsTranslationProvider } from '@lyrics-adapter/plugin-sdk';

export function activate(context: PluginContext) {
  const provider: LyricsTranslationProvider = {
    async translate({ document, targetLanguage }, { signal }) {
      signal.throwIfAborted();
      return {
        documentId: document.id,
        documentRevision: document.revision,
        targetLanguage,
        lines: document.lines.map(line => ({ lineId: line.id, text: line.text })),
      };
    },
  };
  context.extensions.register('lyrics.translation', 'default', provider);
}
```

公共 SDK 只导出契约和版本常量，不包含 React、Electron 或主应用的服务。清单可以直接复制示例，修改 `id`、名称、版本和扩展声明。把依赖打包成一个自包含的 `index.cjs`，外部 Node 依赖不会随安装器自动安装。SDK 运行时常量如果被使用，也应由打包工具打进插件。

主项目提供通用打包工具，输入目录必须含 `manifest.json`、`index.ts`：

```bash
node /absolute/path/LyricsAdapter/scripts/packagePlugin.mjs /absolute/path/my-plugin /absolute/path/output
```

打包工具不执行插件代码，也不等于完整兼容性检查；安装器检查清单和校验和，首次调用扩展时检查 `activate` 和提供者注册。建议为插件增加独立类型检查、提供者契约测试和宿主安装测试。

## 包与文件

`.laplugin` 是 UTF-8 JSON：

```json
{
  "manifest": { "manifestVersion": 1, "id": "example-translation", "name": "Example", "version": "1.0.0", "main": "index.cjs", "coreApi": "^1.0.0", "extensionApis": { "lyrics.translation": "^1.0.0" }, "contributes": { "providers": [{ "type": "lyrics.translation", "id": "default", "name": "Example" }] } },
  "code": "exports.activate = context => { /* register declared providers */ };",
  "sha256": "SHA-256 of the exact UTF-8 code string"
}
```

整个包最多 24 MiB，入口最多 20 MiB，清单文件最多 64 KiB；只安装清单和单个入口。入口必须是本地 `.cjs` 文件名，不支持子路径、归档解压、符号链接或安装脚本。

新格式更新会取消旧请求、清理旧注册，并在下次使用时加载新代码。旧格式音乐插件更新仍要求重启。启用状态跨重启保存。卸载删除代码，保留该插件的配置、普通数据和凭据，方便重新安装；这些状态在应用的 SQLite 数据库中，不写进插件代码目录。QQ/网易云已有凭据键和旧数据目录迁移保持兼容。

第三方插件目前通过本地 `.laplugin` 安装；在线目录只提供官方 QQ/网易云插件。通用第三方市场、签名和 npm 发布尚未实现。
