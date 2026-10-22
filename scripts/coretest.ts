/**
 * 框架层的单元测试，不依赖任何游戏：空间求交、存档登记、事件记录、模拟内核、词典登记。
 * npx tsx scripts/coretest.ts
 */
import * as THREE from 'three';
import { ENGINE } from '../src/core/config';
import { L, registerDicts, tr } from '../src/core/i18n';
import { HeightfieldSpace } from '../src/core/space/heightfield';
import { SaveRegistry } from '../src/core/sim/saves';
import { Simulation } from '../src/core/sim/simulation';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// ---------------- 高度场空间 ----------------
{
  const box = new THREE.Box3(new THREE.Vector3(-50, -10, -50), new THREE.Vector3(50, 80, 50));
  const sp = new HeightfieldSpace((x) => x * 0.5, 40, box);
  const out = new THREE.Vector3();
  const down = new THREE.Ray(new THREE.Vector3(4, 30, 3), new THREE.Vector3(0, -1, 0));
  const hit = sp.raycast(down, out);
  check('竖直向下的射线落在斜面上 (4, 2, 3)', !!hit && near(out.x, 4) && near(out.y, 2) && near(out.z, 3), out.toArray());
  const slant = new THREE.Ray(new THREE.Vector3(-10, 20, 0), new THREE.Vector3(1, -1, 0).normalize());
  sp.raycast(slant, out);
  check('斜射线的交点在地面上', near(out.y, out.x * 0.5, 0.02), out.toArray());
  check('起点在地下时没有交点', sp.raycast(new THREE.Ray(new THREE.Vector3(0, -5, 0), new THREE.Vector3(0, -1, 0)), out) === null);
  check('交点在可放置范围外时为 null', sp.raycast(new THREE.Ray(new THREE.Vector3(30, 40, 0), new THREE.Vector3(0, -1, 0)), out) === null);
  check('朝天的射线没有交点', sp.raycast(new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 1, 0)), out) === null);
  check('surfaceAt 就是高度场', sp.surfaceAt(6, 0) === 3);
}

// ---------------- 存档登记 ----------------
{
  const order: string[] = [];
  const r = new SaveRegistry();
  r.add('a', () => 1, (d) => order.push(`a${d}`));
  r.add('b', () => ({ x: 2 }), (d) => order.push(`b${d.x}`));
  r.add('late', () => 'L', (d) => order.push(`late${d}`), true);
  const saved = r.save();
  check('保存出每个部分', JSON.stringify(saved) === '{"a":1,"b":{"x":2},"late":"L"}', saved);
  r.restore({ b: { x: 5 }, a: 7 });
  check('按登记顺序恢复，可选部分缺了跳过', order.join(',') === 'a7,b5', order);
  let threw = false;
  try {
    r.restore({ a: 1 });
  } catch {
    threw = true;
  }
  check('缺必需部分时报错', threw);
  threw = false;
  try {
    r.add('a', () => 0, () => {});
  } catch {
    threw = true;
  }
  check('重名的部分报错', threw);
}

// ---------------- 模拟内核与事件 ----------------
{
  const sim = new Simulation<{ id: number }>(600, 6);
  const seen: string[] = [];
  sim.addSystem('first', () => seen.push('1'));
  sim.addSystem('second', () => seen.push('2'));
  sim.advance(ENGINE.loop.fixedStep * 3.5);
  check('每步按登记顺序调用子系统', seen.join('') === '121212', seen.join(''));
  check('时钟走了 3 步', near(sim.clock.seconds, ENGINE.loop.fixedStep * 3, 1e-9));
  check('开局时刻 6:00', near(sim.clock.hour, 6, 0.01), sim.clock.hour);
  sim.clock.paused = true;
  sim.advance(1);
  check('暂停时不推进', sim.lastSteps === 0);
  sim.clock.paused = false;
  sim.clock.speed = 10;
  sim.advance(1, Infinity, 5);
  check('每帧最多 maxSteps 步', sim.lastSteps === 5, sim.lastSteps);

  sim.events.locate = (r) => (r.id === 1 ? { x: 1, y: 2, z: 3 } : null);
  for (let i = 0; i < 12; i++) sim.events.push(L('raw', { s: `e${i}` }), { id: i % 3 });
  const e = sim.events.entries;
  check('事件最多 8 条，新的在前', e.length === 8 && tr(e[0].msg) === 'e11', e.map((x) => tr(x.msg)).join(' '));
  check('省略位置时取对象现在的位置', e.find((x) => x.ref?.id === 1)?.at?.join(',') === '1,2,3');
  const s = sim.events.toSave((r) => r.id !== 2);
  check('不稳定的对象存档时只留位置', s.every((x) => x.ref?.id !== 2) && s.length === 8);
  sim.events.restore([{ t: '第1天 08:00', msg: '旧存档里拼好的文字' }]);
  check('读旧格式的事件', tr(sim.events.entries[0].msg) === '旧存档里拼好的文字');
  const saved = sim.saves.save() as { clock: { seconds: number; speed: number } };
  check('时钟由内核自己存档', near(saved.clock.seconds, sim.clock.seconds, 1e-9) && saved.clock.speed === 10);
}

// ---------------- 词典登记 ----------------
{
  let threw = false;
  try {
    registerDicts({ zh: { raw: 'x' }, en: { raw: 'x' } });
  } catch {
    threw = true;
  }
  check('和框架重名的键报错', threw);
}

console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
