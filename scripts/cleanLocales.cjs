/**
 * electron-builder afterPack hook: 清理多余语言包
 * 仅保留: 中(zh_CN) 英(en) 日(ja) 韩(ko) 德(de) 法(fr)
 *
 * macOS: 移除 Resources/*.lproj 目录
 * Windows/Linux: 移除 locales/*.pak 文件
 */
const fs = require('fs')
const path = require('path')

// macOS 使用下划线命名
const KEEP_MAC = new Set(['en', 'zh_CN', 'ja', 'ko', 'de', 'fr'])
// Windows/Linux 使用连字符命名
const KEEP_WIN = new Set(['en', 'zh-CN', 'ja', 'ko', 'de', 'fr'])

async function defaultFn(context) {
  const { appOutDir, electronPlatformName } = context
  console.log(`[cleanLocales] Platform: ${electronPlatformName}, appOutDir: ${appOutDir}`)

  if (electronPlatformName === 'darwin') {
    cleanMacOS(appOutDir)
    cleanMacosStatusbarNative(appOutDir)
  } else {
    cleanWinLinux(appOutDir, electronPlatformName)
    if (electronPlatformName === 'win32') {
      verifyWindowsTaskbarHost(context)
    }
  }
}

function verifyWindowsTaskbarHost(context) {
  const executablePath = path.join(
    context.appOutDir,
    'resources',
    'windows-taskbar-host',
    'LyricsAdapter.TaskbarHost.exe',
  )
  if (!fs.existsSync(executablePath)) {
    throw new Error(`[cleanLocales] Missing packaged C# taskbar host: ${executablePath}`)
  }

  console.log(`[cleanLocales] C# taskbar host ready for ${String(context.arch)}`)
}

function cleanMacosStatusbarNative(appOutDir) {
  const resourcesDir = macResourceDirectories(appOutDir)
    .find(directory => fs.existsSync(directory))
  if (!resourcesDir) {
    throw new Error(`[cleanLocales] Missing macOS Resources directory in ${appOutDir}`)
  }

  const nativeRoot = path.join(
    resourcesDir,
    'app.asar.unpacked',
    'node_modules',
    '@lyrics-adapter',
    'macos-statusbar-native',
  )
  if (!fs.existsSync(nativeRoot)) {
    throw new Error(`[cleanLocales] Missing packaged macOS status bar native module: ${nativeRoot}`)
  }

  cleanNativeBuildRoot(nativeRoot, 'macos_statusbar_native.node', 'macOS status bar bridge')
  console.log('[cleanLocales] macOS status bar native runtime ready')
}

function cleanNativeBuildRoot(nativeRoot, binaryFilename, label) {
  fs.rmSync(path.join(nativeRoot, 'bin'), { recursive: true, force: true })
  const buildRoot = path.join(nativeRoot, 'build')
  const releaseRoot = path.join(buildRoot, 'Release')
  const binaryPath = path.join(releaseRoot, binaryFilename)

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`[cleanLocales] Packaged ${label} has no runtime .node binary`)
  }

  for (const entry of fs.readdirSync(buildRoot)) {
    const entryPath = path.join(buildRoot, entry)
    if (entry !== 'Release') {
      fs.rmSync(entryPath, { recursive: true, force: true })
      continue
    }
    for (const releaseEntry of fs.readdirSync(releaseRoot)) {
      if (releaseEntry !== binaryFilename) {
        fs.rmSync(path.join(releaseRoot, releaseEntry), { recursive: true, force: true })
      }
    }
  }
}

function macResourceDirectories(appOutDir) {
  const resourceDirs = [path.join(appOutDir, 'Contents', 'Resources')]
  try {
    for (const entry of fs.readdirSync(appOutDir)) {
      if (entry.endsWith('.app')) {
        resourceDirs.push(path.join(appOutDir, entry, 'Contents', 'Resources'))
      }
    }
  } catch {
    // appOutDir 不是目录
  }
  return resourceDirs
}

function cleanMacOS(appOutDir) {
  for (const resourcesDir of macResourceDirectories(appOutDir)) {
    if (!fs.existsSync(resourcesDir)) continue
    console.log(`[cleanLocales] Scanning: ${resourcesDir}`)

    let removed = 0
    const entries = fs.readdirSync(resourcesDir)
    for (const entry of entries) {
      if (!entry.endsWith('.lproj')) continue
      const localeName = entry.replace('.lproj', '')
      if (!KEEP_MAC.has(localeName)) {
        const localePath = path.join(resourcesDir, entry)
        fs.rmSync(localePath, { recursive: true, force: true })
        removed++
      }
    }
    console.log(`[cleanLocales] Removed ${removed} locale dirs from macOS bundle`)
    return // 只处理第一个有效的目录
  }

  console.warn(`[cleanLocales] No Resources directory found in ${appOutDir}`)
}

function cleanWinLinux(appOutDir, electronPlatformName) {
  const localesDir = path.join(appOutDir, 'locales')
  if (!fs.existsSync(localesDir)) {
    console.warn(`[cleanLocales] No locales dir at ${localesDir}`)
    return
  }

  let removed = 0
  const entries = fs.readdirSync(localesDir)
  for (const entry of entries) {
    if (!entry.endsWith('.pak')) continue
    const localeName = entry.replace('.pak', '')
    if (!KEEP_WIN.has(localeName)) {
      const localePath = path.join(localesDir, entry)
      fs.unlinkSync(localePath)
      removed++
    }
  }
  console.log(`[cleanLocales] Removed ${removed} locale .pak files from ${electronPlatformName} bundle`)
}

exports.default = defaultFn
