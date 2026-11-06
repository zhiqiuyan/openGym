#!/usr/bin/env node
// Fills a language's exercise packs from the translation dictionaries.
//
// An exercise has three translatable parts: its name, its steps and its description. The
// name lives in catalogue/i18n/<lang>.json; the steps and the description come from two
// dictionaries under catalogue/i18n-dictionaries/:
//
//   descriptions.<lang>.json    the one-line description ("what this exercise is")
//   common-steps.<lang>.json    the steps that read the same in every exercise
//
// Both dictionaries are keyed by the English source string, so a step that appears in
// several exercises needs one translation, not one per exercise. A step that names a
// muscle or a piece of equipment is deliberately not in the dictionary: it reads
// differently depending on the exercise, so it stays with the exercise it belongs to.
//
// An exercise is only given steps when every one of them is in the dictionary. Half a
// list, some of it English, is worse than the English list it would replace.
//
//   node scripts/catalogue/apply-translations.mjs            write the changes
//   node scripts/catalogue/apply-translations.mjs --check    report only
//   node scripts/catalogue/apply-translations.mjs --lang zh-TW

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const I18N = path.join(ROOT, 'catalogue/i18n')
// The dictionaries live in their own directory: the validator reads every json in
// catalogue/i18n/ as a language pack.
const DICT = path.join(ROOT, 'catalogue/i18n-dictionaries')
const EX = path.join(ROOT, 'catalogue/exercises')
const check = process.argv.includes('--check')
const langArg = process.argv.indexOf('--lang')
const lang = langArg >= 0 ? process.argv[langArg + 1] : 'zh'

/** The dictionary files may carry a comment line, which JSON.parse does not accept. */
function readDict(file) {
  const text = fs.readFileSync(file, 'utf8')
  return JSON.parse(text.slice(text.indexOf('{')))[file.includes('descriptions') ? 'descriptions' : 'steps']
}

const descDict = readDict(path.join(DICT, `descriptions.${lang}.json`))
const stepDict = readDict(path.join(DICT, `common-steps.${lang}.json`))

const packFile = path.join(I18N, `${lang}.json`)
const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'))

// The English description and steps of each exercise, and which ones the pack already has.
const en = {}
for (const f of fs.readdirSync(EX)) {
  if (!f.endsWith('.json')) continue
  const e = JSON.parse(fs.readFileSync(path.join(EX, f), 'utf8'))
  if (e.variantOf) continue          // a variant borrows the exercise it draws
  en[e.id] = e
}

let descFilled = 0
let stepFilled = 0
let stepSteps = 0
let partialSteps = 0
const missingDesc = []
const missingSteps = []

for (const [id, row] of Object.entries(pack)) {
  const e = en[id]
  if (!e) continue

  // The description: one line, taken from the dictionary.
  if (!row.description && e.description) {
    const zh = descDict[e.description]
    if (zh) { row.description = zh; descFilled++ }
    else missingDesc.push([id, e.description])
  }

  // The steps: each one that is in the dictionary is translated, and the ones that are
  // not stay in English. A list with some of it translated reads better than a list in
  // English from the top to the bottom — the reader can follow the parts they know and
  // the parts they do not, instead of giving up on the whole thing.
  //
  // The list keeps the English order and length, so the steps still line up with the
  // pictures beside them.
  if (!row.instructions && e.instructions && e.instructions.length) {
    const translated = e.instructions.map((s) => (s in stepDict ? stepDict[s] : s))
    const hit = translated.filter((s, i) => s !== e.instructions[i]).length
    if (hit) {
      row.instructions = translated
      stepFilled++
      stepSteps += hit
      if (hit < e.instructions.length) partialSteps++
    } else {
      missingSteps.push([id, e.instructions.length, e.instructions.length])
    }
  }
}

console.log(`语言：${lang}`)
console.log(`  描述词典      ${Object.keys(descDict).length} 条 → 补齐 ${descFilled} 个动作`)
console.log(`  步骤词典      ${Object.keys(stepDict).length} 条 → 补齐 ${stepFilled} 个动作（${stepSteps} 个步骤位）`)
console.log(`  其中部分翻译  ${partialSteps} 个动作（其余步骤仍是英文）`)
console.log(`  仍缺描述      ${missingDesc.length}`)
console.log(`  仍缺步骤      ${missingSteps.length}（一步都没译，保持英文）`)

if (!check) {
  // The pack keeps its shape: the fields the generator writes, in its order.
  const ordered = {}
  for (const [id, row] of Object.entries(pack)) {
    const out = { name: row.name }
    if (row.instructions) out.instructions = row.instructions
    if (row.description) out.description = row.description
    ordered[id] = out
  }
  fs.writeFileSync(packFile, JSON.stringify(ordered, null, 1) + '\n')
  console.log(`  已写入 ${path.relative(ROOT, packFile)}`)
} else {
  console.log('  （--check：未写入）')
}
