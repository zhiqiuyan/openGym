/*
 * test-assets.mjs — checks the local asset mapping.
 *
 * The fix for the white screen is a mapping: a request for https://localhost/<path> has to
 * become a read of rawfile/<path>, with the MIME type the browser expects. Two things can go
 * wrong that no compiler catches:
 *
 *   - a path that maps to the wrong file (the index page ending up answering a script request),
 *   - a MIME type that makes the browser refuse the file (a script served as text/plain is
 *     refused outright, and the module graph dies with it — the same failure, one layer down).
 *
 * The mapping is in an .ets file, which Node cannot run. So the rules are read out of the
 * .ets source and checked against the real files in the package: the test asks the source
 * what it would do with a URL, and then verifies that the file it names is actually there.
 *
 * Run: node tools/test-assets.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RAWFILE = path.join(ROOT, 'entry/src/main/resources/rawfile')
const LOCAL_ASSETS = path.join(ROOT, 'entry/src/main/ets/common/LocalAssets.ets')

let failures = 0
let checks = 0

function fail(msg) {
  failures++
  console.log(`  [FAIL] ${msg}`)
}

function ok(msg) {
  console.log(`  [ OK ] ${msg}`)
}

function check(cond, msg) {
  checks++
  if (cond) ok(msg)
  else fail(msg)
}

// ---------------------------------------------------------------------------
// The mapping rules, read out of the .ets source.
//
// They are read rather than re-implemented on purpose: a copy here would pass its own
// tests while the file that runs on the phone did something else.
// ---------------------------------------------------------------------------

const source = fs.readFileSync(LOCAL_ASSETS, 'utf8')

function extractConst(name) {
  const m = source.match(new RegExp(`const ${name}\\s*=\\s*'([^']*)'`))
  return m ? m[1] : null
}

const origin = extractConst('APP_ORIGIN')
check(origin !== null, `APP_ORIGIN 从源文件中读到：${origin}`)
check(origin === 'https://localhost',
  `APP_ORIGIN 必须是 https://localhost（服务器只接受这三个 Origin），实际：${origin}`)

// The origin the app's own API server accepts, straight from the server's source.
const serverSrc = path.resolve(ROOT, '../openGym/api/server.js')
if (fs.existsSync(serverSrc)) {
  const server = fs.readFileSync(serverSrc, 'utf8')
  const m = server.match(/APP_ORIGINS\s*=\s*new Set\(\[([^\]]*)\]\)/)
  if (m) {
    const allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    check(allowed.includes(origin),
      `服务器允许的 Origin 含 ${origin}（允许列表：${allowed.join(', ')}）`)
  }
}

// localPathOf: reproduce its behaviour by calling the same source text.
// The function is small and pure, so the test drives it through a tiny transform:
// the .ets body is valid JavaScript once the types are stripped.
function loadLocalPathOf() {
  const start = source.indexOf('export function localPathOf')
  if (start < 0) return null
  const end = source.indexOf('\n}', start) + 2
  let body = source.substring(start, end)
  // The ArkTS type annotations go; the names stay.
  body = body
    .replace(/export function/, 'function')
    .replace(/\(url: string\)/, '(url)')
    .replace(/\): string \| undefined/, ')')
    .replace(/: string \| undefined =/g, ' =')
    .replace(/APP_ORIGIN/g, JSON.stringify(origin))
  return new Function(`${body}; return localPathOf;`)()
}

let localPathOf = null
try {
  localPathOf = loadLocalPathOf()
} catch (error) {
  fail(`localPathOf 无法从源文件加载：${error.message}`)
}

if (localPathOf) {
  console.log('\n[1] 路径映射')

  check(localPathOf('https://localhost/index.html') === 'index.html',
    '主文档 → index.html')
  check(localPathOf('https://localhost/assets/index-Kr6mHU6B.js') === 'assets/index-Kr6mHU6B.js',
    '脚本 → assets/index-Kr6mHU6B.js')
  check(localPathOf('https://localhost/manifest.json') === 'manifest.json',
    'manifest.json')
  check(localPathOf('https://localhost/icon-180.png') === 'icon-180.png',
    '图标 icon-180.png')
  check(localPathOf('https://localhost/app-icons/default.png') === 'app-icons/default.png',
    '子目录 app-icons/default.png')
  check(localPathOf('https://localhost/assets/x.js?v=1') === 'assets/x.js',
    '带查询串的 URL → 去掉查询串')
  check(localPathOf('https://localhost/assets/x.js#a') === 'assets/x.js',
    '带片段的 URL → 去掉片段')

  check(localPathOf('https://example.com/index.html') === undefined,
    '别的域名 → 放行（不拦截）')
  check(localPathOf('https://localhost.evil.com/x.js') === undefined,
    '相似域名 → 放行（不劫持）')
  check(localPathOf('http://localhost/x.js') === undefined,
    '别的协议 → 放行')
  check(localPathOf('https://localhost/../secret') === undefined,
    '路径穿越 → 拒绝')
  check(localPathOf('https://localhost/') === undefined,
    '根路径 → 拒绝（没有那个文件）')
}

// ---------------------------------------------------------------------------
// The MIME table.
// ---------------------------------------------------------------------------

function loadMimeOf() {
  const start = source.indexOf('function mimeOf')
  if (start < 0) return null
  const end = source.indexOf('\n}', start) + 2
  let body = source.substring(start, end)
  // The ArkTS type annotations go; the names stay.
  body = body
    .replace(/\(path: string\)/, '(path)')
    .replace(/\): string/, ')')
  return new Function(`${body}; return mimeOf;`)()
}

let mimeOf = null
try {
  mimeOf = loadMimeOf()
} catch (error) {
  fail(`mimeOf 无法从源文件加载：${error.message}`)
}

if (mimeOf) {
  console.log('\n[2] MIME 类型')
  // A module script is only accepted with a JavaScript MIME type. The build's entry point is
  // an ES module, so this one is not negotiable.
  check(mimeOf('assets/index-x.js') === 'text/javascript',
    'JS → text/javascript（ES 模块只认这个）')
  check(mimeOf('index.html') === 'text/html', 'HTML → text/html')
  check(mimeOf('assets/index-x.css') === 'text/css', 'CSS → text/css')
  check(mimeOf('manifest.json') === 'application/json', 'JSON → application/json')
  check(mimeOf('icon-180.png') === 'image/png', 'PNG → image/png')
  check(mimeOf('sw.js') === 'text/javascript', 'Service Worker → text/javascript')
  check(mimeOf('app-icons/default.png') === 'image/png', '子目录 PNG → image/png')
  check(mimeOf('assets/x.woff2') === 'font/woff2', '字体 → font/woff2')
  check(mimeOf('assets/x.map') === 'text/plain', 'source map → text/plain')

  // The exercise media. A video served as application/octet-stream is refused by the browser,
  // and the animation never plays — the page falls back to the still, which looks like
  // "the animation is missing" rather than like a broken type.
  check(mimeOf('exercise-media/still/0001.webp') === 'image/webp',
    '动作静帧 → image/webp')
  check(mimeOf('exercise-media/clip/0001.mp4') === 'video/mp4',
    '动作动画 → video/mp4（type 不对浏览器拒播）')
}

// ---------------------------------------------------------------------------
// Every file the page asks for has to be in the package, and every file in the
// package has to be reachable through the mapping.
// ---------------------------------------------------------------------------

console.log('\n[3] 包内容与映射的一致性')

if (localPathOf) {
  const indexHtml = fs.readFileSync(path.join(RAWFILE, 'index.html'), 'utf8')
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  const local = refs.filter((r) => !/^https?:|^\/\//.test(r))

  let missing = 0
  for (const ref of local) {
    const mapped = localPathOf(origin + '/' + ref.replace(/^\.\//, ''))
    const file = mapped === undefined ? null : path.join(RAWFILE, mapped)
    checks++
    if (!file || !fs.existsSync(file)) {
      fail(`index.html 引用 ${ref} → 映射到 ${mapped}，包里没有这个文件`)
      missing++
    }
  }
  if (!missing) {
    ok(`index.html 的 ${local.length} 个本地引用全部能在包里找到`)
  }

  // Every file in the package has to be reachable: a file the mapping cannot name is a file
  // the page cannot load.
  const all = []
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel)
      else all.push(rel)
    }
  }
  walk(RAWFILE, '')

  let unreachable = 0
  for (const rel of all) {
    const mapped = localPathOf(origin + '/' + rel)
    checks++
    if (mapped !== rel) {
      fail(`包里的 ${rel} 映射后成了 ${mapped}（原样才对）`)
      unreachable++
    }
  }
  if (!unreachable) {
    ok(`包里的 ${all.length} 个文件全部可被映射命中`)
  }
}

// ---------------------------------------------------------------------------
// The exercise media.
//
// These are not part of the front-end build: vite copies public/, and the drawings live in
// catalogue/media. A build that skips the staging step produces an app with no drawings at
// all, and the phone shows the neutral dumbbell tile where the exercise should be — the
// page loads, everything works, and the pictures are simply not there.
// ---------------------------------------------------------------------------

console.log('\n[4] 动作媒体')

const stillDir = path.join(RAWFILE, 'exercise-media/still')
const clipDir = path.join(RAWFILE, 'exercise-media/clip')

check(fs.existsSync(stillDir), '静帧目录 exercise-media/still 存在')
check(fs.existsSync(clipDir), '动画目录 exercise-media/clip 存在')

if (fs.existsSync(stillDir)) {
  const stills = fs.readdirSync(stillDir)
  check(stills.length > 6000, `静帧数量 ${stills.length}（应超过 6000）`)
  check(stills.every((f) => f.endsWith('.webp')), '静帧都是 .webp')
  if (localPathOf) {
    const one = stills[0]
    const mapped = localPathOf(origin + '/exercise-media/still/' + one)
    check(mapped === 'exercise-media/still/' + one,
      `静帧可被映射命中（${one}）`)
  }
}

if (fs.existsSync(clipDir)) {
  const clips = fs.readdirSync(clipDir)
  check(clips.length > 6000, `动画数量 ${clips.length}（应超过 6000）`)
  const exts = new Set(clips.map((f) => path.extname(f).toLowerCase()))
  check(exts.size === 1 && exts.has('.mp4'),
    `动画都是 .mp4（实际：${[...exts].join(',')}）`)
  if (localPathOf) {
    const one = clips[0]
    const mapped = localPathOf(origin + '/exercise-media/clip/' + one)
    check(mapped === 'exercise-media/clip/' + one,
      `动画可被映射命中（${one}）`)
  }
}

// The staging step has to be part of the build, or the media never reach the package.
const syncScript = path.join(ROOT, 'tools/sync-web.mjs')
if (fs.existsSync(syncScript)) {
  const sync = fs.readFileSync(syncScript, 'utf8')
  check(/stage-media\.mjs/.test(sync), '同步脚本调用了 stage-media.mjs（媒体打包步骤）')
  check(/stageMedia\(\)/.test(sync), '同步脚本在拷贝前执行了媒体暂存')
}

const indexEts = fs.readFileSync(path.join(ROOT, 'entry/src/main/ets/pages/Index.ets'), 'utf8')
check(!/customizeSchemes/.test(indexEts),
  'Index.ets 不再调用 customizeSchemes（对 file/resource 无效）')
check(/onInterceptRequest/.test(indexEts),
  'Index.ets 注册了 onInterceptRequest')
check(new RegExp(`src:\\s*APP_ORIGIN`).test(indexEts) || /APP_ORIGIN \+ '\/index\.html'/.test(indexEts),
  'Web 的 src 指向虚拟域名')
check(/setResponseMimeType/.test(indexEts),
  '响应设置了 MIME 类型')

// The API server's own CORS list must include the origin, or the page loads and then
// every call to the paired server fails.
if (fs.existsSync(serverSrc)) {
  const server = fs.readFileSync(serverSrc, 'utf8')
  const m = server.match(/APP_ORIGINS\s*=\s*new Set\(\[([^\]]*)\]\)/)
  if (m) {
    const allowed = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    check(allowed.includes('https://localhost'),
      `服务器接受 https://localhost（这是配对手机能访问局域网服务器的前提）`)
  }
}

console.log('\n' + '='.repeat(64))
console.log(`  检查项 ${checks}   失败 ${failures}`)
if (failures) {
  console.log('  验证未通过')
  process.exit(1)
}
console.log('  全部通过：本地资源的路径映射与 MIME 类型都正确。')
console.log('='.repeat(64))
