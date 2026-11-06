#!/usr/bin/env node
// Converts the Simplified dictionary into the Traditional one.
//
// Chinese has no algorithm that turns Simplified into Traditional: some characters have
// several Traditional forms and the right one depends on the word (发 → 發 / 髮, 干 → 乾 /
// 幹 / 干). A character-by-character rewrite gets those wrong, so the conversion runs on
// words first and falls back to single characters.
//
// The word table is OpenCC's, vendored under catalogue/i18n-dictionaries/opencc/. It is the
// reference implementation's data, so the result is the one a reader expects.
//
// The input is the Simplified dictionary (descriptions.zh.json), the output the Traditional
// one (descriptions.zh-TW.json). Both are keyed by the English description.
//
// Usage: node scripts/catalogue/make-zh-tw-dictionary.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = path.join(ROOT, 'catalogue/i18n-dictionaries')
const OCC = path.join(DIR, 'opencc')

/** OpenCC stores its tables as "简体 繁體|简体 繁體|…". */
function loadTable(file) {
  const text = fs.readFileSync(path.join(OCC, file), 'utf8')
  const body = text.slice(text.indexOf('"') + 1, text.lastIndexOf('"'))
  const map = new Map()
  for (const pair of body.split('|')) {
    const [from, to] = pair.split(' ')
    if (from && to) map.set(from, to)
  }
  return map
}

// The tables, in the order OpenCC's own preset applies them: the phrase tables first, so a
// word that needs a specific form (里面 → 裡面) wins over the character default (里 → 裡).
// The twp preset is what OpenCC uses for Traditional Chinese with phrases:
//   TWVariantsRev → TWVariantsRevPhrases → TWPhrasesRev
// and the Simplified side is STPhrases → STCharacters.
const charMap = loadTable('STCharacters.js')
const phraseMaps = [
  loadTable('TWVariantsRevPhrases.js'),
  loadTable('TWPhrasesRev.js'),
  loadTable('STPhrases.js'),
]

// The vocabulary of this domain differs from OpenCC's general dictionary in a few places:
// Taiwan says 捲腹 for a crunch, not 卷腹. These are applied after the conversion.
const DOMAIN = {
  '卷腹': '捲腹', '仰臥卷': '仰臥捲', '卷起': '捲起', '卷動': '捲動', '向上卷': '向上捲',
  '卷至': '捲至', '卷回': '捲回', '卷向': '捲向', '屈捲': '屈捲',
}

const maxPhrase = Math.max(...phraseMaps.map((m) => {
  let max = 0
  for (const k of m.keys()) if (k.length > max) max = k.length
  return max
}))

const convert = (s) => {
  let out = ''
  let i = 0
  while (i < s.length) {
    let matched = false
    // The domain's own words first.
    for (const [from, to] of Object.entries(DOMAIN)) {
      if (s.startsWith(from, i)) { out += to; i += from.length; matched = true; break }
    }
    if (matched) continue
    // A phrase of up to maxPhrase characters, longest first.
    for (let len = Math.min(maxPhrase, s.length - i); len >= 2; len--) {
      const slice = s.substr(i, len)
      for (const m of phraseMaps) {
        const to = m.get(slice)
        if (to) { out += to; i += len; matched = true; break }
      }
      if (matched) break
    }
    if (matched) continue
    const c = s[i]
    out += charMap.get(c) ?? c
    i++
  }
  return out
}

/** Convert one dictionary file and write the Traditional one next to it.
 *
 *  The file holds a note and a table under it (descriptions / steps). The table is keyed by
 *  the English source string, and the value is the translation, so every string in it is
 *  converted — the keys stay as they are. */
function convertDict(name, note) {
  const src = path.join(DIR, name)
  const text = fs.readFileSync(src, 'utf8')
  const data = JSON.parse(text.slice(text.indexOf('{')))

  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) { out[k] = v; continue }
    out[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, convert(vv)]))
  }

  const dst = path.join(DIR, name.replace('.zh.', '.zh-TW.'))
  fs.writeFileSync(dst, `// ${note}\n` + JSON.stringify(out, null, 2) + '\n', 'utf8')
  const count = Object.values(out).reduce((n, v) => n + Object.keys(v).length, 0)
  console.log(`  ${path.basename(dst)}  ${count} 条`)
}

console.log('转换为繁体：')
convertDict('descriptions.zh.json', '繁體中文的動作描述。鍵是英文描述原文，與 descriptions.zh.json 相同。')
convertDict('common-steps.zh.json', '繁體中文的通用動作步驟。鍵是英文步驟原文，與 common-steps.zh.json 相同。')
