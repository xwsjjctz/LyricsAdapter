# `services/metadataService.ts` — 音频元数据解析引擎

## 文件概述

这是项目中**最复杂的核心服务**，负责解析音频文件的元数据（标题、艺术家、专辑、时长、歌词、封面）。支持三种格式（MP3/ID3v2、FLAC/Vorbis、M4A/MP4），采用 **Web Worker + 主线程双级解析策略**，同时包含 LRU 缓存和并发请求去重。

```typescript
// 位置：./services/metadataService.ts
// 依赖：logger
```

---

## 接口 (Interface)

### `CoverNeededRange`

```typescript
export interface CoverNeededRange {
  offset: number;
  length: number;
}
```

- **说明：** 标识封面数据在文件中的位置偏移和长度，用于后续按需读取

### `BufferParseContext`

```typescript
export interface BufferParseContext {
  coverNeededRange?: CoverNeededRange | undefined;
  vorbisCommentNeededRange?: CoverNeededRange | undefined;
  bufferOffset: number;
}
```

- **说明：** 缓冲区解析上下文，记录封面或 Vorbis 注释在文件中的位置，供后续分片读取

### `ParsedMetadata`

```typescript
export interface ParsedMetadata {
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  lyrics: string;
  syncedLyrics?: { time: number; text: string }[] | undefined;
  audioUrl: string;
  file: File;
}
```

- **说明：** 完整的解析结果，包含所有元数据字段

### `WorkerMetadataResult`

```typescript
interface WorkerMetadataResult {
  title?: string | undefined;
  artist?: string | undefined;
  album?: string | undefined;
  lyrics?: string | undefined;
  syncedLyrics?: { time: number; text: string }[] | undefined;
  coverData?: ArrayBuffer | undefined;
  coverMime?: string | undefined;
}
```

- **说明：** Web Worker 返回的元数据结果（不含 Blob URL，使用 ArrayBuffer 传输封面数据）

---

## 模块级变量 (Module-level Variables)

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `metadataWorker` | `Worker \| null` | 单例 Web Worker 实例 |
| `metadataWorkerSeq` | `number` | 递增消息 ID 序列 |
| `metadataWorkerPending` | `Map<number, ...>` | 待处理的 Worker 请求（ID → Promise） |
| `metadataWorkerCache` | `Map<string, WorkerMetadataResult>` | LRU 缓存，上限 50 条 |
| `metadataWorkerInFlight` | `Map<string, Promise<...>>` | 正在处理中的请求去重 |
| `METADATA_CACHE_LIMIT` | `number` | 缓存上限常量：50 |

---

## 辅助函数 (Helper Functions)

### `getWorkerCacheKey`

```typescript
function getWorkerCacheKey(file: File): string
```

- **说明：** 生成 Worker 缓存的 key：`${fileName}|${fileSize}|${lastModified}`
- **用途：** 相同文件（同名同大小同修改时间）跳过重复解析

### `setWorkerCache`

```typescript
function setWorkerCache(key: string, value: WorkerMetadataResult): void
```

- **说明：** 设置 LRU 缓存条目，超限时删除最旧条目
- **LRU 策略：** 每次写入时先 `delete(key)` 再 `set(key)`，保证新条目在迭代器末尾

### `getMetadataWorker`

```typescript
function getMetadataWorker(): Worker | null
```

- **说明：** 获取或创建单例 Web Worker
- **初始化：**
  1. 判断 `typeof Worker !== 'undefined'`（环境兼容性检查）
  2. 创建 `new Worker('./workers/metadataWorker.ts', { type: 'module' })`
  3. 注册 `onmessage` 处理：根据 `id` 查找 `metadataWorkerPending` 并 resolve
  4. 注册 `onerror` 处理：reject 所有待处理请求
- **设计意图：** 懒初始化，Worker 创建失败（如浏览器不支持）返回 null

### `parseMetadataInWorker`

```typescript
async function parseMetadataInWorker(file: File): Promise<WorkerMetadataResult | null>
```

