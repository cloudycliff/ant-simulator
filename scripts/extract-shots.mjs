// 从浏览器场景捕获结果中提取所有截图：node scripts/extract-shots.mjs <capture.txt> <输出前缀>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , input, prefix = 'shots/shot'] = process.argv;
const j = JSON.parse(readFileSync(input, 'utf8'));
mkdirSync(dirname(prefix), { recursive: true });
let n = 0;
const walk = (o, path) => {
  if (!o || typeof o !== 'object') return;
  if (typeof o.data_base64 === 'string' && o.media_type === 'image/png') {
    const file = `${prefix}-${n++}.png`;
    writeFileSync(file, Buffer.from(o.data_base64, 'base64'));
    console.log(file, path);
    return;
  }
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
};
walk(j, '$');
for (const e of j.normalized_result?.events?.items ?? []) if (e.level === 'error' || e.kind === 'page-error') console.log('ERR', e.text);
if (!n) console.log('no screenshots');
