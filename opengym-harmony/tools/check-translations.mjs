// Reports how complete the translations are.
//
// Three things can leave a Chinese speaker looking at English text:
//   1. a key the app asks for is missing from the interface pack
//   2. an action has no translated description, so the detail sheet shows the English one
//   3. an action has no translated steps, so the how-to shows the English ones
//
// The counts come from the language packs themselves, so this follows the code rather than
// a hand-written list. It is a report, not a gate: a partially translated language is a
// normal state, and the report says how far along it is.
//
// Usage: node tools/check-translations.mjs [lang ...]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND = path.join(HERE, '..', '..', 'openGym', 'frontend')
const SRC = path.join(FRONTEND, 'src')
const LOCALES = path.join(SRC, 'locales')

/** Read a language pack into pairs.
 *
 *  These files are ES modules exporting an object literal, so the JS engine parses them —
 *  far more reliably than a hand-written character scanner. The old scanner lost its place
 *  on escaped quotes and on entries whose key uses one quote style and value another: it
 *  reported 1471 keys for a 2448-key pack, which made this report look far worse than the
 *  translation actually was. */
function readPack(file) {
  const text = fs.readFileSync(file, 'utf8')
  const obj = new Function(text.replace('export default', 'return '))()
  return Object.entries(obj)
}

/** The action packs hold `export default JSON.parse('…')`. Evaluate the whole expression so
 *  the engine handles the string literal's escaping before JSON.parse sees its content. */
function readActionPack(file) {
  const text = fs.readFileSync(file, 'utf8')
  try { return new Function(text.replace('export default', 'return '))() }
  catch { return null }
}

const langs = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const targets = langs.length ? langs : ['zh', 'zh-TW']

for (const lang of targets) {
  const packFile = path.join(LOCALES, `${lang}.js`)
  if (!fs.existsSync(packFile)) {
    console.error(`没有这个语言包：${packFile}`)
    continue
  }

  console.log(`\n${'='.repeat(58)}`)
  console.log(`语言：${lang}`)
  console.log('='.repeat(58))

  // 1. The interface pack.
  const pack = readPack(packFile)
  const map = new Map(pack)
  const untranslated = pack.filter(([k, v]) => k === v)
  const placeholderMismatch = pack.filter(([k, v]) => {
    const ph = (s) => (s.match(/\{[0-9]+\}/g) || []).sort().join(',')
    return ph(k) !== ph(v)
  })
  console.log(`\n[界面文案]  ${pack.length} 条`)
  console.log(`  未翻译（值=键）  ${untranslated.length}`)
  console.log(`  占位符不匹配    ${placeholderMismatch.length}`)

  // 2. The action descriptions.
  const descFile = path.join(SRC, 'exercise-desc', `${lang}.js`)
  const enDescFile = path.join(SRC, 'exercise-desc', 'en.js')
  const enDesc = fs.existsSync(enDescFile) ? readActionPack(enDescFile) : null
  if (enDesc) {
    const own = fs.existsSync(descFile) ? readActionPack(descFile) : null
    const have = own ? Object.keys(own).length : 0
    const total = Object.keys(enDesc).length
    const pct = total ? (have / total * 100) : 100
    console.log(`\n[动作描述]  ${have} / ${total}  (${pct.toFixed(1)}%)`)
    if (have < total) {
      console.log(`  缺 ${total - have} 条 —— 这些动作在详情页显示英文描述`)
    }
  }

  // 3. The instruction steps.
  const instrFile = path.join(SRC, 'instr', `${lang}.js`)
  const enInstrFile = path.join(SRC, 'instr', 'en.js')
  const enInstr = fs.existsSync(enInstrFile) ? readActionPack(enInstrFile) : null
  if (enInstr) {
    const own = fs.existsSync(instrFile) ? readActionPack(instrFile) : null
    const have = own ? Object.keys(own).length : 0
    const total = Object.keys(enInstr).length
    const pct = total ? (have / total * 100) : 100
    console.log(`\n[动作步骤]  ${have} / ${total}  (${pct.toFixed(1)}%)`)
    if (have < total) {
      console.log(`  缺 ${total - have} 条 —— 这些动作在详情页显示英文步骤`)
    }
  }

  // 4. The action names.
  const namesFile = path.join(SRC, 'exercise-names', `${lang}.js`)
  const names = fs.existsSync(namesFile) ? readActionPack(namesFile) : null
  if (names) {
    console.log(`\n[动作名称]  ${Object.keys(names).length} 条`)
  }
}
