// 分析 instr 目录中：可用已有译文回填多少英文残留句，剩余多少需新译
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/openGym/frontend/src/instr';
const load = (f) => new Function(fs.readFileSync(path.join(ROOT, f), 'utf8').replace('export default', 'return '))();
const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
const isEnglish = (s) => typeof s === 'string' && !hasCJK(s) && /[A-Za-z]{3}/.test(s);

const en = load('en.js');
const zh = load('zh.js');
const tw = load('zh-TW.js');

// 建立 英文原句 -> 已有中文译文(简体) 的频次表
const zhMap = new Map();   // enSentence -> Map(zhSentence -> count)
const twMap = new Map();   // enSentence -> Map(twSentence -> count)
const add = (map, k, v) => {
  if (!map.has(k)) map.set(k, new Map());
  const m = map.get(k);
  m.set(v, (m.get(v) || 0) + 1);
};

for (const [k, arr] of Object.entries(en)) {
  const z = zh[k], t = tw[k];
  arr.forEach((s, i) => {
    const zs = Array.isArray(z) ? z[i] : undefined;
    const ts = Array.isArray(t) ? t[i] : undefined;
    if (zs && typeof zs === 'string' && zs.trim() && !isEnglish(zs)) add(zhMap, s, zs);
    if (ts && typeof ts === 'string' && ts.trim() && !isEnglish(ts)) add(twMap, s, ts);
  });
}
const best = (map, s) => {
  const m = map.get(s);
  if (!m) return null;
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

// 统计 zh 中残留英文
const pending = [];        // {key, idx, en}
const pendingUnique = new Set();
for (const [k, arr] of Object.entries(zh)) {
  const e = en[k];
  arr.forEach((s, i) => {
    if (isEnglish(s)) {
      const src = (Array.isArray(e) && e[i]) || s;
      pending.push({ key: k, idx: i, en: src });
      pendingUnique.add(src);
    }
  });
}

let coverZh = 0, coverTwOnly = 0, uncovered = 0;
const uncoveredSet = new Set();
for (const s of pendingUnique) {
  if (best(zhMap, s)) coverZh++;
  else if (best(twMap, s)) coverTwOnly++;
  else { uncovered++; uncoveredSet.add(s); }
}

console.log('=== 残留英文规模 ===');
console.log(`待翻译句子(含重复): ${pending.length}`);
console.log(`去重后唯一英文句: ${pendingUnique.size}`);
console.log('\n=== 回填覆盖率（按唯一句） ===');
console.log(`可由【简体已有译文】直接回填 : ${coverZh}`);
console.log(`仅能由【繁体译文】回填(需转简体): ${coverTwOnly}`);
console.log(`无任何参照、需新译          : ${uncovered}`);
console.log(`覆盖率(含繁体): ${(((coverZh + coverTwOnly) / pendingUnique.size) * 100).toFixed(1)}%`);

// 缺失 key 的规模
const missingKeys = Object.keys(en).filter((k) => !(k in zh));
const missingSentences = missingKeys.reduce((n, k) => n + (en[k].length || 0), 0);
const missingUnique = new Set();
for (const k of missingKeys) for (const s of en[k]) missingUnique.add(s);
console.log('\n=== 中文包完全缺失的动作 ID ===');
console.log(`缺失 key 数: ${missingKeys.length}, 对应句子: ${missingSentences}, 去重唯一句: ${missingUnique.size}`);
let mCover = 0;
for (const s of missingUnique) if (best(zhMap, s) || best(twMap, s)) mCover++;
console.log(`其中可由既有译文回填的唯一句: ${mCover} / ${missingUnique.size}`);

// 合并所有"需要新译"的唯一句（残留 + 缺失且无参照）
const needNew = new Set(uncoveredSet);
for (const s of missingUnique) if (!best(zhMap, s) && !best(twMap, s)) needNew.add(s);
console.log(`\n=== 合计需新译的唯一英文句: ${needNew.size} ===`);

fs.writeFileSync(
  path.join('d:/文档/WorkBuddy/2026-10-28-14-27-47/opengym-harmony/tools', 'need-new-translation.json'),
  JSON.stringify([...needNew].sort(), null, 2),
  'utf8'
);
fs.writeFileSync(
  path.join('d:/文档/WorkBuddy/2026-10-28-14-27-47/opengym-harmony/tools', 'pending-slots.json'),
  JSON.stringify(pending, null, 0),
  'utf8'
);
console.log('已导出 need-new-translation.json 与 pending-slots.json');
