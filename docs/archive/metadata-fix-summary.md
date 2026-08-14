# 元数据写入问题修复总结

## 已完成的修复

### 1. 恢复PATH fallback机制 ✅
- **问题**：重构时移除了对系统PATH中二进制文件的fallback支持
- **修复**：添加`getBinaryPath()`函数，先尝试bundle二进制，再尝试系统PATH
- **影响**：修复了`writeFlacMetadataWithFfmpeg`和`writeFlacMetadataWithMetaflac`的调用

### 2. 修复coverBuffer丢失问题 ✅
- **问题**：ffmpeg失败fallback到metaflac时，丢失了coverBuffer
- **修复**：在fallback时传递完整的metadata对象（包含coverUrl）
- **影响**：确保封面图片能正确写入FLAC文件

### 3. 增强日志和错误处理 ✅
- **添加**：详细的日志输出，包括FFmpeg命令参数
- **添加**：在BrowseView中更详细的错误处理
- **目的**：便于调试和定位问题

### 4. 创建调试工具和文档 ✅
- **DEBUG_METADATA.md**：详细的元数据验证步骤
- **test-metadata-write.mjs**：测试元数据写入功能
- **test-ffmpeg-metadata.mjs**：测试FFmpeg功能

## 验证步骤

### 方法1：查看控制台日志
1. 启动应用：`npm run electron:dev`
2. 打开开发者工具：F12 → Console标签
3. 下载一首FLAC歌曲
4. 查找以下日志：
   ```
   [INFO] [BrowseView] Attempting to write metadata to file: /path/to/song.flac
   [INFO] [Main] Writing metadata to: /path/to/song.flac
   [INFO] [Main] File extension: .flac | Detected format: flac
   [INFO] [Main] FLAC metadata write using ffmpeg remux
   [INFO] [FFMPEG] Starting FLAC remux metadata write for: /path/to/song.flac
   [INFO] [FFMPEG] FFmpeg binary path: ffmpeg
   [INFO] [FFMPEG] Executing command: ffmpeg ...
   [INFO] [BrowseView] ✅ Metadata written successfully to file
   ```

### 方法2：验证文件中的元数据
打开终端，运行：
```bash
metaflac --list --block-type=VORBIS_COMMENT <下载的FLAC文件路径>
```

预期输出应包含：
- TITLE=歌曲名
- ARTIST=艺术家
- ALBUM=专辑名
- LYRICS=歌词内容

### 方法3：检查封面图片
```bash
metaflac --list --block-type=PICTURE <下载的FLAC文件路径>
```

## 如果元数据仍然没有被写入

### 需要提供的信息

1. **控制台日志**（完整的相关日志）
2. **metaflac命令输出**
3. **下载的FLAC文件路径**
4. **操作系统版本**

### 可能的原因

1. **二进制文件问题**：
   - 检查FFmpeg和metaflac是否可用：`ffmpeg -version` && `metaflac --version`
   - 查看日志中的`[BinaryUtils] Using ...`消息

2. **文件权限问题**：
   - 检查文件是否有写入权限
   - 检查下载目录是否有写入权限

3. **文件格式问题**：
   - 检查文件是否真的是FLAC格式
   - 查看日志中的`[Main] Detected format:`

4. **QQ Music文件问题**：
   - QQ Music的FLAC文件可能有特殊的格式
   - 查看日志中的ffmpeg/metaflac错误

## 已知限制

当前仅支持以下格式的元数据写入：
- ✅ MP3（使用node-id3）
- ✅ FLAC（使用ffmpeg + metaflac）
- ❌ M4A/MP4（不支持）
- ❌ WAV（不支持）

## 下一步

请按照上述步骤验证修复，并提供以下信息：

1. 控制台日志中的元数据写入相关信息
2. `metaflac --list`命令的输出
3. 是否看到任何错误消息

根据您提供的信息，我们可能需要进一步的调试或修复。
