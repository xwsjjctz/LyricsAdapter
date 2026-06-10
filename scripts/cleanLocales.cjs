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
  } else {
    cleanWinLinux(appOutDir)
  }
}

function cleanMacOS(appOutDir) {
  // 尝试多种可能的 Resources 路径
  const resourceDirs = [
    path.join(appOutDir, 'Contents', 'Resources'),
  ]

  // 如果 appOutDir 本身包含 .app 目录
  try {
    const entries = fs.readdirSync(appOutDir)
    for (const entry of entries) {
      if (entry.endsWith('.app')) {
        resourceDirs.push(path.join(appOutDir, entry, 'Contents', 'Resources'))
      }
    }
  } catch {
    // appOutDir 不是目录
  }

  for (const resourcesDir of resourceDirs) {
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

function cleanWinLinux(appOutDir) {
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
