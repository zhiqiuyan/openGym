// 审计 openGym 前端各语言包中残留的英文句子
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/openGym/frontend/src';

function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const body = src.replace('export default', 'return ');
  return new Function(body)();
}

const hasCJK = (s) => /[\u4e00-\u9fff]/.test(s);
const isEnglish = (s) => !hasCJK(s) && /[A-Za-z]{3}/.test(s);

const DIRS = ['instr', 'exercise-desc', 'exercise-names'];

for (const dir of DIRS) {
  console.log(`\n########## ${dir} ##########`);
  const dirPath = path.join(ROOT, dir);
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.js'));
  const langs = ['en', 'zh', 'zh-TW'].filter((l) => files.includes(`${l}.js`));
  const data = {};
  for (const l of langs) {
    const obj = load(path.join(dirPath, `${l}.js`));
    const vals = Object.values(obj);
    const isArr = Array.isArray(vals[0]);
    const sentences = isArr ? vals.flat() : vals;
    const eng = sentences.filter(isEnglish);
    data[l] = { obj, keys: Object.keys(obj).length, total: sentences.length, eng: eng.length };
    console.log(
      `${l.padEnd(6)} keys=${data[l].keys} sentences=${data[l].total} english=${data[l].eng} zh=${data[l].total - data[l].eng}`
    );
  }

  // key 与数组长度对齐检查
  if (data.en && data.zh) {
    const enKeys = Object.keys(data.en.obj), zhKeys = Object.keys(data.zh.obj);
    const onlyEn = enKeys.filter((k) => !(k in data.zh.obj));
    const onlyZh = zhKeys.filter((k) => !(k in data.en.obj));
    console.log(`  keys only in en: ${onlyEn.length}, only in zh: ${onlyZh.length}`);
    let lenMismatch = 0;
    for (const k of enKeys) {
      if (!(k in data.zh.obj)) continue;
      const a = data.en.obj[k], b = data.zh.obj[k];
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) lenMismatch++;
    }
    console.log(`  array-length mismatches (en vs zh): ${lenMismatch}`);
  }

  // 英文残留样例
  if (data.zh) {
    const samples = [];
    for (const [k, v] of Object.entries(data.zh.obj)) {
      const arr = Array.isArray(v) ? v : [v];
      arr.forEach((s, i) => {
        if (samples.length < 15 && isEnglish(s)) samples.push(`  [${k}][${i}] ${s}`);
      });
    }
    console.log('  zh english samples:');
    samples.forEach((s) => console.log(s));
  }

  // 繁体版是否可作为翻译来源
  if (data['zh-TW'] && data.en) {
    let aligned = 0, twEnglish = 0, twEmpty = 0;
    for (const [k, v] of Object.entries(data.en.obj)) {
      const tw = data['zh-TW'].obj[k];
      if (!tw) continue;
      if (Array.isArray(v) && Array.isArray(tw) && v.length === tw.length) {
        aligned++;
        tw.forEach((s) => { if (isEnglish(s)) twEnglish++; if (!s || !String(s).trim()) twEmpty++; });
      }
    }
    console.log(`  zh-TW aligned keys with en: ${aligned}, tw english sentences: ${twEnglish}, tw empty: ${twEmpty}`);
  }
}
