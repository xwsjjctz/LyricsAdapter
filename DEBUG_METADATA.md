# 如何验证FLAC文件中的元数据

## 问题说明

您报告说下载的歌曲元数据只是在播放器中显示，没有内嵌到音频文件中。

## 验证步骤

### 方法1：使用命令行工具（推荐）

1. 打开终端
2. 找到下载的FLAC文件路径
3. 运行以下命令查看文件中的元数据：

```bash
metaflac --list --block-type=VORBIS_COMMENT <文件路径>
```

例如：
```bash
metaflac --list --block-type=VORBIS_COMMENT ~/Music/歌曲名.flac
```

### 方法2：使用FFmpeg

```bash
ffprobe -v quiet -print_format json -show_format -show_streams <文件路径>
```

### 方法3：使用图形化工具

- Mac: 使用 **VLC** 或 **Audacity** 打开文件，查看属性
- Windows: 使用 **MP3Tag** 或 **Foobar2000** 查看元数据

## 检查清单

✓ 文件中是否有 TITLE 标签？
✓ 文件中是否有 ARTIST 标签？
✓ 文件中是否有 ALBUM 标签？
✓ 文件中是否有 LYRICS 标签？
✓ 文件中是否有 PICTURE 块（封面）？

## 预期结果

如果元数据写入成功，你应该能看到类似这样的输出：

```
METADATA block #0
  type: 4 (VORBIS_COMMENT)
  is last: false
  length: 123
  comments: 5
    comment[0]: TITLE=歌曲名
    comment[1]: ARTIST=艺术家
    comment[2]: ALBUM=专辑名
    comment[3]: LYRICS=歌词内容
```

## 如果元数据缺失

请提供以下信息以便调试：

1. **控制台日志**：在应用运行时，打开开发者工具（F12），查看Console标签
2. **错误信息**：任何红色或黄色的错误消息
3. **文件路径**：下载的FLAC文件的完整路径
4. **测试结果**：运行上述命令的输出结果

## 控制台日志示例

元数据写入时，你应该能看到类似这样的日志：

```
[INFO] [Main] Writing metadata to: /path/to/song.flac
[INFO] [Main] Metadata: {title: "歌曲名", artist: "艺术家", ...}
[INFO] [Main] File extension: .flac | Detected format: flac
[INFO] [Main] FLAC metadata write using ffmpeg remux
[INFO] [FFMPEG] Starting FLAC remux metadata write for: /path/to/song.flac
[INFO] [FFMPEG] FFmpeg binary path: ffmpeg
[INFO] [FFMPEG] Metadata to write: {...}
[INFO] [FFMPEG] Executing command: ffmpeg ...
[INFO] [FFMPEG] ✓ FLAC metadata remux completed
[INFO] [Main] FLAC metadata write result: true
```

## 如何收集日志

1. 启动应用
2. 打开开发者工具（F12）
3. 切换到Console标签
4. 下载一首FLAC歌曲
5. 复制所有相关的日志信息
6. 提供给开发者进行调试

## 调试建议

如果您看到日志显示元数据写入成功，但文件中确实没有元数据，可能的原因：

1. **文件被锁定**：其他程序正在使用该文件
2. **权限问题**：没有写入权限
3. **文件路径问题**：特殊字符或路径过长
4. **FFmpeg/metaflac版本问题**：工具版本过旧或有bug
