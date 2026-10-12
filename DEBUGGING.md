# Electron 调试与 AI Agent 工作流

这套配置把 LyricsAdapter 的三层调试分开，并通过一个专用命令组合起来：

| 层 | 接口 | 用途 |
| --- | --- | --- |
| React / Chromium 渲染进程 | CDP `127.0.0.1:9222` | DOM、Console、Network、性能、截图和自动化 |
| Preload / IPC | CDP + Electron 冒烟测试 | 验证 `window.electron`、Context Bridge 和真实 IPC |
| Electron 主进程 | Node Inspector `127.0.0.1:9229` | 主进程断点、启动流程、协议与 IPC Handler |

CDP 不能代替主进程调试器；9222 和 9229 各自负责不同的运行环境。

## 命令

```bash
npm run dev              # 仅浏览器渲染层，不启动 Electron
npm run electron:dev     # 普通 Electron 开发，不开放调试端口
npm run electron:debug   # Electron + CDP 9222 + Main Inspector 9229
npm run test:e2e         # 构建并运行真实 Electron 冒烟测试
npm run test:memory      # 构建并采集空闲/FocusMode 跨平台内存报告
npm run check            # 应用/E2E 类型检查 + 单元测试 + 生产构建
```

Vite 仅监听本机 `127.0.0.1`，端口固定为 3000。该端口被占用时启动会直接失败，避免 Vite 自动切到 3001、Electron 却仍连接 3000 的隐蔽错误。

## 使用 CDP + MCP + Agent

1. 在项目根目录启动专用调试模式：

   ```bash
   npm run electron:debug
   ```

2. 确认 Electron 渲染目标已暴露：

   ```bash
   curl http://127.0.0.1:9222/json/list
   ```

3. 让 Agent 连接运行中的 Electron：

   - Codex Desktop、CLI 和 IDE 在信任该项目后可读取 `.codex/config.toml`。
   - Claude 和兼容客户端可读取根目录的 `.mcp.json`。
   - 如果客户端不接受项目配置，Codex CLI 也可在本机注册同一个连接：

     ```bash
     codex mcp add lyricsadapter-electron -- npx --no-install playwright-mcp --cdp-endpoint http://127.0.0.1:9222 --output-dir .playwright-mcp
     ```

   - 已安装 `agent-browser` 时也可以直接连接，无需 MCP：

     ```bash
     agent-browser --session lyricsadapter --cdp 9222 snapshot -i
     ```

两份项目配置都启动本地 `playwright-mcp`，并通过 `--cdp-endpoint` 连接 9222。MCP 和 Agent 只属于开发工具链，不会被打进 LyricsAdapter 的安装包。`.playwright-mcp/` 中的截图、快照和日志也是本地生成物，不提交到 Git。

## 调试 Electron 主进程

先运行 `npm run electron:debug`，然后在 VS Code 的“运行和调试”中选择 `Attach Electron Main (9229)`。仓库中的 `.vscode/launch.json` 已配置源码映射和 `dist-electron` 输出路径。

也可以用任意兼容 Node Inspector 的调试器连接 `127.0.0.1:9229`。若需要捕获最早期启动代码，可临时把脚本中的 `ELECTRON_INSPECT` 改为 `ELECTRON_INSPECT_BRK`；不要把暂停启动的配置用于日常开发或 CI。

清理子进程会主动过滤继承的 `--inspect*` 参数，因此不会与 Electron 主进程争抢 9229。

## Electron 冒烟测试覆盖范围

`npm run test:e2e` 会：

- 构建 renderer、main、preload 和 cleanup；
- 启动项目安装的真实 Electron；
- 通过 `app://localhost/index.html` 加载构建后的静态资源；
- 验证 React 根节点、`window.electron`、窗口控制、设置读取和应用版本 IPC；
- 确认加载的是 `dist/`，而不是浏览器模式下的 Vite 页面；
- 将 `HOME`、`USERPROFILE`、Electron `userData` 和 XDG 目录全部隔离到临时目录。

测试不会读取或写入开发者真实的 `~/.la`、音乐库或设置。它是快速集成冒烟测试，不等同于最终 ASAR/签名安装包测试。

## Windows / macOS 内存基准

在需要对比的每台机器上使用相同提交，分别启动两个全新的进程执行：

```bash
npx cross-env MEMORY_BENCHMARK_LYRICS_RENDERER=legacy npm run test:memory
npx cross-env MEMORY_BENCHMARK_LYRICS_RENDERER=amll npm run test:memory
```

