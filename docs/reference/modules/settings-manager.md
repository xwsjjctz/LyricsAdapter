# `services/settingsManager.ts` — 设置管理

## 文件概述

提供应用设置的管理功能，使用 `localStorage` 进行持久化。管理三个设置项：下载路径、悬浮面板开关、背景模糊透明度。支持监听器模式，设置变更时通知所有订阅者。

```typescript
// 位置：./services/settingsManager.ts
// 依赖：logger
```

---

## 常量 (Constant)

| 常量名 | 值 | 说明 |
|--------|-----|------|
| `DOWNLOAD_PATH_KEY` | `'la_download_path'` | 下载路径的 localStorage key |
| `FLOATING_PANEL_KEY` | `'la_floating_panel'` | 悬浮面板开关的 localStorage key |
| `BG_BLUR_TRANS_KEY` | `'la_bg_blur_trans'` | 背景模糊透明度的 localStorage key |

所有 key 都以 `la_` 前缀避免与外部应用冲突。

---

## 类型别名 (Type Alias)

```typescript
type Listener = () => void;
```

- **说明：** 设置变更监听器类型，无参无返回值

---

## 类 (Class)

### `SettingsManager`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `downloadPath` | `string` | 下载路径（内存缓存） |
| `floatingPanel` | `boolean` | 悬浮面板开关 |
| `bgBlurTrans` | `number` | 背景模糊透明度 (0-1) |
| `listeners` | `Set<Listener>` | 监听器集合 |

#### 构造函数

```typescript
constructor()
```

- 调用 `this.loadFromStorage()` 从 `localStorage` 加载设置

#### 方法

##### `loadFromStorage`

```typescript
private loadFromStorage(): void
```

- **说明：** 从 `localStorage` 加载所有设置项到内存
- **逻辑：**
  - 读取 `DOWNLOAD_PATH_KEY`，无值时设为 `''`
  - 读取 `FLOATING_PANEL_KEY`，比较 `=== 'true'`
  - 读取 `BG_BLUR_TRANS_KEY`，校验是否为 0-1 之间的有效数字
- **错误处理：** 整体包裹在 `try-catch` 中，失败时打错误日志

##### `subscribe`

```typescript
subscribe(listener: Listener): () => void
```

- **说明：** 订阅设置变更通知
- **参数：** `listener: () => void` — 回调函数
- **返回值：** `() => void` — 取消订阅函数（调用后将 listener 从 Set 移除）

##### `notify`

```typescript
private notify(): void
```

- **说明：** 遍历 `listeners` Set 并逐个调用回调

##### `setDownloadPath`

```typescript
setDownloadPath(path: string): void
```

- **说明：** 设置下载路径
- **参数：** `path: string` — 路径字符串
- **无通知**（不调用 `notify()`）

##### `getDownloadPath`

```typescript
getDownloadPath(): string
```

- **说明：** 返回内存中的下载路径

##### `hasDownloadPath`

```typescript
hasDownloadPath(): boolean
```

- **说明：** 检查是否已设置下载路径（`!!this.downloadPath`）

##### `getFloatingPanel`

```typescript
getFloatingPanel(): boolean
```

- **说明：** 获取悬浮面板开关状态

##### `setFloatingPanel`

```typescript
setFloatingPanel(enabled: boolean): void
```

- **说明：** 设置悬浮面板开关
- **触发通知：** 调用 `notify()`

##### `getBgBlurTrans`

```typescript
getBgBlurTrans(): number
```

- **说明：** 获取背景模糊透明度

##### `setBgBlurTrans`

```typescript
setBgBlurTrans(value: number): void
```

- **说明：** 设置背景模糊透明度，自动限制在 [0, 1] 范围内
- **触发通知：** 调用 `notify()`

##### `ensureLoaded`

```typescript
async ensureLoaded(): Promise<void>
```

- **说明：** 兼容旧代码的异步初始化方法
- **当前实现：** No-op（设置已从 `localStorage` 同步加载，无需等待）

---

## 导出实例 (Exported Instance)

```typescript
export const settingsManager = new SettingsManager();
```

**说明：** 全局单例，在模块加载时自动初始化（构造函数从 `localStorage` 加载）。

---

## 设计要点

1. **localStorage 持久化**：所有设置同步写入 `localStorage`，读取时也有内存缓存，兼顾持久化和访问速度
2. **订阅/通知模式**：设置变更时通知组件重渲染（如 `FocusMode.tsx` 监听悬浮面板开关）
3. **输入校验**：`bgBlurTrans` 自动 clamp 到 [0, 1]，避免无效值
4. **前缀命名空间**：`la_` 前缀避免 key 冲突
5. **向后兼容**：`ensureLoaded()` 保留为 async 方法，兼容旧代码中 `await settingsManager.ensureLoaded()` 的调用模式
