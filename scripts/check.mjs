// 一键检查。用法：
//   node scripts/check.mjs                 类型、依赖、框架单测、词典、鱼缸，固定编号的模拟和基线对比，蚂蚁的存档、工具、防御、天气、瓢虫、性能测试
//   node scripts/check.mjs --fast          只跑前五项（一分钟内）
//   node scripts/check.mjs --ui            构建后跑浏览器测试；开发服务器没开时自己起一个
//   node scripts/check.mjs --all           全部
//   node scripts/check.mjs --update-baseline   模拟行为有意改变时，用这次的输出更新基线
//   node scripts/check.mjs --only=基线,存档   只跑名字里含这些词的项
// 输出都按 UTF-8 收集，不经过终端的编码转换，所以基线在哪台机器上录都一样
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update-baseline');
const FAST = args.has('--fast');
const ALL = args.has('--all');
const ONLY_UI = args.has('--ui') && !ALL;

const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const TSC = resolve('node_modules/typescript/bin/tsc');
const VITE = resolve('node_modules/vite/bin/vite.js');
const BASELINE = resolve('scripts/games/ant/baseline/sim.txt');
const DEV = 'http://localhost:5173/';

/** 去掉每次都不一样的耗时，剩下的应该逐行相同 */
const normalize = (s) =>
  s
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/ avg tick=[\d.]+ms/, '').replace(/^init \d+ ms, /, 'init '))
    .join('\n')
    .trimEnd();

function exec(argv, env = {}) {
  return new Promise((done) => {
    const t0 = performance.now();
    const p = spawn(process.execPath, argv, { env: { ...process.env, ...env } });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => chunks.push(d));
    p.on('close', (code) => done({ code, out: Buffer.concat(chunks).toString('utf8'), sec: (performance.now() - t0) / 1000 }));
  });
}

const tsx = (script, ...rest) => [TSX, script, ...rest];

const simCheck = (out) => {
  const now = normalize(out);
  if (!existsSync(BASELINE) && process.env.CI) return { error: '缺少模拟基线，请在本地运行后提交' };
  if (UPDATE || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, now + '\n');
    return { report: '基线已更新' };
  }
  const a = normalize(readFileSync(BASELINE, 'utf8')).split('\n');
  const b = now.split('\n');
  const diff = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff.push(`  第 ${i + 1} 行\n    基线 ${a[i] ?? '（没有）'}\n    现在 ${b[i] ?? '（没有）'}`);
  return diff.length ? { error: `和基线有 ${diff.length} 行不同（行为有意改变时加 --update-baseline）\n${diff.slice(0, 6).join('\n')}` } : { report: `${b.length} 行与基线相同` };
};

const lastLine = (re) => (out) => ({ report: out.split('\n').find((l) => re.test(l))?.trim() ?? '' });

const FAST_STEPS = [
  { name: '类型检查（源码）', argv: [TSC, '--noEmit'] },
  { name: '类型检查（脚本）', argv: [TSC, '--noEmit', '-p', 'tsconfig.scripts.json'] },
  { name: '依赖方向', argv: ['scripts/core/layercheck.mjs'] },
  { name: '接口说明', argv: ['scripts/core/apicheck.mjs'], judge: lastLine(/个导出都有说明/) },
  { name: '框架单元测试', argv: tsx('scripts/core/coretest.ts') },
  { name: '界面文字', argv: tsx('scripts/i18ncheck.ts') },
  { name: '鱼缸示例', argv: tsx('scripts/games/aquarium/aquatest.ts'), judge: lastLine(/模拟 \d+ 秒/) },
];

const NODE_STEPS = [
  { name: '模拟基线（5 天）', argv: tsx('scripts/games/ant/simtest.ts', '3000'), judge: simCheck },
  { name: '存档往返', argv: tsx('scripts/games/ant/savetest.ts') },
  { name: '存档往返（下雨中途）', argv: tsx('scripts/games/ant/savetest.ts', '1900', 'rain') },
  { name: '干预工具', argv: tsx('scripts/games/ant/tooltest.ts') },
  { name: '防御', argv: tsx('scripts/games/ant/defensetest.ts') },
  { name: '天气', argv: tsx('scripts/games/ant/weathertest.ts') },
  { name: '瓢虫与蚜虫', argv: tsx('scripts/games/ant/ladybugtest.ts'), judge: lastLine(/^全部通过/) },
  { name: '拥挤（3000 只）', argv: tsx('scripts/games/ant/crowdtest.ts'), judge: lastLine(/^休息室最挤/) },
  { name: '性能（3000 只）', argv: tsx('scripts/games/ant/perftest.ts'), judge: lastLine(/^1 倍速/) },
];

const UI_STEPS = [
  { name: '构建', argv: [TSC, '--noEmit'], then: [[VITE, 'build'], [VITE, 'build', '--mode', 'aquarium']] },
  ...['saveui', 'selecttest', 'touchtest', 'mousetest', 'qualitytest', 'pwatest', 'musictest'].map((n) => ({ name: `浏览器 ${n}`, argv: [`scripts/ui/${n}.mjs`] })),
  {
    name: '各屏幕布局',
    argv: ['scripts/ui/layoutshots.mjs'],
    judge: (out) => {
      const over = out.split('\n').filter((l) => l.includes('超出屏幕'));
      return over.length ? { error: over.join('\n') } : { report: '截图在 shots/layout/，没有超出屏幕的面板' };
    },
  },
];

async function devServer() {
  const up = () => fetch(DEV).then((r) => r.ok, () => false);
  if (await up()) return null;
  const p = spawn(process.execPath, [VITE, '--port', '5173', '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
  return p;
}

const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const picked = ONLY ? [...FAST_STEPS, ...NODE_STEPS, ...UI_STEPS].filter((s) => ONLY.some((o) => s.name.includes(o))) : null;
const steps = picked ?? (ONLY_UI ? UI_STEPS : [...FAST_STEPS, ...(FAST ? [] : NODE_STEPS), ...(ALL ? UI_STEPS : [])]);
const results = [];
let server = null;
try {
  for (const s of steps) {
    if (s.name.startsWith('浏览器') && server === null) server = (await devServer()) ?? false;
    let r = await exec(s.argv, s.env);
    for (const more of s.then ?? []) {
      if (r.code !== 0) break;
      const r2 = await exec(more);
      r = { code: r2.code, out: r.out + r2.out, sec: r.sec + r2.sec };
    }
    const j = r.code === 0 ? (s.judge?.(r.out) ?? {}) : { error: r.out.trimEnd().split('\n').slice(-30).join('\n') };
    const ok = !j.error;
    results.push({ name: s.name, ok, sec: r.sec });
    console.log(`${ok ? '通过' : '失败'}  ${s.name.padEnd(16)} ${r.sec.toFixed(1).padStart(6)} 秒  ${j.report ?? ''}`);
    if (!ok) console.log(j.error.replace(/^/gm, '      '));
  }
} finally {
  if (server) server.kill();
}
const failed = results.filter((r) => !r.ok);
const total = results.reduce((s, r) => s + r.sec, 0);
console.log(`\n${results.length} 项，${failed.length ? `${failed.length} 项失败：${failed.map((r) => r.name).join('、')}` : '全部通过'}（${(total / 60).toFixed(1)} 分钟）`);
process.exit(failed.length ? 1 : 0);
