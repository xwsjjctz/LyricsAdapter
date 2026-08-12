# `services/logger.ts` — 日志系统

## 文件概述

提供**分级日志系统**，替代 `console.log`。根据环境（开发/生产）自动控制日志输出级别，同时支持带作用域前缀的 ScopedLogger。

```typescript
// 位置：./services/logger.ts
// 依赖：无
```

---

## 枚举 (Enum)

### `LogLevel`

```typescript
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}
```

**说明：** 日志级别枚举，数值越大级别越高。

| 值 | 含义 | 何时输出 |
|----|------|---------|
| `DEBUG` (0) | 调试 | 仅开发环境 |
| `INFO` (1) | 信息 | 仅开发环境 |
| `WARN` (2) | 警告 | 所有环境 |
| `ERROR` (3) | 错误 | 所有环境 |
| `NONE` (4) | 关闭 | 不输出任何日志 |

---

## 函数 (Function)

### `getLogLevel`

```typescript
function getLogLevel(): LogLevel
```

- **说明：** 根据运行环境决定日志级别
- **判断逻辑：**
  1. 检查 `import.meta.env?.DEV`（Vite 开发模式）
  2. 检查 `window.__DEV__`（备用方式）
  3. 否则返回 `LogLevel.WARN`（生产环境只输出警告+错误）
- **返回值：** `LogLevel.DEBUG`（开发）或 `LogLevel.WARN`（生产）

---

## 类 (Class)

### `Logger`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `level` | `LogLevel` | 当前日志级别 |

#### 构造函数

```typescript
constructor()
```

- 初始化时调用 `getLogLevel()` 自动设置级别

#### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `setLevel` | `(level: LogLevel): void` | 手动设置日志级别 |
| `getLevel` | `(): LogLevel` | 获取当前日志级别 |
| `debug` | `(...args: LogArgs): void` | 调试日志，仅开发环境 |
| `info` | `(...args: LogArgs): void` | 信息日志，仅开发环境 |
| `warn` | `(...args: LogArgs): void` | 警告日志，所有环境 |
| `error` | `(...args: LogArgs): void` | 错误日志，所有环境 |
| `withScope` | `(scope: string): ScopedLogger` | 创建带作用域前缀的日志器 |

**各方法的执行逻辑：**

- **debug/info/warn/error**：检查 `this.level` 是否 <= 对应级别，若满足则调用 `console` 同名方法并添加 `[LEVEL]` 前缀
- **withScope**：返回 `ScopedLogger` 实例，自动在每个日志前添加 `[scope]` 前缀

---

### `ScopedLogger`

#### 构造函数

```typescript
constructor(private logger: Logger, private scope: string)
```

- `logger` — 底层 Logger 实例
- `scope` — 作用域名称

#### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `formatArgs` | `(args: LogArgs): LogArgs` | 在每个参数前插入 `[scope]` 前缀 |
| `debug/info/warn/error` | `(...args: LogArgs): void` | 转发到 logger，自动加前缀 |

---

## 导出实例 (Exported Instance)

```typescript
export const logger = new Logger();
```

**说明：** 全局单例 Logger 实例。所有模块应使用此实例而非 `console.log`。

---

## 使用示例

```typescript
import { logger } from '@/services/logger';

// 基本使用
logger.debug('Parsing file:', fileName);
logger.warn('File not found:', filePath);
logger.error('Unexpected error:', error);

// 带作用域前缀
const playbackLogger = logger.withScope('Playback');
playbackLogger.debug('Track changed');  // 输出: [DEBUG] [Playback] Track changed
```

---

## 设计要点

1. **环境感知**：通过 `import.meta.env.DEV` 自动区分开发/生产，无需手动配置
2. **统一出口**：所有模块统一使用此日志器，便于后续扩展（如文件日志、远程日志收集）
3. **级别控制**：生产环境只输出 `WARN` 及以上级别，避免泄露调试信息
4. **ScopedLogger**：通过 `withScope` 创建带作用域前缀的日志器，便于在复杂日志中追踪消息来源
5. **`LogArgs` 类型**：定义为 `unknown[]`，兼容任意数量任意类型的参数
