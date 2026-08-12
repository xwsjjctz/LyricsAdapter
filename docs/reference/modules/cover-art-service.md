# `services/coverArtService.ts` — 封面艺术管理

## 文件概述

负责**封面图片的提取、缓存和管理**。能够从音频文件（MP3/FLAC/M4A）的元数据中解析封面，提取后保存到磁盘（Electron 环境）或生成 base64 内联封面。也提供占位封面和批量预加载功能。

```typescript
// 位置：./services/coverArtService.ts
// 依赖：desktopAdapter、logger
```

---

## 类 (Class)

### `CoverArtService`

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `processingQueue` | `Set<string>` | 正在处理中的 track ID 集合，用于防止并发重复提取 |

#### 方法

##### `getCoverUrl`

```typescript
async getCoverUrl(track: {
  id: string;
  filePath?: string;
  coverUrl?: string;
}): Promise<string>
```

- **说明：** 获取曲目的封面 URL（对外主入口）
- **逻辑：**
  1. 如果已有 `cover://` 协议 URL，直接返回（封面已缓存到磁盘）
  2. 如果 `filePath` 存在，触发后台异步封面提取（不等待结果）
  3. 返回已有 `coverUrl` 或占位封面
- **设计意图：** `getCoverUrl` 本身是即时的，封面提取在后台进行，下次加载时生效

##### `extractAndCacheCover`

```typescript
async extractAndCacheCover(trackId: string, filePath: string): Promise<string | null>
```

- **说明：** 从音频文件中提取封面并缓存到磁盘
- **流程：**
  1. 检查 `processingQueue`，防止同一 track 并发提取
  2. 通过 `DesktopAPI.readFile` 读取文件二进制
  3. 根据扩展名调用对应的解析方法（`extractCoverFromFLAC`/`extractCoverFromMP3`/`extractCoverFromM4A`）
  4. 如果提取到封面且 `saveCoverThumbnail` 可用，转为 base64 后保存到磁盘
- **错误处理：** 打日志不 throw，始终返回 `null` 或 `coverUrl`

##### `deleteCover`

```typescript
async deleteCover(trackId: string): Promise<void>
```

- **说明：** 删除指定的封面缓存（调用 `desktopAPI.deleteCoverThumbnail`）

##### `preloadCovers`

```typescript
async preloadCovers(tracks: Array<{ id: string; filePath?: string }>): Promise<void>
```

- **说明：** 批量预加载封面
- **逻辑：** 过滤有 `filePath` 的 track，并行调用 `extractAndCacheCover`
- **使用 `Promise.allSettled`：** 单个失败不影响其他

##### `blobToBase64`

```typescript
private async blobToBase64(blob: Blob): Promise<string>
```

- **说明：** 将 Blob 转为 base64 字符串（去除 `data:` 前缀）

##### `extractCoverFromBuffer`

```typescript
private async extractCoverFromBuffer(
  buffer: ArrayBuffer,
  ext: string
): Promise<{ blob: Blob; mimeType: string } | null>
```

- **说明：** 根据文件扩展名分发到不同的封面解析方法

##### `extractCoverFromFLAC`

```typescript
private extractCoverFromFLAC(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null
```

- **说明：** 从 FLAC 文件中提取封面
- **查找逻辑：** 遍历 metadata 块，找到 `blockType === 6`（PICTURE）

##### `parseFLACPictureBlock`

```typescript
private parseFLACPictureBlock(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null
```

- **说明：** 解析 FLAC PICTURE 块的具体数据
- **布局：** `图片类型(4B) + MIME长度(4B) + MIME字符串 + 描述长度(4B) + 描述 + 宽高色深(16B) + 图片数据长度(4B) + 图片数据`

##### `extractCoverFromMP3`

```typescript
private extractCoverFromMP3(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null
```

- **说明：** 从 MP3 文件的 ID3v2 标签中提取封面
- **查找逻辑：** 遍历 ID3v2 帧，找到 `APIC` 帧

##### `parseAPICFrame`

```typescript
private parseAPICFrame(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null
```

- **说明：** 解析 ID3v2 APIC 帧
- **支持编码处理：** ISO-8859-1/UTF-8 和 UTF-16 的描述文本

##### `extractCoverFromM4A`

```typescript
private extractCoverFromM4A(buffer: ArrayBuffer): { blob: Blob; mimeType: string } | null
```

- **说明：** 从 M4A/MP4 文件的 `covr` atom 中提取封面
- **搜索限制：** 只搜索前 10MB，避免大文件卡死
- **递归查找：** 支持 `moov → udta → meta → ilst → covr` 多层 atom 嵌套
- **MIME 类型判断：** `dataType === 14` 为 PNG，否则 JPEG

##### `decodeSynchsafe`

```typescript
private decodeSynchsafe(value: number): number
```

- **说明：** 解码 ID3v2 synchsafe integer

##### `getStringFromView`

```typescript
private getStringFromView(view: DataView, offset: number, length: number): string
```

- **说明：** 从 DataView 读取定长字符串

##### `getMimeTypeFromExt`

```typescript
private getMimeTypeFromExt(ext: string): string
```

- **说明：** 根据文件扩展名返回 MIME 类型

| 扩展名 | MIME |
|--------|------|
| `mp3` | `audio/mpeg` |
| `flac` | `audio/flac` |
| `m4a` | `audio/mp4` |
| `wav` | `audio/wav` |
| 其他 | `audio/flac` |

##### `getPlaceholderUrl`

```typescript
private getPlaceholderUrl(_trackId: string): string
```

- **说明：** 生成 SVG 占位封面（深色背景 + 音符符号）

```svg
<svg ...><rect fill="#222"/><text fill="#666">♪</text></svg>
```

---

## 导出实例 (Exported Instance)

```typescript
export const coverArtService = new CoverArtService();
```

---

## 设计要点

1. **后台异步提取**：`getCoverUrl` 立即返回已有封面或占位图，提取在后台执行，不阻塞 UI
2. **并发保护**：`processingQueue`（Set）防止同一 track 的重复提取
3. **完整的格式支持**：FLAC (PICTURE)、MP3 (APIC)、M4A (covr atom)
4. **磁盘缓存**：在 Electron 环境下通过 `saveCoverThumbnail` 将封面保存到 `userData/covers/`
5. **`cover://` 协议**：已缓存的封面通过自定义协议 URL 访问，避免 file:// 限制
6. **M4A 的递归 atom 搜索**：M4A 的封面可能嵌在多层 atom 嵌套中，需要递归搜索
7. **`Promise.allSettled` 批量加载**：preloadCovers 确保单个失败不影响整体
