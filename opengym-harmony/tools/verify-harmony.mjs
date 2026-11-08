#!/usr/bin/env node
/*
 * verify-harmony.mjs — check the Harmony project without a Harmony toolchain.
 *
 * There is no DevEco Studio on the machine this was written on, so the project cannot be
 * compiled here. This script checks everything that can be checked without one, and each
 * check looks for something that would break the app at runtime rather than at build time:
 *
 *   1. The JSON/JSON5 files parse. A typo in module.json5 stops the build with a message
 *      that says nothing about where the typo is.
 *   2. Every plugin the page calls has a native counterpart, and the reverse.
 *   3. Every method the front-end shim offers exists in the native plugin, and the native
 *      plugin does not offer a method the shim never calls.
 *   4. The ArkTS files import what they use, and every import resolves to a kit that exists.
 *   5. The bridge's two ends agree: the name the page calls, the proxy name, and the
 *      resolve/emit functions the native side runs.
 *   6. The packaged page is there, is an ES-module build, and carries the shims.
 *   7. The permissions the plugins ask for are declared in module.json5.
 *
 *   node tools/verify-harmony.mjs            check the project
 *   node tools/verify-harmony.mjs --frontend <path>   also check the front end
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const FRONTEND = path.resolve(opt('--frontend', path.join(ROOT, '..', 'openGym', 'frontend')))

const errors = []
const warnings = []
const notes = []

const fail = (m) => errors.push(m)
const warn = (m) => warnings.push(m)
const note = (m) => notes.push(m)

/** JSON5 is JSON plus comments and trailing commas — strip both, then parse. */
function parseJson5(text, name) {
  const stripped = text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1')
  try {
    return JSON.parse(stripped)
  } catch (e) {
    fail(`${name} 解析失败：${e.message}`)
    return null
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

console.log('='.repeat(72))
console.log('  openGym 鸿蒙工程静态校验')
console.log('='.repeat(72))

// ---------------------------------------------------------------------------
// 1. The configuration files
// ---------------------------------------------------------------------------
console.log('\n[1] 工程配置文件')
const json5Files = [
  'AppScope/app.json5',
  'build-profile.json5',
  'oh-package.json5',
  'entry/build-profile.json5',
  'entry/oh-package.json5',
  'entry/src/main/module.json5'
]
for (const rel of json5Files) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) { fail(`缺少文件：${rel}`); continue }
  const parsed = parseJson5(fs.readFileSync(full, 'utf8'), rel)
  if (parsed) note(`✓ ${rel}`)
}

const jsonFiles = [
  'AppScope/resources/base/element/string.json',
  'entry/src/main/resources/base/element/string.json',
  'entry/src/main/resources/base/profile/main_pages.json'
]
for (const rel of jsonFiles) {
  const full = path.join(ROOT, rel)
  if (!fs.existsSync(full)) { fail(`缺少文件：${rel}`); continue }
  try {
    JSON.parse(fs.readFileSync(full, 'utf8'))
    note(`✓ ${rel}`)
  } catch (e) {
    fail(`${rel} 解析失败：${e.message}`)
  }
}

// module.json5 has to declare the pages the ability loads, and the permissions the plugins
// ask for.
const moduleJsonPath = path.join(ROOT, 'entry/src/main/module.json5')
let moduleJson = null
if (fs.existsSync(moduleJsonPath)) {
  moduleJson = parseJson5(fs.readFileSync(moduleJsonPath, 'utf8'), 'module.json5')
}

const mainPagesPath = path.join(ROOT, 'entry/src/main/resources/base/profile/main_pages.json')
if (fs.existsSync(mainPagesPath) && moduleJson) {
  const pages = JSON.parse(fs.readFileSync(mainPagesPath, 'utf8'))
  const listed = (pages.src || []).map((p) => (p.startsWith('pages/') ? p : `pages/${p}`))
  const etsFiles = walk(path.join(ROOT, 'entry/src/main/ets/pages'))
    .map((f) => path.relative(path.join(ROOT, 'entry/src/main/ets'), f)
      .replace(/\\/g, '/').replace(/\.ets$/, ''))
  for (const page of listed) {
    if (!etsFiles.includes(page)) fail(`main_pages.json 里的 ${page} 没有对应的 .ets 文件`)
  }
  for (const file of etsFiles) {
    if (!listed.includes(file)) warn(`${file} 没有在 main_pages.json 里登记`)
  }
  if (listed.length && etsFiles.length) note(`✓ 页面 ${listed.length} 个已登记`)
}

