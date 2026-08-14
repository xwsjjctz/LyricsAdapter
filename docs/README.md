# LyricsAdapter 文档

本目录按用途分类。架构与开发文档优先反映当前实现；历史记录只用于追溯，不应视为现行设计。

## 架构

- [架构概览](./architecture/overview.md)
- [播放流程](./architecture/playback-flow.md)
- [持久化现状与 SQLite 迁移边界](./architecture/persistence-current-state.md)

## 开发与维护

- [渐进式重构路线图](./development/refactor-roadmap.md)
- [重构计划](./development/refactor-plan.md)
- [重构待办](./development/refactor-backlog.md)
- [性能优化待办](./development/performance-optimization-todo.md)

## 使用指南

- [验证 FLAC 文件元数据](./guides/verify-flac-metadata.md)

## 模块参考

[`reference/modules/`](./reference/modules/) 保存核心 service、hook 和类型的说明。这些文档中部分内容可能滞后于源码，修改相关模块时应同步核对。

## 历史归档

[`archive/`](./archive/) 收录旧 UI 方案、迁移尝试、一次性审查和修复记录。它们用于保留上下文，不代表当前实现。
