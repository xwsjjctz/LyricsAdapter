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

测试使用固定的 1200×800 Electron 窗口和隔离数据目录，先采集空闲基线，再重复三轮进入、退出 FocusMode。每个阶段默认等待 2 秒并取三次采样的中位数。终端会打印阶段汇总，完整 JSON 写入 `test-results/memory/`，文件名包含 `legacy` 或 `amll`，其中包括：

- Electron 的 Browser、Tab、GPU、Utility 等逐进程工作集；
- Windows 可用的逐进程 `privateBytes`；
- 主进程私有内存、Renderer JS Heap、DOM/图片/Canvas 数量；
- FocusMode 相对空闲基线的增量，以及退出后的保留量；
- OS、架构、Electron/Chromium/Node 版本、CPU 和总物理内存。

这是趋势基准，不设置固定 MB 通过线。Windows 优先观察 `privateBytes`，其他平台观察工作集；由于 macOS 内存压缩和平台进程统计口径不同，不应把任务管理器与活动监视器的总数直接作为回归结论。判断泄漏时重点查看多轮 `post-focus-*` 是否持续阶梯式增长。

可以通过环境变量增加稳定时间或轮数，例如：

```bash
npx cross-env MEMORY_BENCHMARK_CYCLES=8 MEMORY_BENCHMARK_SETTLE_MS=5000 npm run test:memory
```

构建产物没有变化时可执行 `npm run test:memory:run` 跳过重新构建。

## 常见问题

- **9222 没有目标**：确认运行的是 `npm run electron:debug`，而不是 `electron:dev` 或 `dev`。
- **页面显示 502**：Vite 3000 未启动或被占用；查看启动终端中的第一条错误。
- **Agent 连到普通浏览器**：确认 MCP 使用了 `--cdp-endpoint http://127.0.0.1:9222`，并检查页面 URL 是 `app://localhost/index.html`。
- **只能看界面、不能断主进程**：这是正常边界；用 9229 的 Node Inspector。
- **端口已占用**：结束旧的 Electron/调试进程后重启，不要把调试端口暴露到外部网络。

远程调试端口可以读取和控制应用界面，只应在可信的本机开发环境中开启，任务完成后应退出调试实例。
