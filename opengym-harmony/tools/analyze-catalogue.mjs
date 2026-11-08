// 基于 catalogue 源数据，统计简体中文包补全翻译所需的规模与可复用覆盖率
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/openGym/catalogue';
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'i18n/zh.json'), 'utf8'));
const DICT = path.join(ROOT, 'i18n-dictionaries');

const hasCJK = (s) => typeof s === 'string' && /[\u4e00-\u9fff]/.test(s);
const isEng = (s) => typeof s === 'string' && !hasCJK(s) && /[A-Za-z]{3}/.test(s);

// 英文源数据
const en = {};
for (const f of fs.readdirSync(path.join(ROOT, 'exercises'))) {
  if (!f.endsWith('.json')) continue;
  const e = JSON.parse(fs.readFileSync(path.join(ROOT, 'exercises', f), 'utf8'));
  if (e.variantOf) continue;
  en[String(e.id)] = e;
}

const readDict = (file, key) => {
  const t = fs.readFileSync(path.join(DICT, file), 'utf8');
  return JSON.parse(t.slice(t.indexOf('{')))[key];
};
const descDict = readDict('descriptions.zh.json', 'descriptions');
const stepDict = readDict('common-steps.zh.json', 'steps');

// 从 zh.json 已翻译内容中抽取 英文->中文 句对（只保留唯一译法且译文确为中文）
const votes = new Map();
for (const [id, row] of Object.entries(pack)) {
  if (!row.instructions) continue;
  const src = en[id]?.instructions;
  if (!src || src.length !== row.instructions.length) continue;
  src.forEach((s, i) => {
    const zh = row.instructions[i];
    if (!hasCJK(zh)) return;              // 该位置仍是英文，跳过
    if (!votes.has(s)) votes.set(s, new Map());
    const v = votes.get(s);
    v.set(zh, (v.get(zh) || 0) + 1);
  });
}
const reused = new Map();
for (const [s, v] of votes) if (v.size === 1) reused.set(s, [...v.keys()][0]);

const stepLookup = { ...stepDict, ...Object.fromEntries(reused) };

console.log('=== 数据规模 ===');
console.log(`英文动作总数            : ${Object.keys(en).length}`);
console.log(`zh.json 已有动作        : ${Object.keys(pack).length}`);
console.log(`描述词典 descriptions  : ${Object.keys(descDict).length} 条`);
console.log(`步骤词典 common-steps  : ${Object.keys(stepDict).length} 条`);
console.log(`已译动作可复用句对      : ${reused.size} 条`);
console.log(`合并后步骤查找表        : ${Object.keys(stepLookup).length} 条`);

// --- instructions ---
let hasInstr = 0, noInstr = 0, partialEng = 0, totalEng = 0;
const engUnique = new Set();
const needNewSteps = new Set();
let coverStep = 0;
for (const [id, row] of Object.entries(pack)) {
  const src = en[id]?.instructions;
  if (!src || !src.length) continue;
  if (!row.instructions) {
    noInstr++;
    src.forEach((s) => { engUnique.add(s); if (stepLookup[s]) coverStep++; else needNewSteps.add(s); });
  } else {
    hasInstr++;
    row.instructions.forEach((s, i) => {
      if (isEng(s)) {
        partialEng++; totalEng++;
        const e = src[i] || s;
        engUnique.add(e);
        if (stepLookup[e]) coverStep++; else needNewSteps.add(e);
      }
    });
  }
}
console.log('\n=== 动作要领 instructions ===');
console.log(`已有译文的动作          : ${hasInstr}`);
console.log(`完全无译文的动作        : ${noInstr}`);
console.log(`已有译文中的英文残留句  : ${partialEng}`);
console.log(`涉及英文唯一句(含缺失)  : ${engUnique.size}`);
console.log(`可由词典/复用回填       : ${coverStep} / ${engUnique.size}`);
console.log(`需新译唯一英文句        : ${needNewSteps.size}`);

// --- description ---
let hasDesc = 0, noDesc = 0;
const descUnique = new Set();
const needNewDesc = new Set();
let coverDesc = 0;
for (const [id, row] of Object.entries(pack)) {
  const d = en[id]?.description;
  if (!d) continue;
  if (!row.description) {
    noDesc++;
    descUnique.add(d);
    if (descDict[d]) coverDesc++; else needNewDesc.add(d);
  } else hasDesc++;
}
console.log('\n=== 动作描述 description ===');
console.log(`已有描述 : ${hasDesc}, 缺失描述 : ${noDesc}`);
console.log(`缺失唯一英文描述 : ${descUnique.size}`);
console.log(`可由描述词典回填 : ${coverDesc}`);
console.log(`需新译唯一描述   : ${needNewDesc.size}`);

console.log(`\n=== 合计需新译唯一英文 : ${needNewSteps.size + needNewDesc.size} 句 ===`);

const OUT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/opengym-harmony/tools';
fs.writeFileSync(path.join(OUT, 'need-new-steps.json'), JSON.stringify([...needNewSteps].sort(), null, 2), 'utf8');
fs.writeFileSync(path.join(OUT, 'need-new-desc.json'), JSON.stringify([...needNewDesc].sort(), null, 2), 'utf8');
console.log('已导出 need-new-steps.json / need-new-desc.json');
