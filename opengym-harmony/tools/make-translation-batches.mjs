// 把待译英文句切成可并行翻译的分片，并生成术语/风格基准文件
import fs from 'node:fs';
import path from 'node:path';

const HERE = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/opengym-harmony/tools';
const OUT = path.join(HERE, 'zh-batches');
const DICT = 'd:/文档/WorkBuddy/2026-10-28-14-27-47/openGym/catalogue/i18n-dictionaries';

fs.mkdirSync(OUT, { recursive: true });
// 清空旧分片，避免上一轮的残留混进本轮
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f), { force: true });

const steps = JSON.parse(fs.readFileSync(path.join(HERE, 'need-new-steps.json'), 'utf8'));
const desc = JSON.parse(fs.readFileSync(path.join(HERE, 'need-new-desc.json'), 'utf8'));
const all = [...new Set([...steps, ...desc])].sort();

const SIZE = 400;
const batches = [];
for (let i = 0; i < all.length; i += SIZE) {
  const name = `batch-${String(batches.length).padStart(3, '0')}.json`;
  const chunk = all.slice(i, i + SIZE);
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(chunk, null, 1), 'utf8');
  batches.push(name);
}

// 既有译文的风格基准，让各分片用词一致
const readDict = (file, key) => {
  const t = fs.readFileSync(path.join(DICT, file), 'utf8');
  return JSON.parse(t.slice(t.indexOf('{')))[key];
};
const stepDict = readDict('common-steps.zh.json', 'steps');
const descDict = readDict('descriptions.zh.json', 'descriptions');
const pick = (obj, n) => Object.entries(obj).filter(([k]) => k.length < 90).slice(0, n);

const style = [
  '# 简体中文翻译规范（openGym 动作库）',
  '',
  '## 输出格式',
  '输出一个 JSON 对象：`{ "英文原句": "中文译文", ... }`，键必须与输入分片中的句子**逐字一致**（含标点与大小写）。',
  '每个输入句子都必须有对应条目，不允许遗漏、不允许合并、不允许改写键。值为纯简体中文译文字符串。',
  '',
  '## 文体',
  '- 健身动作指导/说明，面向普通用户。用简洁、直接、口语可执行的祈使句，不要书面腔。',
  '- 保持原句的语气与信息量：原文一句，译文一句；不要添加解释、不要省略动作细节。',
  '- 保留原文中的数字、单位（如 45 degree、kg）与专有名词的通用译法，数字用阿拉伯数字。',
  '- 句末用中文句号「。」；原文无句号时译文也可不加句号，但要与同批保持自然。',
  '- 不要使用繁体字。不要输出 markdown、注释或 JSON 以外的任何文字。',
  '',
  '## 术语对照（务必统一）',
  'reps / repetitions → 次数 / 重复次数；set → 组；band / resistance band → 弹力带；dumbbell → 哑铃；',
  'barbell → 杠铃；kettlebell → 壶铃；cable → 绳索；machine → 器械；bench → 卧推凳；',
  'core → 核心；abs → 腹肌；glutes → 臀肌；quads → 股四头肌；hamstrings → 腘绳肌；',
  'calves → 小腿；lats → 背阔肌；shoulder blades → 肩胛骨；hips → 髋部 / 臀部（按语境）；',
  'starting position → 起始位置；engage → 收紧；squeeze → 收紧 / 挤压；brace → 绷紧；',
  'lower → 下放 / 降低；raise / lift → 抬起；push → 推；pull → 拉；hold → 保持；pause → 停顿；',
  'steadily / slowly → 缓慢地；controlled → 有控制地；through the full range of motion → 全程活动范围；',
  'anchor → 固定 / 锚点；stance → 站姿；grip → 握；palms → 手掌；knees → 膝盖；elbows → 手肘；',
  'athletic stance → 运动站姿；split squat → 分腿蹲；leg press → 腿举；plank → 平板支撑；',
  'Pallof press → 帕洛夫推举；Pilates → 普拉提；Smith machine → 史密斯机；sled → 雪橇。',
  '',
  '## 既有译文示例（对齐用词与节奏）',
  '',
  ...pick(stepDict, 30).map(([k, v]) => `- ${k} → ${v}`),
  '',
  '## 既有描述译文示例',
  '',
  ...pick(descDict, 12).map(([k, v]) => `- ${k} → ${v}`),
  '',
].join('\n');

fs.writeFileSync(path.join(OUT, 'STYLE.md'), style, 'utf8');
fs.writeFileSync(path.join(HERE, 'batch-index.json'), JSON.stringify({ total: all.length, size: SIZE, batches }, null, 2), 'utf8');
console.log(`唯一待译句: ${all.length}`);
console.log(`分片: ${batches.length} 个 × ${SIZE} 句`);
console.log(`输出目录: ${OUT}`);
