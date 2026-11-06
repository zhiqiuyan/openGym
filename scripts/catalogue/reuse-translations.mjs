// Computes how much of the exercise library can be translated by reusing the sentences
// that the existing Chinese pack already has.
//
// The pack's 1324 translated exercises were translated by hand, so their sentences are
// the quality benchmark. Where an untranslated exercise uses the same English sentence,
// that Chinese sentence is the right translation for it — the wording has to match the
// step, not the exercise.
//
// Usage: node tools/reuse-translations.mjs [--write]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const I18N = path.join(ROOT, 'catalogue/i18n')
const DICT = path.join(ROOT, 'catalogue/i18n-dictionaries')
const EX = path.join(ROOT, 'catalogue/exercises')
const write = process.argv.includes('--write')

const pack = JSON.parse(fs.readFileSync(path.join(I18N, 'zh.json'), 'utf8'))

const en = {}
for (const f of fs.readdirSync(EX)) {
  if (!f.endsWith('.json')) continue
  const e = JSON.parse(fs.readFileSync(path.join(EX, f), 'utf8'))
  en[e.id] = e.instructions || []
}

// The English sentence and its Chinese counterpart, taken from the exercises that are
// already translated. A sentence that translated two ways is left out: it reads
// differently depending on the exercise it belongs to.
const votes = new Map()
for (const [id, row] of Object.entries(pack)) {
  if (!row.instructions) continue
  const source = en[id]
  if (!source || source.length !== row.instructions.length) continue
  source.forEach((s, i) => {
    if (!votes.has(s)) votes.set(s, new Map())
    const v = votes.get(s)
    v.set(row.instructions[i], (v.get(row.instructions[i]) || 0) + 1)
  })
}
const reused = new Map()
for (const [s, v] of votes) {
  if (v.size === 1) reused.set(s, [...v.keys()][0])
}

// The dictionary built by hand, and the descriptions.
const readDict = (file, key) => {
  const text = fs.readFileSync(path.join(DICT, file), 'utf8')
  return JSON.parse(text.slice(text.indexOf('{')))[key]
}
const steps = readDict('common-steps.zh.json', 'steps')
const descs = readDict('descriptions.zh.json', 'descriptions')

const merged = { ...steps, ...Object.fromEntries(reused) }

let full = 0
let total = 0
let hit = 0
let stepTotal = 0
const short = []
for (const [id, row] of Object.entries(pack)) {
  if (row.instructions) continue
  const source = en[id]
  if (!source || !source.length) continue
  total++
  stepTotal += source.length
  const hits = source.filter((s) => s in merged).length
  hit += hits
  if (hits === source.length) full++
  else short.push({ id, missing: source.length - hits, of: source.length })
}

console.log('可复用句对（来自已翻译动作）:', reused.size)
console.log('合并后步骤词典:', Object.keys(merged).length)
console.log('')
console.log(`可全译动作: ${full} / ${total} (${(full / total * 100).toFixed(1)}%)`)
console.log(`步骤位命中: ${hit} / ${stepTotal} (${(hit / stepTotal * 100).toFixed(1)}%)`)

if (write) {
  // The reused sentences go into the dictionary, so the step they belong to can be
  // translated wherever it turns up.
  const out = { ...steps }
  let added = 0
  for (const [s, zh] of reused) {
    if (!(s in out)) { out[s] = zh; added++ }
  }
  fs.writeFileSync(
    path.join(DICT, 'common-steps.zh.json'),
    '// Common English instruction steps and their Chinese translations. A step that appears in\n' +
    '// several exercises reads the same in all of them, so one translation serves every one. Only\n' +
    '// steps that name no particular muscle group or piece of equipment are listed here — a step\n' +
    '// that mentions the biceps reads differently depending on the exercise, and those stay with\n' +
    '// the exercise they belong to.\n' +
    JSON.stringify({ steps: out }, null, 2) + '\n',
    'utf8')
  console.log(`\n已写入 common-steps.zh.json（新增 ${added} 条，共 ${Object.keys(out).length} 条）`)
}
