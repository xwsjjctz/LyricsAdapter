# 代理指令审计（2026-09-06）

本次修改面向 GPT-6 Astra 的已授权任务执行，保留项目边界，减少重复审批、
模式锁定和与改动无关的流程要求。只修改指导文件，没有修改业务实现或发布产物。

## 官方依据

- [GPT-6 Astra 模型指南](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)：
  对含糊规则更敏感；建议明确持续执行、用户指令优先、阻塞来源披露和适度验证。
- [AGENTS.md 指南](https://learn.chatgpt.com/docs/agent-configuration/agents-md)：
  按目录组织项目约束，保持规则简洁，说明适用条件与例外。
- [技能指南](https://learn.chatgpt.com/docs/build-skills)：
  名称和描述负责发现，完整技能与引用按需加载。

以下修改是结合本仓库的工程判断，不是官方要求使用特定文件布局或固定工作流程。

## 发现与处理

| 原问题 | 修改后的行为 |
| --- | --- |
| AGENTS 与 CLAUDE 的测试、路径、槽位、元数据和调试规则不同 | AGENTS 作为共享来源，CLAUDE 改为入口引用 |
| 启动应用需要额外请求，与必要调试相冲突 | 任务需要时可启动；只清理本任务启动且不再需要的进程 |
| 无条件要求推送，分支前缀容易与宿主约定冲突 | Git 交付规则以已授权动作及宿主约束为条件；发布标签仍需明确请求 |
| OpenSpec 的 8 个技能和 8 个命令重复完整流程 | 入口指向同一份 agent-workflow.md，按操作读取 |
| 探索模式禁止执行后来明确要求的实现 | 仅探索时保持只读；用户要求实现后直接转入执行 |
| 普通错误、设计修正或用户插话都导致暂停 | 修复可恢复错误并继续；只暂停真正受决策或授权阻塞的部分 |
| 归档始终重新选目标并重复确认 | 使用明确上下文；未授权的未完成归档与规格同步仍需决策 |
| 固定依赖不存在的询问工具、同步技能或子代理工具 | 使用可用工具；无法执行时报告具体缺口并继续独立工作 |
| 历史共改统计被当成当前架构及必改文件清单 | 删除过时统计；只追踪并修改实际受影响的 IPC 层和状态所有者 |
| React 模板强加 state、effect、logger | 仅在行为需要时添加，保留控制器边界 |
| logo 技能强制展示页、固定节奏、十次迭代结束与全套专项检查 | 按矢量、独立动画或应用集成选择交付；迭代上限改为复盘点，检查与风险对应 |
| logo 的默认提示与引用重新引入入口已放宽的规则 | 同步精简 UI 提示和四份引用，保留几何保真、减弱动态效果和确定性检查 |

## 修改范围与生效方式

可进入常规 Git 差异的文件：

- [AGENTS.md](../AGENTS.md)
- [CLAUDE.md](../CLAUDE.md)
- [共享工作流](agent-workflow.md)
- 本审计记录

已在本机修改、但被当前 `.gitignore` 忽略的文件：

- `.claude/skills/` 下五个 SKILL.md、`.claude/commands/opsx/` 下四个入口；
- `.claude/instincts/` 下四个规则文件与 `.claude/COMMIT_CONVENTION.md`；
- `.opencode/skills/` 下四个 SKILL.md 与 `.opencode/command/` 下四个入口；
- `.agents/skills/pixel2motion/SKILL.md`、`agents/openai.yaml`，以及其
  `references/` 下的 `html-delivery-template.md`、`motion-personality.md`、
  `twelve-principles-for-logos.md`、`reveal-patterns.md`。

忽略目录中的修改不会随普通提交同步到其他机器。本次保留原跟踪策略，
没有强制暂存、提交或修改全局技能。OpenSpec 工具重新生成入口时可能覆盖
本地修改；届时应继续让入口引用共享工作流，避免重新引入重复规则。

OpenSpec 的 16 个入口原共 2,500 行，入口加共享流程现为 285 行，减少约 89%。
`pixel2motion/SKILL.md` 从 238 行减到 109 行；保留既有脚本接口、授权声明和资源。
仓库外同名技能不在本次修改范围内。

## 保留与限制

- 保留播放器与曲库控制器的状态所有权、typed preload/desktop adapter 边界、
  元数据兼容行为，以及持久化和原生集成的针对性验证。
- 审阅了 PR 和 Release 两份 GitHub Actions 工作流。它们没有模型提示或人工
  审批步骤；保留现有跨平台质量检查、打包和发布触发逻辑，未运行远程工作流。
  Release 中已有的清理旧发布逻辑属于发布行为，应在发布流程专项修改中另行验证。
- `.codex/config.toml` 现有 `[agents] enabled = false` 原样保留：本次不将
  提示词自主性调整扩大为修改子代理配置或执行权限。
- 保留任务开始时已有的 DEBUGGING.md、FocusMode 和 E2E 未提交改动。

## 验证

- 10 个技能的 YAML frontmatter、名称、描述和允许字段检查通过。
- 8 个命令入口的 YAML、44 处本地文件/章节链接检查通过。
- AGENTS 中 npm 命令均存在于 package.json；CI 和技能 UI YAML 可解析。
- `git diff --check` 通过。仅修改指令文档，没有运行应用构建或业务测试。
- 官方 quick_validate.py 因环境缺少 PyYAML 无法直接运行；使用仓库已有
  js-yaml 完成对应结构检查，没有安装依赖或改动 lockfile。

另做了静态场景走查：仅探索、探索后要求实现、提案并实现、可恢复错误、
目标歧义、未完成归档、未授权规格同步、只需矢量、简单淡入及自交绘制。
确认普通继续执行与需要决策的情况均有对应条件。这是指令一致性检查，
没有独立模型行为评测，不能据此量化实际自主完成率。
