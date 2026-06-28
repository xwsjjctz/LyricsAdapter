# Contributing Guide

欢迎贡献代码！请遵循以下规范以确保项目质量。

## 开发环境

```bash
# 安装依赖
npm install

# 启动 Electron 开发模式
npm run electron:dev

# 类型检查
npx tsc --noEmit

# 构建
npm run build
```

## Git 工作流

### 分支策略

提交代码请先确定好范围，然后创建分支。

| 类型 | 分支格式 | 说明 |
|------|----------|------|
| 新功能 | `feature/<short-desc>` | 新功能开发 |
| Bug 修复 | `fix/<short-desc>` | 错误修复 |
| 重构 | `refactor/<short-desc>` | 代码重构 |
| 文档 | `docs/<short-desc>` | 文档更新 |
| 性能优化 | `perf/<short-desc>` | 性能改进 |

**描述使用英文小写，单词间用短横线连接**，例如 `feature/add-lyrics-editor`。

### 开发流程

1. 从 `master` 创建新分支：
   ```bash
   git checkout master
   git pull
   git checkout -b feature/my-feature
   ```

2. 在分支上开发和提交：
   ```bash
   git add <files>
   git commit -m "feat: 添加xxx功能"
   git push -u origin feature/my-feature
   ```

3. 完成后创建 Pull Request 合并回 `master`。

## 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)，可以使用中文描述。

### 格式

```
<type>: <简短描述>

<详细说明>
```

- 首行不超过 72 字符
- 首行用中文简述做了什么
- 详细说明使用 `  - `（2空格 + 短横线）格式
- 每条改动单独一行

### 类型

| 前缀 | 使用场景 |
|------|----------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `refactor:` | 代码重构 |
| `docs:` | 文档更新 |
| `chore:` | 构建/依赖/配置等杂项 |
| `perf:` | 性能优化 |
| `ci:` | CI/CD 配置变更 |

### 示例

```
feat: 添加元数据编辑功能

- 新增 MetadataView 组件
- 支持编辑 TITLE、ARTIST、ALBUM 字段
```

## 代码规范

### 文件组织

- **小文件优先**：单个文件 200-400 行，不超过 800 行
- **按功能组织**：按功能/领域分组，不按类型
- **高内聚低耦合**：相关逻辑放在一起，无关逻辑拆出去

### 不可变性

始终创建新对象，不要修改已有对象：

```typescript
// ❌ 错误：直接修改
obj.name = 'new name'

// ✅ 正确：返回新副本
{ ...obj, name: 'new name' }
```

### 错误处理

- 每个层级都要处理错误
- UI 层给出友好的用户提示
- 后端输出详细的错误日志
- 不要静默吞掉错误

### 输入验证

- 所有用户输入必须验证
- 尽早失败，给出清晰错误信息
- 不信任任何外部数据

## 桌面端适配

- 桌面功能通过 `window.electron` bridge 调用
- 始终使用 `getDesktopAPI()` / `isDesktop()` 而不是直接访问 `window.electron`
- 浏览器模式（`npm run dev`）下部分功能受限

## Pull Request 流程

1. 确保分支名符合规范
2. 确保提交信息符合规范
3. 创建 PR → `master`
4. 等待 CI 类型检查通过
5. 至少 1 人 Review 后合并

## 发布

Tag 发布由维护者执行，日常开发不需要打 tag。格式为 `v0.x.x`（预发布）或 `v1.x.x`（正式发布）。
