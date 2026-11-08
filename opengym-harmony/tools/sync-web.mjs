#!/usr/bin/env node
/*
 * sync-web.mjs — build the openGym front end and put it into the Harmony package.
 *
 * The Harmony shell is an ArkUI Web component, and the page it shows is the same React app
 * the other phones run. This script builds it with the two flags the phone build needs
 * (VITE_MOBILE for the standalone build, VITE_HARMONY for the Capacitor-compatible shims)
 * and copies the result into entry/src/main/resources/rawfile, where the Web component
 * loads it from ($rawfile('index.html')).
 *
 *   node tools/sync-web.mjs              build and sync
 *   node tools/sync-web.mjs --no-build   sync what is already in frontend/dist
 *   node tools/sync-web.mjs --no-media   sync without the exercise media (small build)
 *   node tools/sync-web.mjs --watch      rebuild on every change
 *
 * The front end lives in the openGym checkout next to this project (../openGym by default).
 * Point somewhere else with --frontend <path>.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RAWFILE = path.join(ROOT, 'entry/src/main/resources/rawfile')

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const FRONTEND = path.resolve(opt('--frontend', path.join(ROOT, '..', 'openGym', 'frontend')))
const DIST = path.join(FRONTEND, 'dist')
const NO_BUILD = flag('--no-build')
const WATCH = flag('--watch')
const NO_MEDIA = flag('--no-media')

/** The openGym checkout, where the exercise media live. */
const OPENGYM = path.resolve(FRONTEND, '..')
const STAGE_MEDIA = path.join(OPENGYM, 'scripts/catalogue/stage-media.mjs')
const CATALOGUE_MEDIA = path.join(OPENGYM, 'catalogue/media')

