// 接口说明检查：src/core 的每个导出都写进了 docs/API.md 它所在文件的一节；游戏导入的名字在“给游戏用的”部分；说明里提到的文件都存在
// 用法：node scripts/core/apicheck.mjs
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const SRC = resolve('src');
const DOC = 'docs/API.md';
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
};
walk(SRC);
const rel = (p) => relative(SRC, p).split('\\').join('/');
const resolveSpec = (from, spec) => {
  const base = resolve(dirname(from), spec);
  return [base, `${base}.ts`, join(base, 'index.ts')].find((c) => existsSync(c) && statSync(c).isFile());
};

const bad = [];
const exports = new Map();
for (const f of files.filter((f) => rel(f).startsWith('core/'))) {
  const src = readFileSync(f, 'utf8');
  if (/^export\s*(\*|\{)/m.test(src)) bad.push(`${rel(f)}：用了 export { } 或 export *，这个检查只认逐个声明的导出`);
  const names = [...src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:class|function|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (names.length) exports.set(rel(f), names);
}

// 每个标题里的文件各有一组“提到的名字”；“框架内部”之后的算内部
const mentioned = new Map();
let current = [];
let internal = false;
for (const line of readFileSync(DOC, 'utf8').split('\n')) {
  if (/^##\s/.test(line)) {
    internal = line.includes('框架内部');
    current = [];
    continue;
  }
  if (/^#{3,}\s/.test(line)) {
    current = [...line.matchAll(/`(core\/[^`]+\.ts)`/g)].map((m) => m[1].slice(5));
    for (const c of current) if (!existsSync(join(SRC, 'core', c))) bad.push(`${DOC} 提到的文件不存在：core/${c}`);
    continue;
  }
  for (const m of line.matchAll(/`([A-Za-z_$][\w$]*)/g))
    for (const c of current) {
      const key = `core/${c}`;
      if (!mentioned.has(key)) mentioned.set(key, new Map());
      const seen = mentioned.get(key);
      if (!internal || !seen.has(m[1])) seen.set(m[1], internal ? 'internal' : 'public');
    }
}

let total = 0;
for (const [file, names] of exports)
  for (const n of names) {
    total++;
    if (!mentioned.get(file)?.has(n)) bad.push(`${file} 的 ${n} 没写进 ${DOC}`);
  }

const used = new Set();
for (const f of files.filter((f) => !rel(f).startsWith('core/'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s+'(\.{1,2}\/[^']*)'/g)) {
    const target = resolveSpec(f, m[2]);
    if (!target || !rel(target).startsWith('core/')) continue;
    const to = rel(target);
    if (m[1] === undefined) {
      bad.push(`${rel(f)}：整个导入了 ${to}，请逐个导入用到的名字`);
      continue;
    }
    for (const part of m[1].split(',')) {
      const n = part.replace(/^\s*type\s+/, '').replace(/\s+as\s+\w+/, '').trim();
      if (!n) continue;
      used.add(`${to}:${n}`);
      if (mentioned.get(to)?.get(n) !== 'public') bad.push(`${rel(f)} 用了 ${to} 的 ${n}，它不在 ${DOC} 的“给游戏用的”部分`);
    }
  }
}

for (const b of bad) console.log(b);
console.log(bad.length ? `${bad.length} 处问题` : `${total} 个导出都有说明，游戏用到其中 ${used.size} 个`);
process.exit(bad.length ? 1 : 0);
