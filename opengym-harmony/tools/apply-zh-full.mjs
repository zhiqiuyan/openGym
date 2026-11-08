// 把各分片译文回填到 catalogue/i18n/zh.json，并报告残留英文。
//
//   node apply-zh-full.mjs --check   只报告，不写
//   node apply-zh-full.mjs           写入 zh.json
//
// 只处理简体中文包。英文源句一律取自 catalogue/exercises/<id>.json（生成 en.js 的同一份
// 数据），因此逐句位置严格对齐；已有中文译文保持不动。
import fs from 'node:fs';
import path from 'node:path';

const HERE = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/opengym-harmony/tools';
const BATCH = path.join(HERE, 'zh-batches');
const CAT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/openGym/catalogue';
const I18N = path.join(CAT, 'i18n/zh.json');
const DICT = path.join(CAT, 'i18n-dictionaries');
const check = process.argv.includes('--check');

const hasCJK = (s) => typeof s === 'string' && /[\u4e00-\u9fff]/.test(s);
const isEng = (s) => typeof s === 'string' && !hasCJK(s) && /[A-Za-z]{3}/.test(s);
const readDict = (file, key) => {
  const t = fs.readFileSync(path.join(DICT, file), 'utf8');
  return JSON.parse(t.slice(t.indexOf('{')))[key];
};

// 1. 合并所有分片译文
const enToZh = { ...readDict('common-steps.zh.json', 'steps'), ...readDict('descriptions.zh.json', 'descriptions') };
let fromBatches = 0;
const problems = [];
for (const f of fs.readdirSync(BATCH).filter((x) => /^out-\d+\.json$/.test(x)).sort()) {
  const src = path.join(BATCH, f.replace(/^out-/, 'batch-'));
  const want = JSON.parse(fs.readFileSync(src, 'utf8'));
  let got;
  try { got = JSON.parse(fs.readFileSync(path.join(BATCH, f), 'utf8')); }
  catch (e) { problems.push(`${f}: 无法解析 (${e.message})`); continue }
  const missing = want.filter((s) => !(s in got) || !hasCJK(got[s]));
  if (missing.length) problems.push(`${f}: ${missing.length}/${want.length} 句缺译文或译文无中文`);
  let n = 0;
  for (const s of want) if (hasCJK(got[s])) { if (!(s in enToZh)) n++; enToZh[s] = got[s] }
  fromBatches += n;
}

// 2. 英文源数据
const en = {};
for (const f of fs.readdirSync(path.join(CAT, 'exercises'))) {
  if (!f.endsWith('.json')) continue;
  const e = JSON.parse(fs.readFileSync(path.join(CAT, 'exercises', f), 'utf8'));
  if (e.variantOf) continue;
  en[String(e.id)] = e;
}

// 3. 逐动作回填
const pack = JSON.parse(fs.readFileSync(I18N, 'utf8'));
let filledSteps = 0, filledDesc = 0, remainSteps = 0, remainDesc = 0;
const remainKeys = [];
for (const [id, row] of Object.entries(pack)) {
  const src = en[id];
  if (!src) continue;

  if (!hasCJK(row.description) && src.description) {
    const zh = enToZh[src.description];
    if (hasCJK(zh)) { row.description = zh; filledDesc++ }
    else remainDesc++;
  }

  const source = src.instructions || [];
  if (!source.length) continue;
  const out = Array.isArray(row.instructions) ? row.instructions.slice() : source.slice();
  // 长度必须与英文一致，否则前端图文错位
  if (out.length !== source.length) out.splice(source.length);
  let stillEng = 0;
  source.forEach((s, i) => {
    if (hasCJK(out[i])) return;
    const zh = enToZh[s];
    if (hasCJK(zh)) { out[i] = zh; filledSteps++ }
    else { stillEng++; remainSteps++ }
  });
  row.instructions = out;
  if (stillEng) remainKeys.push([id, stillEng, source.length]);
}

console.log('=== 译文合并 ===');
console.log(`分片新增句对        : ${fromBatches}`);
console.log(`合并后查找表        : ${Object.keys(enToZh).length} 条`);
console.log(`本轮回填步骤句      : ${filledSteps}`);
console.log(`本轮回填描述句      : ${filledDesc}`);
console.log(`仍为英文的步骤句    : ${remainSteps}`);
console.log(`仍为英文的描述句    : ${remainDesc}`);
console.log(`仍有英文的动作数    : ${remainKeys.length}`);
if (problems.length) {
  console.log('\n=== 分片问题 ===');
  problems.forEach((p) => console.log('  ' + p));
}
if (remainKeys.length) {
  console.log('\n前 10 个未全覆盖动作:');
  remainKeys.slice(0, 10).forEach(([id, n, of]) => console.log(`  ${id}: ${n}/${of} 句仍英文`));
}

// 全量句对存档，便于复查与重跑
fs.writeFileSync(path.join(HERE, 'zh-translations.json'), JSON.stringify(enToZh, null, 1), 'utf8');

if (!check) {
  const ordered = {};
  for (const [id, row] of Object.entries(pack)) {
    const out = { name: row.name };
    if (Array.isArray(row.instructions) && row.instructions.length) out.instructions = row.instructions;
    if (row.description) out.description = row.description;
    ordered[id] = out;
  }
  fs.writeFileSync(I18N, JSON.stringify(ordered, null, 1) + '\n');
  console.log('\n已写入 catalogue/i18n/zh.json');
} else {
  console.log('\n（--check：未写入 zh.json）');
}

if (remainSteps || remainDesc || problems.length) process.exitCode = 2;