function run(cmd, cmdArgs, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...(env || {}) }
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${code}`))
    })
  })
}

/** The Harmony app manifest is the single source of truth for this edition's version. */
function harmonyVersion() {
  const manifest = path.join(ROOT, 'AppScope/app.json5')
  const m = fs.readFileSync(manifest, 'utf8').match(/"versionName"\s*:\s*"([^"]+)"/)
  if (!m) throw new Error(`在 ${manifest} 中找不到 versionName`)
  return m[1]
}

/** The phone build needs both flags: MOBILE for the standalone app, HARMONY for the shims. */
async function build() {
  const version = harmonyVersion()
  console.log(`· 构建前端（VITE_MOBILE=1 VITE_HARMONY=1，鸿蒙版 v${version}）`)
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await run(npm, ['run', 'build'], FRONTEND, {
    VITE_MOBILE: '1',
    VITE_HARMONY: '1',
    VITE_HARMONY_VERSION: version
  })
}

/** Copy a directory tree, file by file.
 *
 * fs.cpSync with recursive:true proved unreliable on Windows here — the process died part way
 * through the copy and left the package half filled. Copying the tree by hand is slower but
 * it finishes, and it can say which file it was on when something went wrong.
 *
 * `seen` collects the relative paths that were written so the caller can prune stale files.
 * A short retry covers the transient EPERM/EBUSY Windows raises while a thumbnailer or an
 * antivirus scanner holds a destination file open.
 */
function copyTree(src, dst, seen, rel = '') {
  fs.mkdirSync(dst, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dst, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      copyTree(from, to, seen, childRel)
    } else {
      for (let attempt = 0; ; attempt++) {
        try {
          fs.copyFileSync(from, to)
          break
        } catch (error) {
          if (attempt >= 4) throw new Error(`复制 ${childRel} 失败：${error.message}`)
          const pause = new Int32Array(new SharedArrayBuffer(4))
          Atomics.wait(pause, 0, 0, 40 * (attempt + 1))
        }
      }
      seen.add(childRel)
    }
  }
}

/** List every file below `dir` as a relative, slash-separated path. */
function listFiles(dir, rel = '', out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) listFiles(path.join(dir, entry.name), childRel, out)
    else out.push(childRel)
  }
  return out
}

/**
 * Copy the exercise stills and animations next to the built app.
 *
 * The catalogue's media are not part of the front-end build: vite copies what is in public/,
 * and the drawings live in catalogue/media (48 MB of stills, 172 MB of animations, 6554 each).
 * The Android release stages them into the package with the same script this one calls;
 * without that step the phone shows the neutral dumbbell tile where the exercise drawing
 * should be, because every <img> points at a file that is not there.
 *
 * The licences allow this: the media are licensed to openGym for use inside the app, and a
 * compiled package is exactly that. They may not be copied out of it, which is why they go
 * into rawfile/ (inside the package) and not somewhere a user can browse.
 */
async function stageMedia() {
  if (NO_MEDIA) {
    console.log('· 跳过动作媒体（--no-media）')
    return { stills: 0, clips: 0 }
  }
  if (!fs.existsSync(STAGE_MEDIA)) {
    throw new Error(`找不到媒体暂存脚本：${STAGE_MEDIA}\n` +
      'openGym 的检出目录不对，用 --frontend <path> 指过去。')
  }
  if (!fs.existsSync(CATALOGUE_MEDIA)) {
    throw new Error(`找不到动作媒体目录：${CATALOGUE_MEDIA}\n` +
      '这一份 openGym 检出里没有 catalogue/media，动作图无法打包。')
  }
  console.log('· 暂存动作媒体（静帧 + 动画）')
  // The old media go first: a drawing that is no longer in the catalogue would otherwise
  // stay in the package, and the page would ask for a file the build does not know about.
  const mediaDir = path.join(DIST, 'exercise-media')
  fs.rmSync(mediaDir, { recursive: true, force: true })
  await run(process.execPath, [STAGE_MEDIA, DIST], OPENGYM, {})
  const stills = fs.readdirSync(path.join(DIST, 'exercise-media/still')).length
  const clips = fs.readdirSync(path.join(DIST, 'exercise-media/clip')).length
  return { stills, clips }
}

/** Copy the built app into the package.
 *
 * Wiping the whole rawfile tree first is brittle on Windows: a single file held open by a
 * thumbnailer or antivirus makes fs.rmSync fail with EPERM and leaves the package half empty.
 * Instead overwrite in place, then delete only the files the new build no longer contains.
 * A stale file that cannot be removed is harmless — asset names are content-hashed and nothing
 * references it — so per-file failures are reported rather than fatal.
 */
function sync() {
  if (!fs.existsSync(DIST)) {
    throw new Error(`没有找到前端产物：${DIST}\n先不带 --no-build 跑一次，或手动构建前端。`)
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`前端产物不完整：${DIST} 里没有 index.html`)
  }
  const seen = new Set()
  copyTree(DIST, RAWFILE, seen)

  const stale = listFiles(RAWFILE).filter((rel) => !seen.has(rel))
  let removed = 0
  const blocked = []
  for (const rel of stale) {
    try {
      fs.unlinkSync(path.join(RAWFILE, rel))
      removed++
    } catch (error) {
      blocked.push(`${rel} (${error.code || error.message})`)
    }
  }

  // The bundle references its own files with relative paths (base: './'), which is what the
  // file:// scheme needs. Nothing has to be rewritten.
  const index = fs.readFileSync(path.join(RAWFILE, 'index.html'), 'utf8')
  const assets = fs.readdirSync(path.join(RAWFILE, 'assets')).filter((f) => f.endsWith('.js'))
  const langs = assets.filter((f) => /^[a-z]{2}(-[A-Z]{2})?-[A-Za-z0-9_-]+\.js$/.test(f))

  console.log(`· 已同步到 ${path.relative(ROOT, RAWFILE)}`)
  console.log(`  index.html      ${(index.length / 1024).toFixed(1)} KB`)
  console.log(`  assets          ${assets.length} 个脚本`)
  console.log(`  语言包          ${langs.length} 个`)
  console.log(`  写入文件        ${seen.size} 个，清理旧文件 ${removed}/${stale.length} 个`)
  if (blocked.length) {
    console.log(`  ⚠ ${blocked.length} 个旧文件暂时无法删除（不影响打包）：${blocked.slice(0, 3).join('; ')}`)
  }
  return { assets: assets.length, langs: langs.length, written: seen.size, removed, blocked: blocked.length }
}

async function main() {
  if (!fs.existsSync(FRONTEND)) {
    console.error(`找不到前端工程：${FRONTEND}`)
    console.error('用 --frontend <path> 指到 openGym/frontend。')
    process.exit(1)
  }
  if (!NO_BUILD) {
    await build()
  }
  // The media are staged before the copy, so they land in rawfile/ together with the bundle.
  const media = await stageMedia()
  const stats = sync()
  if (media.stills) {
    console.log(`  动作静帧        ${media.stills} 个`)
    console.log(`  动作动画        ${media.clips} 个`)
  }
  console.log('· 完成。在 DevEco Studio 里打开本工程即可运行。')
  if (WATCH) {
    console.log('· 监听前端改动（Ctrl+C 退出）')
    fs.watch(path.join(FRONTEND, 'src'), { recursive: true }, () => {
      build().then(stageMedia).then(sync).catch((e) => console.error(e.message))
    })
  }
  return { ...stats, ...media }
}

main().catch((error) => {
  console.error('· 失败：', error.message)
  process.exit(1)
})
