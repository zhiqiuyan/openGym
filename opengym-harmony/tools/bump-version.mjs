#!/usr/bin/env node
// Bump the HarmonyOS edition's version. Run from anywhere:
//
//   node tools/bump-version.mjs patch          # 1.0.1 -> 1.0.2 (bug fixes)
//   node tools/bump-version.mjs minor          # 1.0.1 -> 1.1.0 (new features)
//   node tools/bump-version.mjs major          # 1.0.1 -> 2.0.0 (breaking changes)
//   node tools/bump-version.mjs 1.2.3          # set an explicit version
//   node tools/bump-version.mjs patch --note "修复 AI 教练 API key 保存" --dry-run
//
// AppScope/app.json5 is the single source of truth. tools/sync-web.mjs reads its versionName
// and passes it to the front end as VITE_HARMONY_VERSION, so the version shown in Settings is
// always the version of the installed package. This script changes three things there:
//
//   versionName   semver, bumped by the argument above
//   versionCode   +1 on every release (HarmonyOS only installs over an older package when this
//                 is strictly greater; it is deliberately NOT derived from the version name,
//                 so a 1.0.9 -> 1.1.0 jump cannot accidentally go backwards)
//   buildVersion  +1, echoed into pack.info as version.build
//
// It also prepends a section to CHANGELOG.md. It deliberately does NOT build anything: after a
// bump, run tools/sync-web.mjs, then assembleHap, then publish a NEW release tag
// harmony-v<version> with its own HAP. Never overwrite an existing release's assets — a
// published version number must always point at exactly one immutable package.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = path.join(ROOT, 'AppScope', 'app.json5')
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const noteIdx = args.indexOf('--note')
const note = noteIdx >= 0 ? (args[noteIdx + 1] || '') : ''
const positional = args.filter((a, i) => !a.startsWith('--') && !(noteIdx >= 0 && i === noteIdx + 1))
const what = positional[0] || 'patch'

const src = fs.readFileSync(MANIFEST, 'utf8')
const read = (key) => {
  const m = src.match(new RegExp('"' + key + '"\\s*:\\s*"?([^",\\s}]+)'))
  if (!m) throw new Error(`在 ${MANIFEST} 中找不到 ${key}`)
  return m[1].replace(/"/g, '')
}
const oldName = read('versionName')
const oldCode = Number(read('versionCode'))
const oldBuild = Number(read('buildVersion'))
if (!/^\d+\.\d+\.\d+$/.test(oldName)) throw new Error(`versionName 不是 semver: ${oldName}`)
if (!Number.isInteger(oldCode) || !Number.isInteger(oldBuild)) throw new Error('versionCode / buildVersion 必须是整数')

const [MAJ, MIN, PAT] = oldName.split('.').map(Number)
let next
if (/^\d+\.\d+\.\d+$/.test(what)) next = what
else if (what === 'patch') next = `${MAJ}.${MIN}.${PAT + 1}`
else if (what === 'minor') next = `${MAJ}.${MIN + 1}.0`
else if (what === 'major') next = `${MAJ + 1}.0.0`
else throw new Error(`未知的版本增量: ${what}（可用 patch / minor / major / X.Y.Z）`)

const cmp = (a, b) => a.split('.').map(Number).reduce((acc, n, i) => acc || n - b.split('.').map(Number)[i], 0)
if (cmp(next, oldName) <= 0) throw new Error(`新版本 ${next} 必须大于当前版本 ${oldName}`)

const newCode = oldCode + 1
const newBuild = oldBuild + 1
const today = new Date().toISOString().slice(0, 10)

let out = src
  .replace(/("versionCode"\s*:\s*)\d+/, `$1${newCode}`)
  .replace(/("versionName"\s*:\s*")[^"]+(")/, `$1${next}$2`)
  .replace(/("buildVersion"\s*:\s*")[^"]+(")/, `$1${newBuild}$2`)
if (out === src) throw new Error('清单未被修改，请检查 app.json5 格式')

console.log(`版本: ${oldName} (code ${oldCode}, build ${oldBuild}) -> ${next} (code ${newCode}, build ${newBuild})`)

// Prepend the changelog section, keeping the rule header at the top of the file.
const header = `# 鸿蒙版版本记录

版本号遵循 semver，与 Android / Web / iOS 的版本线完全独立。\`AppScope/app.json5\` 是唯一来源：
\`versionName\` 显示给用户，\`versionCode\` 每版 +1（覆盖安装要求严格递增），\`buildVersion\` 每版 +1。

每次发版：\`node tools/bump-version.mjs <patch|minor|major> --note "..."\` → \`node tools/sync-web.mjs\`
→ \`assembleHap\` → 新建 tag \`harmony-v<版本>\` 与独立 Release（**不要覆盖已有 Release 的附件**）。
Release 附件名带版本号，另附 \`.sha256\` 与 \`SHA256SUMS\`。\`/releases/latest\` 始终指向最新版，
应用内「检查更新」与仓库 README 都用这个地址，发新版无需改代码。

`
let log = fs.existsSync(CHANGELOG) ? fs.readFileSync(CHANGELOG, 'utf8') : header
if (!log.startsWith('# 鸿蒙版版本记录')) log = header + log
const firstSection = log.indexOf('\n## ')
const section = `## ${next} (${today})\n\n${note ? `- ${note}\n` : '- （待补充本版改动）\n'}\n`
log = firstSection < 0
  ? log.trimEnd() + '\n\n' + section
  : log.slice(0, firstSection + 1) + section + log.slice(firstSection + 1)

if (dryRun) {
  console.log('--dry-run：不写文件。将写入的 CHANGELOG 片段：\n' + section)
} else {
  fs.writeFileSync(MANIFEST, out, 'utf8')
  fs.writeFileSync(CHANGELOG, log, 'utf8')
  console.log(`已更新 ${path.relative(ROOT, MANIFEST)} 与 ${path.relative(ROOT, CHANGELOG)}`)
  console.log('\n下一步：')
  console.log('  1) node tools/sync-web.mjs                 # 用新版本号重建前端并同步 rawfile')
  console.log('  2) hvigorw assembleHap --mode module -p product=default -p buildMode=debug')
  console.log(`  3) 新建 Release harmony-v${next}，附件 openGym-Harmony-${next}-<日期>-unsigned.hap`)
  console.log('     （若沿用旧包替换 rawfile，记得同步 pack.info / module.json 里的版本号与 code）')
}