未指定 `MEMORY_BENCHMARK_LYRICS_RENDERER` 时默认测试 `legacy`；其他值会直接报错，避免拼写错误后测错渲染器。两种模式都从隔离设置和全新 Electron 进程启动，不能在同一进程中先加载 AMLL 再把结果当作 Legacy 冷启动基线。

AMLL 默认启用非活动歌词内存优化，无单独设置开关。它减少稳定非活动行的逐字合成层，保留当前行、即将演唱的行和运动收尾；旧版实验开关的存储值不再影响渲染。

内存基准使用隔离设置。测试较长的逐字歌词时，可设置相同的歌词行数：

```bash
npx cross-env MEMORY_BENCHMARK_LYRICS_RENDERER=amll MEMORY_BENCHMARK_LYRIC_LINES=100 npm run test:memory
```

`MEMORY_BENCHMARK_LYRIC_LINES` 默认 3，最多 300。报告记录歌词长度与默认内存优化状态，AMLL 报告文件名带 `optimized`。此基准覆盖暂停/进出页面场景；默认启用、旧设置兼容、连续播放、跳播、切歌与滚动由 `electron.focus-memory.spec.ts` 验证。不能仅凭暂停场景的层数推断正常播放的内存收益。

测试使用固定的 1200×800 Electron 窗口和隔离数据目录，先采集空闲基线，再重复三轮进入、退出 FocusMode。每个阶段默认等待 2 秒并取三次采样的中位数。终端会打印阶段汇总，完整 JSON 写入 `test-results/electron/<测试目录>/memory/`，文件名包含 `legacy` 或 `amll`，其中包括：

- Electron 的 Browser、Tab、GPU、Utility 等逐进程工作集；
- Windows 可用的逐进程 `privateBytes`，以及单独采集的 TaskbarHost 私有提交量、私有工作集和包含辅助进程的总提交量；
- 主进程私有内存、Renderer JS Heap、DOM/图片/Canvas 数量；
- FocusMode 相对空闲基线的增量，以及退出后的保留量；
- 最后一轮退出后额外等待 30 秒的回收阶段，避免把图形缓存延迟释放当作泄漏；
- OS、架构、Electron/Chromium/Node 版本、CPU 和总物理内存。

这是趋势基准，不设置固定 MB 通过线。Windows 优先观察 `privateBytes`，其他平台观察工作集；由于 macOS 内存压缩和平台进程统计口径不同，不应把任务管理器与活动监视器的总数直接作为回归结论。判断泄漏时重点查看多轮 `post-focus-*` 是否持续阶梯式增长。

Electron 的进程总量不包含通过 stdio 启动的 WPF TaskbarHost。报告 schema 2
另外输出 `taskbarPrivateMb`、`taskbarPrivateWorkingSetMb` 和
`totalWithTaskbarPrivateMb`；辅助进程按当前测试主进程 PID 筛选，不计入其他安装版。
Windows CIM 查询被权限限制时，报告明确标为 `unavailable`，汇总为 `null`，不会伪装成零占用。
私有工作集是驻留物理内存，不能和私有提交量直接相加。
`MEMORY_BENCHMARK_RECOVERY_MS` 可调整末尾回收等待（默认 30000，最大 60000）。

Windows TaskbarHost 保持未压缩的单文件程序集，避免启动时将压缩程序集解压到私有内存；
安装包仍使用原有压缩。独立 EXE 会增大，下载体积应以最终安装包测量为准。

可以通过环境变量增加稳定时间或轮数，例如：

```bash
npx cross-env MEMORY_BENCHMARK_CYCLES=8 MEMORY_BENCHMARK_SETTLE_MS=5000 npm run test:memory
```

构建产物没有变化时可执行 `npm run test:memory:run` 跳过重新构建。

## macOS 签名、公证与应用内更新

仓库已预留 Developer ID 分发流程；证书与凭证配置完成、真实安装包验收通过后，才能发布首个签名版本。
现有未签名下载包不会因为代码改动而自动获得更新能力。分发继续使用 GitHub Releases，当前目标为 Apple Silicon。

### 账号开通后配置

创建 **Developer ID Application** 证书，在钥匙串中导出包含私钥的 `.p12`，设置导出密码。
当前流程使用 Apple 账号、App 专用密码和 Team ID 向苹果公证，不使用账号登录密码。
在 GitHub 仓库的 Actions Secrets 中配置以下五项；本机构建时使用同名环境变量：

| Secret / 环境变量 | 内容 |
| --- | --- |
| `CSC_LINK` | `.p12` 的 Base64 内容；本机也可使用证书文件绝对路径 |
| `CSC_KEY_PASSWORD` | `.p12` 导出密码 |
| `APPLE_ID` | Apple 账号邮箱 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 账号生成的 App 专用密码 |
| `APPLE_TEAM_ID` | 开发者团队 ID |

