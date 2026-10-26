import { TERMS, type TermId } from '../packages/gui/src/terms.js';

const termWords: TermId[] = ['弦', '回路', '调性', '力迫', '和弦'];
const offenders: string[] = [];

for (const [id, def] of Object.entries(TERMS)) {
  for (const field of ['anchor', 'example'] as const) {
    const text = def[field];
    for (const word of termWords) {
      if (text.includes(word)) offenders.push(`${id}.${field} 里出现了术语「${word}」：${text}`);
    }
  }
  if (def.anchor.length > 30) offenders.push(`${id}.anchor 超过 30 字：${def.anchor.length}`);
}

console.log('L1 术语：', Object.keys(TERMS).join('、'));
for (const [id, def] of Object.entries(TERMS)) {
  console.log(`\n${id}\n  锚：${def.anchor}\n  例：${def.example}\n  展开：${def.detail}`);
}

if (offenders.length > 0) {
  console.log('\nFAIL');
  for (const o of offenders) console.log(' -', o);
  process.exitCode = 1;
} else {
  console.log('\nPASS 五个锚点与例子都没有用术语解释术语');
}
