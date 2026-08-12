# `hooks/usePlayback.ts` — 播放控制核心 Hook

## 文件概述

这是**播放引擎的核心 Hook**，封装了 HTML `<audio>` 元素的所有交互逻辑：播放/暂停、上下曲切换、进度同步、音量控制（指数映射）、播放模式（顺序/随机/单曲循环）、懒加载音频文件、WebDAV 流媒体播放、元数据懒加载、Blob URL 生命周期管理等。

```typescript
// 位置：./hooks/usePlayback.ts
// 依赖：types、desktopAdapter、metadataCacheService、logger、webdavClient、constants/config
```

---

## 接口 (Interface)

### `UsePlaybackOptions`

```typescript
interface UsePlaybackOptions {
  tracks: Track[];
  setTracks: React.Dispatch<React.SetStateAction<Track[]>>;
  currentTrackIndex: number;
  setCurrentTrackIndex: (index: number | ((prev: number) => number)) => void;
  createTrackedBlobUrl: (blob: Blob | File) => string;
  revokeBlobUrl: (blobUrl: string) => void;
  onTrackSwitch?: () => void;
  initialCurrentTime?: number;
}
```

| 参数 | 类型 | 说明 |
|------|------|------|
| `tracks` | `Track[]` | 当前曲库列表 |
| `setTracks` | setter | 更新曲库列表 |
| `currentTrackIndex` | `number` | 当前播放索引 |
| `setCurrentTrackIndex` | setter | 设置播放索引（支持函数式更新） |
| `createTrackedBlobUrl` | `(blob) => string` | 创建受追踪的 Blob URL |
| `revokeBlobUrl` | `(url) => void` | 释放 Blob URL |
| `onTrackSwitch` | `() => void` | 切歌回调（可选） |
| `initialCurrentTime` | `number` | 初始播放位置（秒，可选） |

---

## Hook 函数 (Hook)

### `usePlayback`

```typescript
export function usePlayback({ tracks, setTracks, currentTrackIndex, setCurrentTrackIndex, createTrackedBlobUrl, revokeBlobUrl, onTrackSwitch, initialCurrentTime = 0 }: UsePlaybackOptions) {
```

#### 状态 (State)

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `isPlaying` | `boolean` | `false` | 是否正在播放 |
| `currentTime` | `number` | `0` | 当前播放进度（秒） |
| `volume` | `number` | `UI.DEFAULT_VOLUME` | 音量 (0-1) |
| `playbackMode` | `'order' \| 'shuffle' \| 'repeat-one'` | `'order'` | 播放模式 |

#### Refs (useRef)

| Ref | 类型 | 说明 |
|-----|------|------|
| `audioRef` | `HTMLAudioElement \| null` | 绑定的 `<audio>` 元素 |
| `shouldAutoPlayRef` | `boolean` | 切歌后是否需要自动播放 |
| `waitingForCanPlayRef` | `boolean` | 是否在等待 'canplay' 事件后再播放 |
| `prevAudioUrlRef` | `string \| null` | 上一个音频 URL（用于清理） |
| `audioUrlReadyRef` | `boolean` | 当前音频 URL 是否已就绪 |
| `persistedTimeRef` | `number` | 持久化的播放位置（外部控制） |
| `lastNonZeroVolumeRef` | `number` | 最后一次非零音量值（用于静音切换） |
| `currentTrackIndexRef` | `number` | currentTrackIndex 的同步 ref |
| `restoredTimeRef` | `number` | 需要恢复的播放位置 |
| `hasRestoredRef` | `boolean` | 是否已完成位置恢复 |
| `lastTrackIdRef` | `string \| undefined` | 上一次的 track ID（用于检测切歌） |

#### 派生值 (Derived Values)

| 变量 | 说明 |
|------|------|
| `currentTrack` | 当前播放的 Track 对象，或 `null`（通过 `useMemo` 计算） |

---

#### 方法详情

##### `getRandomIndex`

```typescript
const getRandomIndex = useCallback((exclude: number, length: number) => number)
```

- **说明：** 随机选择不等于 `exclude` 的索引（随机播放模式用）
- **边界处理：** `length <= 1` 时返回 `exclude`

##### `linearToExponentialVolume`

```typescript
const linearToExponentialVolume = useCallback((linearVolume: number): number => number)
```