证书、私钥和密码不要写进源码或提交到 Git。`.p12`、`.p8` 已加入忽略规则。
后续若改用 App Store Connect API Key，需要同时调整凭证检查脚本及工作流的环境变量映射。

### 构建与发布边界

```bash
npm run electron:build:mac:dev  # 无需证书，只生成本机调试用 .app，不公证、不启用更新
npm run electron:build:mac      # 正式签名、公证、附加票据，生成 DMG + ZIP；不上传、不发布
npm run release:verify -- mac  # 检查更新元数据、版本、产物完整性与 SHA-512
```

`electron:build:mac:adhoc` 与 `:dev` 使用相同的临时签名目录构建。普通开发仍用 `npm run electron:dev`。
项目锁定 electron-builder 26，签名选项位于 `build.mac`；不要直接套用 v27 的 `mac.sign` 配置。
Hardened Runtime 使用打包工具自带的 Electron 权限配置；原生模块、插件及系统歌词仍需在最终签名包中验收。

五项凭证都未配置时，发布工作流改用 `npm run electron:build:mac:unsigned` 生成未签名 DMG，
不上传 ZIP 和 `latest-mac.yml`，Windows 安装包与更新照常发布；只配置了一部分则直接失败。

正式构建在缺少任一凭证时失败。打包钩子要求签名、公证和 Hardened Runtime，签名后核验 Developer ID、
整个应用包的签名、公证票据及 Gatekeeper 评估；这些检查通过后才生成分发包。
更新元数据与文件校验通过后，CI 才上传构建产物。

发布工作流仍仅由推送 `v*` 标签触发，且标签必须等于 `v` 加 `package.json` 版本。
修改配置或本机构建不会触发发布。只有用户明确要求发布后才推标签；此前按 AGENTS.md 运行
`npm run check` 和相关 Electron 测试。GitHub Release 先作为草稿上传全部产物，再公开；
已有同名 Release 不会被删除或覆盖。上传失败留下的草稿需核对后另行处理，不能替换已公开版本的文件。

### 首次验收与用户迁移

1. 使用独立测试更新源构建两个递增版本 A、B，保持应用 ID `com.lyricsadapter.app` 和开发者签名身份连续。
   可通过 electron-builder 的 `publish` 配置覆盖更新源；应用直接读取生成的 `app-update.yml`，代码不再固定 GitHub 地址。
2. 浏览器下载 A 的 DMG，安装到“应用程序”。检查正常首次启动、断网启动、菜单栏歌词、元数据读写、插件与登录状态。
3. 向测试源提供 B 的 DMG、ZIP 及对应更新元数据。在 A 内检查更新，确认独立设置窗口的进度变化、重启安装和 B 的版本号。
4. 确认曲库、播放进度、音量、设置、插件与凭证保留；覆盖断网、下载失败、保存失败与重试。
   手动“重启并安装”会先等待主窗口保存并停止音频；保存失败或超时会取消这次安装请求。
5. 现有未签名用户需手动安装首个签名 DMG，之后才进入应用内升级路径。

0.x 构建继续接收预发布，稳定 1.x 及以后默认只接收正式版，带预发布后缀的构建接收预发布。
**现有 0.x 用户会接收 GitHub 预发布，不能用同一仓库的 Pre-release 标记隔离内部更新测试。**
首次仍使用全量下载；无需上传额外 blockmap。正式升级测试必须使用安装包，开发模式或普通 E2E 不等同于签名升级验收。

官方参考：[Developer ID 证书](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)、
[electron-builder 26 公证](https://www.electron.build/v26/docs/notarization/)、
[electron-builder 26 自动更新](https://www.electron.build/v26/docs/features/auto-update/)。

## 常见问题

- **9222 没有目标**：确认运行的是 `npm run electron:debug`，而不是 `electron:dev` 或 `dev`。
- **页面显示 502**：Vite 3000 未启动或被占用；查看启动终端中的第一条错误。
- **Agent 连到普通浏览器**：确认 MCP 使用了 `--cdp-endpoint http://127.0.0.1:9222`，并检查页面 URL 是 `app://localhost/index.html`。
- **只能看界面、不能断主进程**：这是正常边界；用 9229 的 Node Inspector。
- **端口已占用**：结束旧的 Electron/调试进程后重启，不要把调试端口暴露到外部网络。

远程调试端口可以读取和控制应用界面，只应在可信的本机开发环境中开启，任务完成后应退出调试实例。
