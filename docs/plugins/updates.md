# 发布插件更新

通用更新管理适用于新格式插件和旧音乐 API v1 插件。软件负责检查和安装更新，插件运行时不自行覆盖代码。更新分发协议使用 `schemaVersion: 1`，与 `manifestVersion`、`coreApi` 和扩展 API 分别演进。

## 用户操作

设置 → 插件 → 已安装插件可以检查更新。出现兼容的更高版本时，插件卡片显示当前版本、目标版本、更新说明和“更新”按钮。失败后可重试。来源设置可以绑定 GitHub 仓库或 HTTPS 清单，并选择稳定版或包含预发布版本；选择“关闭在线更新”停止该插件的在线检查。本地覆盖安装继续可用。

启动后约 10 秒后台检查，每小时检查缓存是否到期。成功结果缓存 24 小时，失败结果缓存 5 分钟；打开插件页复用缓存，“检查更新”强制刷新。不会自动下载或安装新代码。一个来源多个插件共享一次请求，检查最多并发 4 个来源。

## 声明初始来源

新格式和旧格式清单都可增加可选的 `update` 字段。例如：

```json
{
  "update": {
    "kind": "github",
    "repository": "your-name/your-plugins",
    "channel": "stable"
  }
}
```

或使用自行发布的 HTTPS 清单：

```json
{
  "update": {
    "kind": "manifest",
    "url": "https://example.com/plugins.update.json",
    "channel": "stable"
  }
}
```

该字段仅在首次安装时作为来源提示。宿主将绑定保存到自己的 SQLite 数据库；下载的新版不能通过修改 `update` 改变已绑定来源。用户可以在插件页明确切换或关闭来源。旧插件缺少此字段仍可安装；已安装的 QQ、网易云默认绑定官方目录，其余旧插件需要手动绑定。已有显式绑定和关闭状态优先于清单。

## 更新清单格式

```json
{
  "schemaVersion": 1,
  "plugins": [
    {
      "id": "example-translation",
      "releases": [
        {
          "version": "1.1.0",
          "url": "https://github.com/your-name/your-plugins/releases/download/v1.1.0/example-translation.laplugin",
          "sha256": "安装包完整字节的64位小写SHA-256",
          "manifest": "替换为该安装包内完整的manifest对象",
          "notes": "本次更新说明"
        }
      ]
    }
  ]
}
```

上面的 `sha256` 和 `manifest` 为解释用占位，实际发布请使用下述工具生成。`manifest.id`、`manifest.version` 必须与对应条目一致。`notes` 是纯文本，最长 16,384 个字符。HTTPS 清单的下载 URL 可以相对清单地址；GitHub 来源的清单和安装包必须属于所绑定仓库的 Releases 路径。凭据和 URL fragment 不允许出现在更新 URL 中。

清单最多 512 KiB、100 个插件，每个插件最多 100 个版本；安装包最多 24 MiB。宿主按 SemVer 排序，仅安装比已安装版本更新的版本，忽略 build metadata 对优先级的影响。稳定频道排除预发布，预发布频道包含稳定版及预发布。新版 API 不兼容时跳过；如果历史中有兼容的更高版本，会提供该版本，否则显示不兼容原因。

建议在最新清单中保留历史版本条目，以便旧宿主获取最后一个兼容版本。不要只提供最新版后就删除仍需支持的旧安装包。

## 生成和发布

在主项目中先构建包，再生成分发清单：

```bash
npm run plugins:package -- examples/plugins/lyric-translation dist-plugins
npm run plugins:feed -- dist-plugins --base-url https://github.com/your-name/your-plugins/releases/download/v1.0.0/ --out dist-plugins/plugins.update.json
```

`plugins:feed` 也接受单个 `.laplugin`，可用 `--notes release-notes.txt` 添加纯文本说明。若输出清单已存在，会保留历史条目并替换相同插件的相同版本。生成器只读取安装包数据，不执行代码。

GitHub 来源：创建 Release，上传 `.laplugin` 和名为 **`plugins.update.json`** 的清单附件。稳定频道读取 GitHub 的 latest Release；预发布频道读取最近 20 条发布记录，选择第一条非草稿且含清单附件的记录。因此最新清单需要携带兼容版本历史。当前支持公开仓库，不配置 GitHub 登录令牌。

HTTPS 来源：把安装包与清单发布在可信的 HTTPS 服务中；每次发布更新版本、地址、完整包哈希和清单。无需运行插件市场服务器。

## 安装与失败恢复

宿主在点击更新时重新取得来源信息，校验完整包 SHA-256、包内代码哈希、ID、版本、API 和语法。网络、校验或文件替换失败时保留旧文件。新接口启用中的插件会取消旧请求并验证新版激活；激活失败恢复旧代码，旧运行时随后重新激活。已禁用插件更新后仍保持禁用，不为验证而激活代码。

旧音乐插件沿用重启后生效；新版安装成功后显示重启提示，当前已加载实例继续提供服务。配置、凭据、普通数据和启用状态保持原来的宿主存储，不写进代码目录。

代码回退不能撤销插件在激活期间自行产生的外部请求或数据副作用；旧 API 插件的新版实际激活发生在重启时。SHA-256 是内容一致性校验，不是作者签名。当前插件仍作为可信 Node 代码运行，来源绑定不是权限沙箱。

## 宿主管理接口

渲染界面经 desktopAdapter 调用：`pluginUpdateList()`、`pluginCheckUpdates()`、`pluginUpdate(id)`、`pluginSetUpdateSource(id, source | null)`，通过 `onPluginUpdatesChanged` 订阅状态。更新服务属于宿主管理层，不是插件 `PluginContext` 的自更新权限。

来源和检查缓存分别保存为 `plugin-installation:<id>:update-source`、`plugin-installation:<id>:update-cache`。缓存带独立 `schemaVersion`，并与当前插件版本、来源绑定匹配。卸载保留来源与配置，重新安装同 ID 可复用；新版不能静默修改来源。