// ---------------------------------------------------------------------------
// 1b. The app icon and the start window
// ---------------------------------------------------------------------------
console.log('\n[1b] 图标与启动屏')
{
  // The start window shows this image while the app loads. It has to be transparent: the
  // page's own boot screen is what should be seen there, not the app icon.
  const media = path.join(ROOT, 'entry/src/main/resources/base/media')
  const ability = moduleJson?.module?.abilities?.[0] || {}
  const startIcon = String(ability.startWindowIcon || '')
  // The reference names the media without its extension; the file on disk has one.
  const startFile = startIcon.replace(/^\$media:/, '') + '.png'
  if (!startIcon) {
    fail('module.json5 没有声明 startWindowIcon')
  } else {
    const full = path.join(media, startFile)
    if (!fs.existsSync(full)) {
      fail(`startWindowIcon 指向的文件不存在：${startFile}`)
    } else {
      // A PNG's alpha channel: every pixel transparent means no image is shown.
      const png = fs.readFileSync(full)
      const isPng = png[0] === 0x89 && png[1] === 0x50
      if (!isPng) {
        fail(`startWindowIcon 不是 PNG：${startFile}`)
      } else {
        // The size and the colour type live in the IHDR chunk.
        const width = png.readUInt32BE(16)
        const height = png.readUInt32BE(20)
        const colourType = png[25]
        // Decompress the image data and look at every pixel's alpha. One transparent
        // corner is not enough: the image has to be transparent throughout, or part of
        // it shows in the start window.
        const idatStart = png.indexOf(Buffer.from('IDAT', 'ascii'))
        let transparent = false
        if (idatStart > 0 && colourType === 6) {
          try {
            // The chunk's length sits before the type.
            const len = png.readUInt32BE(idatStart - 4)
            const data = png.subarray(idatStart + 4, idatStart + 4 + len)
            const raw = zlib.inflateSync(data)
            // Each row: a filter byte, then the pixels as R G B A.
            const stride = width * 4 + 1
            let opaque = 0
            for (let y = 0; y < height; y++) {
              const row = raw.subarray(y * stride + 1, (y + 1) * stride)
              // The filter byte tells how the row is encoded; only "none" needs no
              // undoing, the others are sums of the pixels to the left.
              const filter = raw[y * stride]
              if (filter !== 0) { opaque++; continue }
              for (let x = 0; x < width; x++) {
                if (row[x * 4 + 3] !== 0) { opaque++; break }
              }
            }
            transparent = opaque === 0
          } catch (e) {
            warn(`startWindowIcon 的像素读不出来：${e.message}`)
          }
        } else if (colourType !== 6) {
          fail(`startWindowIcon 必须带 alpha 通道（RGBA），实际 colorType=${colourType}`)
        }
        if (!transparent) {
          fail(`startWindowIcon 不是全透明的，启动时会显示图标：${startFile}`)
        } else {
          note(`✓ 启动屏图标全透明（${width}×${height}）`)
        }
      }
    }
  }

  // The layered app icon: the background is the square the system masks, the foreground
  // holds the glyph. Both have to be there and the foreground has to be 1024×1024.
  const layered = path.join(ROOT, 'AppScope/resources/base/media')
  for (const name of ['background.png', 'foreground.png']) {
    const full = path.join(layered, name)
    if (!fs.existsSync(full)) { fail(`缺少分层图标：${name}`); continue }
    const png = fs.readFileSync(full)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    if (width !== 1024 || height !== 1024) {
      fail(`${name} 应为 1024×1024，实际 ${width}×${height}`)
    } else {
      note(`✓ ${name} 1024×1024`)
    }
  }

  // The ability's own icon is the one the launcher shows — it is what the home screen
  // draws, not the layered pair. The template's placeholder is 41×41; a real icon is
  // not, so a small one means the placeholder was never replaced.
  const abilityIcon = String(ability.icon || '')
  const iconFile = abilityIcon.replace(/^\$media:/, '') + '.png'
  const iconPath = path.join(layered, iconFile)
  if (!abilityIcon) {
    fail('module.json5 的 ability 没有声明 icon')
  } else if (!fs.existsSync(iconPath)) {
    fail(`ability 的 icon 指向的文件不存在：${iconFile}`)
  } else {
    const png = fs.readFileSync(iconPath)
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    if (width < 216 || height < 216) {
      fail(`ability 的 icon 太小（${width}×${height}），桌面会显示成模板占位图：${iconFile}`)
    } else {
      note(`✓ ability 图标 ${iconFile} ${width}×${height}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 2. The permissions the plugins need
// ---------------------------------------------------------------------------
console.log('\n[2] 权限声明')
if (moduleJson) {
  const declared = new Set(
    ((moduleJson.module?.requestPermissions) || []).map((p) => p.name)
  )
  const needed = [
    ['ohos.permission.INTERNET', '本地通知 / 网络请求'],
    // API 26 has no POST_NOTIFICATIONS: the notification permission is asked for through
    // notificationManager.requestEnableNotification() instead of a manifest entry.
    ['ohos.permission.LOCATION', '健身房位置提醒'],
    ['ohos.permission.CAMERA', '扫码配对']
  ]
  for (const [name, why] of needed) {
    if (declared.has(name)) note(`✓ ${name}（${why}）`)
    else fail(`module.json5 未声明 ${name}（${why}）`)
  }
  // Every declared permission needs a reason string, or the store asks for it.
  const strings = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'entry/src/main/resources/base/element/string.json'), 'utf8'))
  const stringNames = new Set((strings.string || []).map((s) => s.name))
  for (const p of moduleJson.module?.requestPermissions || []) {
    const reason = String(p.reason || '')
    const ref = reason.match(/^\$string:(.+)$/)
    if (ref && !stringNames.has(ref[1])) {
      fail(`权限 ${p.name} 引用的 $string:${ref[1]} 没有定义`)
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The bridge: both ends must agree
// ---------------------------------------------------------------------------
console.log('\n[3] 桥接两端一致性')
const bridgeJsPath = path.join(FRONTEND, 'src/lib/harmony/bridge.js')
const coreJsPath = path.join(FRONTEND, 'src/lib/harmony/core.js')
const pluginsJsPath = path.join(FRONTEND, 'src/lib/harmony/plugins.js')
const indexEtsPath = path.join(ROOT, 'entry/src/main/ets/pages/Index.ets')
const harmonyBridgeEtsPath = path.join(ROOT, 'entry/src/main/ets/common/HarmonyBridge.ets')

let bridgeJs = fs.existsSync(bridgeJsPath) ? fs.readFileSync(bridgeJsPath, 'utf8') : ''
let coreJs = fs.existsSync(coreJsPath) ? fs.readFileSync(coreJsPath, 'utf8') : ''
let pluginsJs = fs.existsSync(pluginsJsPath) ? fs.readFileSync(pluginsJsPath, 'utf8') : ''
let indexEts = fs.existsSync(indexEtsPath) ? fs.readFileSync(indexEtsPath, 'utf8') : ''
let harmonyBridgeEts = fs.existsSync(harmonyBridgeEtsPath)
  ? fs.readFileSync(harmonyBridgeEtsPath, 'utf8') : ''

if (!bridgeJs) fail(`缺少前端桥接层：${bridgeJsPath}`)
if (!indexEts) fail(`缺少鸿蒙主页面：${indexEtsPath}`)

// The proxy name appears on both sides: the page calls it, the native side registers it.
const proxyNameJs = (bridgeJs.match(/BRIDGE_NAME\s*=\s*'([^']+)'/) || [])[1]
const proxyNameEts = (harmonyBridgeEts.match(/name:\s*'([^']+)'/) || [])[1]
if (proxyNameJs && proxyNameEts) {
  if (proxyNameJs === proxyNameEts) note(`✓ 代理名一致：${proxyNameJs}`)
  else fail(`代理名不一致：前端 ${proxyNameJs} / 原生 ${proxyNameEts}`)
} else {
  fail('找不到代理名（前端 BRIDGE_NAME 或原生 name）')
}

// The resolve and emit functions: the page defines them, the native side calls them.
for (const fn of ['__ogResolve', '__ogEmit']) {
  const inJs = bridgeJs.includes(fn)
  const inEts = harmonyBridgeEts.includes(fn)
  if (inJs && inEts) note(`✓ ${fn} 两端齐备`)
  else fail(`${fn} 缺失：前端 ${inJs ? '有' : '无'} / 原生 ${inEts ? '有' : '无'}`)
}

// ---------------------------------------------------------------------------
// 4. The plugin table
// ---------------------------------------------------------------------------
console.log('\n[4] 插件表')
// The shim has two kinds of plugin: the ones the native side answers, and the ones the app
// asks for that Harmony has no counterpart for (the watch bridge, the widgets, the iOS health
// store). The second kind is a deliberate placeholder that rejects every call, so it must not
// be counted as a missing native plugin.
//
// The plugin list comes from the nativeCall() calls themselves: the first argument is the
// plugin's name. Reading it from there avoids mistaking a constant for a plugin.
const unsupported = new Set()
const unsupportedRe = /export const (\w+) = UNSUPPORTED/g
let um
while ((um = unsupportedRe.exec(pluginsJs)) !== null) unsupported.add(um[1])

const shimPlugins = new Set()
const callRe = /nativeCall\('([^']+)'/g
let cm
while ((cm = callRe.exec(pluginsJs)) !== null) {
  if (!unsupported.has(cm[1])) shimPlugins.add(cm[1])
}
// CapacitorHttp and Capacitor live in core.js.
if (/export const CapacitorHttp/.test(coreJs)) shimPlugins.add('CapacitorHttp')
if (/export const Capacitor =/.test(coreJs)) shimPlugins.add('Capacitor')

// What the native side registers.
const nativePlugins = new Set()
const nativeRe = /bridge\.register\('([^']+)'/g
let m
while ((m = nativeRe.exec(indexEts)) !== null) {
  nativePlugins.add(m[1])
}

for (const name of shimPlugins) {
  if (!nativePlugins.has(name)) fail(`前端有 ${name} 插件，原生侧没有注册`)
}
for (const name of nativePlugins) {
  if (!shimPlugins.has(name)) fail(`原生侧注册了 ${name}，前端没有对应 shim`)
}
note(`✓ 插件 ${shimPlugins.size} 个两端对齐；${unsupported.size} 个明确不支持（Apple Watch / 小组件 / iOS 健康）`)

// ---------------------------------------------------------------------------
// 5. The methods each plugin offers
// ---------------------------------------------------------------------------
console.log('\n[5] 插件方法')
const pluginFiles = walk(path.join(ROOT, 'entry/src/main/ets/plugins'))
const etsFiles = walk(path.join(ROOT, 'entry/src/main/ets'))

// For each native plugin, the methods its switch answers, against the methods the shim calls.
for (const file of pluginFiles) {
  const name = path.basename(file).replace('Plugin.ets', '')
  const src = fs.readFileSync(file, 'utf8')
  const nativeMethods = new Set()
  const caseRe = /case '([a-zA-Z]+)':/g
  let cm
  while ((cm = caseRe.exec(src)) !== null) nativeMethods.add(cm[1])

  // The shim's calls for this plugin.
  const shimBlock = (() => {
    const re = new RegExp(`(?:const|export const) ${name} = \\{[\\s\\S]*?\\n\\}`, 'm')
    const hit = pluginsJs.match(re)
    return hit ? hit[0] : ''
  })()
  const shimMethods = new Set()
  const callRe = /nativeCall\('([^']+)',\s*'([^']+)'/g
  let sm
  while ((sm = callRe.exec(shimBlock)) !== null) {
    if (sm[1] === name) shimMethods.add(sm[2])
  }
  // The generic proxy answers any method, so a missing native method is a runtime failure,
  // not a build failure. Worth knowing.
  for (const method of shimMethods) {
    if (!nativeMethods.has(method)) {
      fail(`${name}.${method}：前端会调用，原生插件没有这个分支`)
    }
  }
  if (nativeMethods.size) note(`✓ ${name}: ${nativeMethods.size} 个方法`)
}

// ---------------------------------------------------------------------------
// 6. The ArkTS imports
// ---------------------------------------------------------------------------
console.log('\n[6] ArkTS 引用')
const KNOWN_KITS = [
  '@kit.ArkWeb', '@kit.AbilityKit', '@kit.BasicServicesKit', '@kit.NetworkKit',
  '@kit.ArkData', '@kit.NotificationKit', '@kit.LocationKit', '@kit.ScanKit',
  '@kit.CoreFileKit', '@kit.PerformanceAnalysisKit', '@kit.ArkUI',
  '@kit.LocalizationKit'
]
// The modules that are imported by their own path rather than through a kit.
const KNOWN_MODULES = ['@ohos.app.ability.common']
const localImports = new Set()
for (const file of etsFiles) {
  const src = fs.readFileSync(file, 'utf8')
  const importRe = /from\s+'([^']+)'/g
  let im
  while ((im = importRe.exec(src)) !== null) {
    const spec = im[1]
    if (spec.startsWith('@kit.')) {
      if (!KNOWN_KITS.includes(spec)) {
        fail(`${path.basename(file)} 引用了未知的 kit：${spec}`)
      }
    } else if (spec.startsWith('.')) {
      // ArkTS imports carry no file extension.
      const base = path.resolve(path.dirname(file), spec)
      const resolved = [base, base + '.ets', base + '.ts'].find((p) => fs.existsSync(p))
      if (!resolved) {
        fail(`${path.basename(file)} 的相对引用不存在：${spec}`)
      } else {
        localImports.add(spec)
      }
    } else if (spec.startsWith('@ohos.')) {
      // An API module imported by its own path rather than through a kit.
      if (!KNOWN_MODULES.includes(spec)) {
        fail(`${path.basename(file)} 引用了未知的模块：${spec}`)
      }
    } else if (spec.startsWith('@ohos/')) {
      // The hvigor plugins, not runtime code.
    } else {
      fail(`${path.basename(file)} 引用了意外的模块：${spec}`)
    }
  }
}
note(`✓ ${etsFiles.length} 个 ArkTS 文件，${localImports.size} 个本地引用全部存在`)

// The ArkTS type rules: a few things that compile as TypeScript do not as ArkTS.
console.log('\n[7] ArkTS 语法约束')
for (const file of etsFiles) {
  const src = fs.readFileSync(file, 'utf8')
  const rel = path.relative(ROOT, file)
  // `bool` is not a type in ArkTS.
  if (/:\s*bool\b/.test(src)) fail(`${rel} 用了 bool，ArkTS 里是 boolean`)
  // `any` is reserved in ArkTS.
  if (/:\s*any\b|<any>|\bany\[\]/.test(src)) fail(`${rel} 用了 any，ArkTS 不允许`)
  // A function type is not a type in ArkTS.
  if (/:\s*\(\s*\w+\s*:\s*\w+[^)]*\)\s*=>\s*\w+/.test(src)) {
    fail(`${rel} 用了函数类型标注，ArkTS 需要一个 interface`)
  }
  // Object literals need a type in ArkTS.
  if (/=\s*\{\s*$/.test(src) && !/Record</.test(src)) {
    // Only a hint; ArkTS reports this itself, so it stays a note.
  }
}
if (!errors.length) note('✓ 未发现违反 ArkTS 约束的写法')

// ---------------------------------------------------------------------------
// 8. The packaged page
// ---------------------------------------------------------------------------
console.log('\n[8] 前端产物')
const rawfile = path.join(ROOT, 'entry/src/main/resources/rawfile')
if (!fs.existsSync(path.join(rawfile, 'index.html'))) {
  warn('rawfile 里没有 index.html —— 先跑 node tools/sync-web.mjs')
} else {
  const indexHtml = fs.readFileSync(path.join(rawfile, 'index.html'), 'utf8')
  if (indexHtml.includes('type="module"')) note('✓ index.html 是 ES-module 构建（需要 file 方案的 CORS 放行）')
  else fail('index.html 不是 ES-module 构建，但 Index.ets 按 ES-module 方式放行了 file 方案')

  const assets = fs.existsSync(path.join(rawfile, 'assets'))
    ? fs.readdirSync(path.join(rawfile, 'assets')) : []
  const js = assets.filter((f) => f.endsWith('.js'))
  const hasHarmony = js.some((f) => {
    const body = fs.readFileSync(path.join(rawfile, 'assets', f), 'utf8')
    return body.includes('JSBridgeHandle')
  })
  if (hasHarmony) note('✓ 产物里带着鸿蒙 shim（JSBridgeHandle）')
  else fail('产物里没有鸿蒙 shim —— 前端多半是用普通构建出来的')

  // The real Capacitor runtime must not be in there: on Harmony there is none.
  const hasCapacitorRuntime = js.some((f) => {
    const body = fs.readFileSync(path.join(rawfile, 'assets', f), 'utf8')
    return body.includes('capacitor/android') || body.includes('CapacitorHttpDelegate')
  })
  if (hasCapacitorRuntime) fail('产物里混进了 Capacitor 运行时，鸿蒙上会加载失败')
  else note('✓ 产物里没有 Capacitor 运行时')
}

// ---------------------------------------------------------------------------
// 9. The web side's own checks
// ---------------------------------------------------------------------------
console.log('\n[9] 前端适配层')
if (coreJs) {
  // The proxy must not answer `then` — that is the bug that hangs a promise (#42).
  if (/prop\s*===\s*'then'/.test(coreJs) && /return undefined/.test(coreJs)) {
    note('✓ registerPlugin 的 proxy 不响应 then（避免 #42 那种永不 settle）')
  } else {
    fail('registerPlugin 的 proxy 没有屏蔽 then —— promise 会永不 settle')
  }
  // The platform the app sees.
  const platform = (coreJs.match(/const PLATFORM\s*=\s*'([^']+)'/) || [])[1]
  if (platform === 'android') note('✓ 对前端报告 android 平台（复用既有的 Android 分支）')
  else warn(`对前端报告的平台是 ${platform} —— 前端只认 ios/android/web`)
}
if (pluginsJs) {
  for (const p of ['SecureStorage', 'Filesystem', 'LocalNotifications', 'App', 'Share',
    'SplashScreen', 'BarcodeScanner', 'GymReminder']) {
    if (!pluginsJs.includes(p)) fail(`shim 缺少 ${p}`)
  }
  note('✓ 8 个插件的 shim 齐备')
}

// ---------------------------------------------------------------------------
// 10. The Vite alias
// ---------------------------------------------------------------------------
console.log('\n[10] 构建配置')
const vitePath = path.join(FRONTEND, 'vite.config.js')
if (fs.existsSync(vitePath)) {
  const vite = fs.readFileSync(vitePath, 'utf8')
  if (vite.includes('VITE_HARMONY')) note('✓ vite.config.js 认得 VITE_HARMONY')
  else fail('vite.config.js 没有处理 VITE_HARMONY —— 鸿蒙构建会打进真的 Capacitor')
  for (const dep of ['@capacitor/core', '@capacitor/filesystem', '@capacitor/local-notifications',
    '@capacitor/app', '@capacitor/share', '@capacitor/splash-screen',
    '@capacitor-mlkit/barcode-scanning', '@aparajita/capacitor-secure-storage']) {
    if (!vite.includes(dep)) fail(`vite alias 少了 ${dep}`)
  }
  // The alias must not be on in the other builds.
  if (/harmony\s*\?\s*\{\s*alias/.test(vite)) note('✓ alias 只在鸿蒙构建生效')
  else warn('alias 的条件看起来没生效，其他构建可能被打扰')
} else {
  warn(`找不到 ${vitePath}`)
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(72))
if (errors.length) {
  console.log(`  校验未通过：${errors.length} 个错误，${warnings.length} 个提醒`)
  console.log('  错误：')
  errors.forEach((e) => console.log(`    ✗ ${e}`))
  if (warnings.length) {
    console.log('  提醒：')
    warnings.forEach((w) => console.log(`    · ${w}`))
  }
  console.log('='.repeat(72))
  process.exit(1)
}
console.log(`  校验通过：${notes.length} 项检查，${warnings.length} 个提醒`)
if (warnings.length) {
  console.log('  提醒：')
  warnings.forEach((w) => console.log(`    · ${w}`))
}
console.log('='.repeat(72))
