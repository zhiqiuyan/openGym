// Adds the "some steps in English" string to every language pack.
//
// The interface says when a list of steps is only partly translated. The English source
// string is the key, so every pack needs the entry; without it the line would read in
// English inside an otherwise translated screen.
//
// Usage: node scripts/catalogue/add-locale-key.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const LOCALES = path.join(ROOT, 'frontend/src/locales')

// The translations. Each language says the same thing: some of the steps are in English.
const T = {
  ar: 'بعض الخطوات بالإنجليزية',
  bn: 'কিছু ধাপ ইংরেজিতে',
  de: 'Einige Schritte auf Englisch',
  es: 'algunos pasos en inglés',
  fr: 'quelques étapes en anglais',
  hi: 'कुछ चरण अंग्रेज़ी में',
  hu: 'néhány lépés angolul',
  it: 'alcuni passaggi in inglese',
  ko: '일부 단계는 영어로 제공',
  pl: 'część kroków po angielsku',
  pt: 'alguns passos em inglês',
  'pt-BR': 'alguns passos em inglês',
  ru: 'некоторые шаги на английском',
  sv: 'vissa steg på engelska',
  th: 'บางขั้นตอนเป็นภาษาอังกฤษ',
  tr: 'bazı adımlar İngilizce',
  uk: 'деякі кроки англійською',
  zh: '部分步骤为英文',
  'zh-TW': '部分步驟為英文',
}

const KEY = "'some steps in English'"
const ANCHOR = "'instructions in English'"

for (const [lang, value] of Object.entries(T)) {
  const file = path.join(LOCALES, `${lang}.js`)
  if (!fs.existsSync(file)) { console.log(`  跳过（没有语言包）：${lang}`); continue }
  const text = fs.readFileSync(file, 'utf8')
  if (text.includes(KEY)) { console.log(`  已存在：${lang}`); continue }

  // The new entry goes right after the one it sits beside, keeping the pack's order.
  const lines = text.split('\n')
  const at = lines.findIndex((l) => l.includes(ANCHOR))
  if (at < 0) { console.log(`  找不到锚点：${lang}`); continue }
  const indent = (lines[at].match(/^\s*/) || [''])[0]
  lines.splice(at + 1, 0, `${indent}${KEY}: '${value}',`)
  fs.writeFileSync(file, lines.join('\n'), 'utf8')
  console.log(`  ✓ ${lang}: ${value}`)
}