- **说明：** 将线性音量映射到指数空间：`actual = linear²`
- **原理：** 人耳对音量的感知是对数级的，指数映射使调节更自然

##### `setAudioRef`

```typescript
const setAudioRef = useCallback((node: HTMLAudioElement | null) => void)
```

- **说明：** 绑定 `<audio>` 元素的 callback ref
- **额外操作：** 绑定后设置音量

##### `switchToTrackIndex`

```typescript
const switchToTrackIndex = useCallback((nextIndex: number) => void)
```

- **说明：** 切换到指定索引（不触发自动播放）
- **触发：** `onTrackSwitch?.()`

##### `togglePlay`

```typescript
const togglePlay = useCallback(() => void)
```

- **说明：** 切换播放/暂停
- **特殊逻辑：** 播放失败时 catch 错误并打日志，不抛出异常

##### `handleTimeUpdate`

```typescript
const handleTimeUpdate = useCallback(() => void)
```

- **说明：** `<audio>` 的 `timeupdate` 事件处理器

##### `handleLoadedMetadata`

```typescript
const handleLoadedMetadata = useCallback(() => void)
```

- **说明：** `<audio>` 的 `loadedmetadata` 事件处理器
- **功能：**
  1. 恢复播放进度（`restoredTimeRef` 的值调整到 `currentTime`）
  2. 非 WebDAV 曲目：读取实际时长并更新到 `Track.duration`

##### `getNextTrackIndex`

```typescript
const getNextTrackIndex = useCallback((direction: 'forward' | 'backward'): number)
```

- **说明：** 计算下一首曲目索引
- **模式逻辑：**
  - `shuffle` — 随机选择不等于当前的索引
  - `forward` — `(current + 1) % length`（循环）
  - `backward` — `(current - 1 + length) % length`（循环）

##### `handleTrackEnded`

```typescript
const handleTrackEnded = useCallback(() => void)
```

- **说明：** `<audio>` 的 `ended` 事件处理器
- **`repeat-one` 模式：** 重设 `currentTime = 0` 并继续播放
- **其他模式：** 前进到下一首（`getNextTrackIndex('forward')`）

##### `loadAudioFileForTrack`

```typescript
const loadAudioFileForTrack = useCallback(async (track: Track): Promise<Track>)
```

- **说明：** 懒加载音频文件：通过 `DesktopAPI.readFile` 读取文件内容，创建 Blob URL
- **跳过条件：** 已有 `audioUrl` 或无 `filePath` 时直接返回
- **用途：** 应用初始启动时只有 `filePath`，第一次播放时才会读取文件

##### `skipForward` / `skipBackward`

```typescript
const skipForward = useCallback(() => void)
const skipBackward = useCallback(() => void)
```

- **说明：** 上下曲切换，设置 `shouldAutoPlayRef = true`

##### `handleSeek`

```typescript
const handleSeek = useCallback((time: number) => void)
```

- **说明：** 拖动进度条到指定位置

##### `handleVolumeChange`

```typescript
const handleVolumeChange = useCallback((vol: number) => void)
```

- **说明：** 音量变化处理，保存非零音量值供静音恢复用

##### `handleToggleMute`

```typescript
const handleToggleMute = useCallback(() => void)
```

- **说明：** 静音/恢复静音切换，`lastNonZeroVolumeRef` 记录上次非零音量

##### `handleTogglePlaybackMode`

```typescript
const handleTogglePlaybackMode = useCallback(() => void)
```

- **说明：** 轮换播放模式：`order → shuffle → repeat-one → order`

##### `handleCanPlay`

```typescript
const handleCanPlay = useCallback(() => void)
```

- **说明：** `<audio>` 的 `canplay` 事件处理器
- **用途：** 当推测性播放失败时，在 `canplay` 后重试播放

##### `handleAudioError`

```typescript
const handleAudioError = useCallback((e: React.SyntheticEvent<HTMLAudioElement>) => void)
```

- **说明：** `<audio>` 的 `error` 事件处理器
- **错误处理策略：**
  - 空 src 忽略
  - WebDAV 曲目报错 → 清除 CDN 缓存下次重试
  - 本地曲目 Blob URL 失效 → 清空 `audioUrl` 触发重新加载
  - 其他错误 → 取消自动播放

##### `selectTrack`

```typescript
const selectTrack = useCallback((idx: number) => void)
```

