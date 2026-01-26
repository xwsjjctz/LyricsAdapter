# LyricsAdapter

一个功能丰富的本地音乐播放器，专注于歌词同步显示和沉浸式播放体验。

## 功能特性

- 🎵 **多格式支持**: FLAC, MP3, M4A, WAV
- 📝 **智能歌词解析**: 自动提取并同步显示 LRC 格式歌词
- 🖼️ **封面显示**: 自动提取音频文件内嵌的封面图片
- 🎭 **沉浸式模式**: 全屏显示，歌词滚动同步
- 🎚️ **完整播放控制**: 播放/暂停、上一曲/下一曲、进度调节、音量控制
- 📚 **本地播放**: 完全在浏览器中运行，无需后端服务器

## 快速开始

**前提条件**: Node.js

1. 安装依赖:
   ```bash
   npm install
   ```

2. 启动应用:
   ```bash
   npm run dev
   ```

3. 打开浏览器访问: http://localhost:3000

4. 导入音乐文件:
   - 点击侧边栏的导入按钮
   - 选择音频文件（支持批量选择）

## 技术栈

- **React 18.2.0** - 用户界面
- **TypeScript** - 类型安全
- **Vite** - 构建工具
- **Tailwind CSS** - 样式框架

## 开发命令

```bash
npm run dev      # 启动开发服务器
npm run build    # 构建生产版本
npm run preview  # 预览生产构建
```

## 项目结构

```
lyrics-adapter/
├── components/          # React 组件
│   ├── Controls.tsx      # 播放控制
│   ├── FocusMode.tsx     # 沉浸式模式
│   ├── LibraryView.tsx   # 歌曲列表
│   └── Sidebar.tsx       # 侧边栏
├── services/            # 业务逻辑
│   └── metadataService.ts # 元数据解析
├── App.tsx              # 主应用
├── types.ts             # 类型定义
└── index.html           # HTML 入口
```

## 核心特性

### 元数据解析
- **FLAC**: VORBIS_COMMENT 和 PICTURE 块完整解析
- **MP3**: ID3v2 标签解析，支持 synchsafe 整数
- **歌词**: LRC 格式时间戳解析和同步

### 歌词同步
- 基于时间戳的精确同步
- 自动滚动到当前歌词
- 点击歌词跳转到对应时间

### 界面设计
- 玻玻璃拟态效果
- 响应式布局
- 平滑动画过渡
- 沉浸式背景模糊

## 许可证

MIT