- **说明：** 在 Web Worker 中解析元数据
- **流程：**
  1. 检查 Worker 可用性，不可用返回 null
  2. 检查 LRU 缓存命中，命中直接返回
  3. 检查是否已有相同文件在解析中（in-flight 去重），有则共享 Promise
  4. 读取文件 ArrayBuffer，通过 `postMessage` 发送到 Worker
  5. 返回结果并写入缓存

### `getStringFromView`

```typescript
function getStringFromView(view: DataView, offset: number, length: number): string
```

- **说明：** 从 DataView 中读取定长字符串，跳过 0 值字节
- **参数：** `view` — DataView；`offset` — 起始偏移；`length` — 字节长度

### `decodeSynchsafe`

```typescript
function decodeSynchsafe(value: number): number
```

- **说明：** 解码 ID3v2 的 synchsafe integer（7位有效 + 1位标识位）
- **原理：** 4 个字节各取低 7 位拼接，ID3v2.4 使用此编码表示大小

### `decodeTextFrame`

```typescript
function decodeTextFrame(buffer: ArrayBuffer): string
```

- **说明：** 解码 ID3v2 文本帧（T*** 帧）
- **支持编码：**
  - encoding 0: ISO-8859-1
  - encoding 1/2: UTF-16（含 BOM）
  - encoding 3: UTF-8
- **后处理：** 移除空字符、BOM、U+FFFF，trim

### `parseUSLTFrame`

```typescript
function parseUSLTFrame(buffer: ArrayBuffer): string
```

- **说明：** 解析 ID3v2 的 USLT（Unsynchronized Lyrics）帧
- **结构：** `编码(1B) + 语言(3B) + 内容描述(空终止) + 歌词文本`
- **返回值：** 纯文本歌词

### `decodePictureFrame`

```typescript
function decodePictureFrame(buffer: ArrayBuffer): { coverUrl: string; imageDataOffset: number }
```

- **说明：** 解析 ID3v2 的 APIC（Attached Picture）帧
- **结构：** `编码(1B) + MIME类型(空终止) + 图片类型(1B) + 描述(空终止) + 图片数据`
- **返回值：** 包含 `URL.createObjectURL` 生成的 Blob URL 和图片数据偏移

### `parseID3v2`

```typescript
function parseID3v2(buffer: ArrayBuffer, ctx?: BufferParseContext): Partial<ParsedMetadata>
```

- **说明：** ID3v2 解析器（支持 v2.3 和 v2.4）
- **解析的帧类型：**
  - `TIT2` — 标题
  - `TPE1` — 艺术家
  - `TALB` — 专辑
  - `TLEN` — 时长（毫秒转秒）
  - `USLT` — 歌词（通过 `parseUSLTFrame` + `parseLRCLyrics`）
  - `SYLT` — 同步歌词（通过 `parseSYLTFrame`）
  - `APIC` — 封面（通过 `decodePictureFrame`）
- **版本差异处理：** v2.3 使用常规 32 位大小，v2.4 使用 synchsafe 大小

### `parseSYLTFrame`

```typescript
function parseSYLTFrame(buffer: ArrayBuffer): { time: number; text: string }[]
```

- **说明：** 解析 ID3v2 的 SYLT（Synchronized Lyrics）帧
- **时间戳格式：**
  - 1: MPEG 帧（近似除以 1000）
  - 2: 毫秒
  - 其他: 默认毫秒

### `parseMP4`

```typescript
function parseMP4(_buffer: ArrayBuffer): Partial<ParsedMetadata>
```

- **说明：** MP4/M4A 元数据解析（简化实现）
- **当前状态：** 返回空对象（需要完整的 atom 解析），实际 MP4 元数据由 Web Worker 处理

### `parseFLAC`

```typescript
function parseFLAC(buffer: ArrayBuffer, ctx?: BufferParseContext): Partial<ParsedMetadata>
```

- **说明：** FLAC 元数据解析器
- **解析的 Block 类型：**
  - `blockType === 0`（STREAMINFO）— 从 sample rate 和 total samples 计算时长
  - `blockType === 4`（VORBIS_COMMENT）— 歌词、标题、艺术家等
  - `blockType === 6`（PICTURE）— 封面图片
- **分片处理：** 若数据截断，在 `ctx` 中记录偏移供后续按需读取

### `parseVorbisComment`

