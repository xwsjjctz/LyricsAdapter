# 大语言模型歌词翻译插件

`llm-translation` 是一个 `lyrics.translation` 插件：把当前歌曲的歌词发给大语言模型翻译，在专注模式中对照显示，并把译文按歌曲缓存在本地。已经翻译过的歌曲直接读取缓存，不会再次请求模型。

需要宿主核心 API 1.1.0、`lyrics.translation` 1.1.0（见 [API 参考](../../../docs/plugins/api.md)）。

独立发布仓库：[xwsjjctz/LyricsAdapter-LLM-Translation](https://github.com/xwsjjctz/LyricsAdapter-LLM-Translation)。清单声明了该仓库为 GitHub 更新来源，安装 Release 中的 `.laplugin` 后可在插件页在线检查更新。

## 打包与安装

```bash
npm run plugins:package -- examples/plugins/llm-translation
```

生成 `dist-plugins/llm-translation.laplugin`。在「设置 → 插件 → 安装本地插件」中选择它，然后：

1. 在插件卡片中填写接口格式、接口地址、API Key 和模型，点「保存插件设置」。
2. 在「歌词对照翻译」中选择「大语言模型翻译」和目标语言。
3. 进入专注模式，点击歌曲信息下方的「翻译」按钮。首次翻译一首歌需要等待模型返回（按钮显示加载动画，歌词照常显示原文），完成后译文直接替换进歌词、按钮变为「已翻译」；之后再听同一首歌会直接使用缓存。

## 支持的接口

| 接口格式 | 地址（留空时） | 说明 |
| --- | --- | --- |
| `openai` | `https://api.openai.com/v1` | 调用 `POST {地址}/chat/completions`。适用于 OpenAI 及兼容服务，例如 `https://api.deepseek.com/v1`、`https://dashscope.aliyuncs.com/compatible-mode/v1`、`https://api.moonshot.cn/v1`、本机 `http://localhost:11434/v1`（Ollama）、`http://127.0.0.1:1234/v1`（LM Studio）。必须填写模型名。 |
| `anthropic` | `https://api.anthropic.com/v1` | 调用 `POST {地址}/messages`（Claude Messages API）。模型留空时使用 `claude-opus-5-5`；想降低成本可以填 `claude-haiku-5-5` 等。在官方地址上使用 Claude Opus 5.5 等支持的模型时，会启用服务端拒答回退（`fallbacks: "default"`）。 |

接口地址是 `format: "endpoint"` 配置：用户填写的地址的 origin 会加入本插件的网络白名单，无需修改清单。只允许 HTTPS，以及本机回环地址上的 HTTP。

API Key 是 `format: "secret"` 配置：加密保存在本机，界面只显示“已保存”，不会回显。本地模型不需要 Key 时可以留空。

## 翻译方式

- 歌词按文本去重后发送（副歌只翻译一次），每批最多 60 行，最多 2 批并行。
- 请求包含歌名、歌手、专辑，帮助模型理解上下文；不发送文件路径或音频。
- 模型返回 JSON：`{"translations":[{"id":"1","text":"..."}]}`。回复无法解析或覆盖不足一半的行时会重试一次。
- 已是目标语言的行、纯拟声词和作词/作曲等署名行返回空译文，宿主只显示原文。
- 风格（natural / faithful / poetic）和额外要求会写入提示词。

## 本地缓存

译文通过 `context.cache` 保存在 `~/.la/plugin-data/llm-translation/`，每首歌一个文件 `track-<Track ID>.json`。Track ID 是宿主对歌曲 ID 的 SHA-256，同一首歌保持不变，因此缓存跟随歌曲；其中按「目标语言 + 风格 + 额外要求」分别保存，每首歌最多 8 个版本。

| 变化 | 是否重新翻译 |
| --- | --- |
| 重启应用、更新或停用插件 | 否 |
| 更换模型或接口 | 否（如需用新模型重译，先清除缓存） |
| 更换目标语言、风格或额外要求 | 是（旧版本仍保留，切回时直接使用） |
| 歌词内容变化 | 是 |
| 点击插件卡片中的「清除缓存」 | 是 |
| 卸载插件 | 缓存随插件删除 |

关闭「使用本地翻译缓存」后每次都会请求模型，也不写入缓存。

## 文件

| 文件 | 内容 |
| --- | --- |
| [manifest.json](manifest.json) | 清单、网络和凭据权限、配置项 |
| [index.ts](index.ts) | 注册翻译提供者；去重、分批、合并结果，读写缓存 |
| [llmClient.ts](llmClient.ts) | OpenAI 兼容接口与 Anthropic Messages API 请求 |
| [prompt.ts](prompt.ts) | 提示词与模型回复解析 |
| [settings.ts](settings.ts) | 读取并规范化配置 |
| [translationCache.ts](translationCache.ts) | 按歌曲的缓存结构 |