- **说明：** 选择并播放指定曲目（对外公开的接口方法）
- **行为：** 设置 autoplay → 切换索引 → 标记为播放中

---

#### 副作用 (useEffect)

##### 切歌时加载音频

```typescript
useEffect(() => {
  if (!audioRef.current || !currentTrack) return;
  // ...
}, [currentTrackIndex, currentTrack, ...]);
```

**说明：** 监听 `currentTrackIndex` 变化，切换曲目时：
1. **WebDAV 曲目**：通过 `webdavClient.getCdnUrl` 获取 CDN 流 URL
2. **本地懒加载**：若 `audioUrl` 为空但有 `filePath`，调用 `loadAudioFileForTrack`
3. **无可用 URL**：暂停播放
4. **直接播放**：已有 `audioUrl` 且需要自动播放 → 调用 `audio.play()`
5. 播放失败 → 设置 `waitingForCanPlayRef`，等待 `canplay` 事件

##### 元数据惰性补全

```typescript
useEffect(() => {
  if (!currentTrack) return;
  // ...
}, [currentTrack?.id]);
```

**说明：** 切歌后在空闲时从 `metadataCacheService` 补全缺失的元数据（歌词、时长、标题等）。
- 使用 `requestIdleCallback` 避免影响播放帧率
- 若浏览器不支持 `requestIdleCallback`，回退到 `setTimeout(600ms)`

##### Blob URL 清理

```typescript
useEffect(() => {
  // 切歌后释放前一个 Blob URL
  revokeBlobUrl(prevAudioUrl);
}, [currentTrack?.audioUrl]);
```

##### 音量同步

```typescript
useEffect(() => {
  if (audioRef.current) {
    audioRef.current.volume = linearToExponentialVolume(volume);
  }
}, [volume]);
```

---

## Hook 返回值

| 返回值 | 类型 | 说明 |
|--------|------|------|
| `audioRef` | `MutableRefObject` | 音频元素 Ref |
| `setAudioRef` | callback ref | 绑定 `<audio>` 元素 |
| `currentTrack` | `Track \| null` | 当前曲目 |
| `isPlaying` / `setIsPlaying` | state | 播放状态 |
| `currentTime` / `setCurrentTime` | state | 当前进度 |
| `volume` / `setVolume` | state | 音量 |
| `playbackMode` / `setPlaybackMode` | state | 播放模式 |
| `togglePlay` | fn | 播放/暂停切换 |
| `skipForward` / `skipBackward` | fn | 上下曲 |
| `handleSeek` | fn | 拖动进度 |
| `handleTimeUpdate` | fn | timeupdate 回调 |
| `handleLoadedMetadata` | fn | loadedmetadata 回调 |
| `handleTrackEnded` | fn | 曲目播放结束 |
| `handleCanPlay` | fn | 可播放回调 |
| `handleVolumeChange` | fn | 音量变化 |
| `handleToggleMute` | fn | 静音切换 |
| `handleTogglePlaybackMode` | fn | 播放模式切换 |
| `handleAudioError` | fn | 音频错误处理 |
| `selectTrack` | fn | 选择曲目 |
| `loadAudioFileForTrack` | fn | 懒加载音频文件 |
| `waitingForCanPlayRef` / `audioUrlReadyRef` / `persistedTimeRef` / `shouldAutoPlayRef` | refs | 引用值（外部读） |

---

## 设计要点

1. **懒加载音频**：`loadAudioFileForTrack` 仅在播放时才读取文件，启动时只存路径
2. **指数音量映射**：`linearToExponentialVolume` 实现 `actual = linear²` 映射，音量调节更符人耳感知
3. **shuffle 随机播放**：`getRandomIndex` 用 `while (next === exclude)` 防止连续两次播放同一曲目
4. **WebDAV 流媒体**：通过 `webdavClient.getCdnUrl` 获取 CDN 播放 URL，支持 Range 请求流式播放
5. **推测性播放 + canplay 回退**：先尝试 `play()`，失败后在 `canplay` 事件时重试
6. **元数据惰性补全**：`requestIdleCallback`（回退 `setTimeout`）在空閒时补全歌词和元数据
7. **Blob URL 生命周期管理**：切歌时自动释放上一个 Blob URL，避免内存泄漏
8. **大量 refs**：由于 useEffect 闭包捕获问题，使用 refs 同步最新的值（`currentTrackIndexRef`、`lastTrackIdRef` 等）