```typescript
export function parseVorbisComment(buffer: ArrayBuffer): Partial<ParsedMetadata>
```

- **说明：** 解析 FLAC 的 VORBIS_COMMENT 块
- **支持的字段：** TITLE、ARTIST、ALBUM、LYRICS/UNSYNCEDLYRICS/SYNCEDLYRICS、COMMENT（含 LRC 时间戳时也作为歌词）
- **字段名不区分大小写**（统一 `.toUpperCase()`）

### `parseLRCLyrics`

```typescript
export function parseLRCLyrics(lrc: string): { plainText: string; syncedLyrics?: { time: number; text: string }[] | undefined }
```

- **说明：** 解析 LRC 格式歌词
- **支持的时间戳格式：** `[mm:ss.xx]`、`[mm:ss]`、`[hh:mm:ss]`
- **特殊处理：**
  - 跳过内容为 `//` 的占位行
  - 同一声明行的多个时间戳会生成多条歌词条目
  - 无时间戳的纯文本行保留在 `plainText`
  - 最终按时间排序

### `parseFLACPicture`

```typescript
function parseFLACPicture(buffer: ArrayBuffer): string
```

- **说明：** 解析 FLAC PICTURE 块中的封面图片
- **结构：** `图片类型(4B) + MIME长度(4B) + MIME + 描述长度(4B) + 描述 + 宽/高/色深/颜色数(16B) + 图片数据长度(4B) + 图片数据`

### `getAudioDuration`

```typescript
function getAudioDuration(file: File): Promise<number>
```

- **说明：** 通过隐藏 `<audio>` 元素获取音频时长
- **超时：** 2 秒超时，防止某些损坏文件卡死
- **使用 `{ once: true }` 事件监听器：** 避免内存泄漏

---

## 导出函数 (Exported Functions)

### `parseMetadataFromBuffer`

```typescript
export function parseMetadataFromBuffer(
  buffer: ArrayBuffer,
  fileName: string
): Partial<ParsedMetadata> & {
  coverNeededRange?: CoverNeededRange | undefined;
  vorbisCommentNeededRange?: CoverNeededRange | undefined;
}
```

- **说明：** 从二进制 Buffer 中解析元数据（无封面提取版）
- **根据文件扩展名分发到不同解析器**
- **返回值：** 额外包含 `coverNeededRange` 和 `vorbisCommentNeededRange`

### `parseCoverFromRange`

```typescript
export function parseCoverFromRange(
  buffer: ArrayBuffer,
  fileName: string,
  _rangeOffset: number
): string
```

- **说明：** 从文件指定范围读取封面数据
- **用途：** 在首次解析无法获取完整封面数据时，通过 Range 请求读取封面部分

### `parseAudioFile`（核心入口）

```typescript
export async function parseAudioFile(file: File): Promise<ParsedMetadata>
```

- **说明：** 音频元数据解析的主入口
- **流程：**
  1. 创建 Blob URL 作为默认 `audioUrl`
  2. 尝试 Web Worker 解析（`parseMetadataInWorker`）
  3. Worker 可用 → 使用 Worker 结果
  4. Worker 不可用/失败 → 降级到主线程解析（`parseID3v2`/`parseFLAC`/`parseMP4`）
  5. 并行获取音频时长（`getAudioDuration`，2 秒超时）
  6. 组合最终结果返回
- **默认值：** 标题从文件名推断，艺术家/专辑设为 "Unknown"，封面用 picsum.photos 占位

---

## 设计要点

1. **双级解析（Worker + 主线程）**：优先使用 Web Worker 避免阻塞 UI，Worker 不可用时优雅降级
2. **LRU 缓存**：内存缓存限制 50 条，避免重复解析同一文件
3. **In-flight 去重**：同一文件正在解析时，后续请求共享同一个 Promise
4. **全面的格式支持**：ID3v2.3/v2.4、FLAC Vorbis Comment、MP4 原子结构
5. **歌词解析双格式**：LRC 文本 + ID3 SYLT 同步歌词
6. **封面编码处理**：支持多种编码（ISO-8859-1、UTF-8、UTF-16）的帧描述
7. **错误容错**：所有解析函数均有 try-catch，单帧解析失败不影响整体结果
