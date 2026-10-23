/**
 * 框架层的单元测试，不依赖任何游戏：图上行走、地表转向与绕行、行为协程、空间求交、存档登记、实体注册表、事件记录、模拟内核、词典登记。
 * npx tsx scripts/core/coretest.ts
 */
import * as THREE from 'three';
import { ENGINE } from '../../src/core/config';
import { L, registerDicts, tr } from '../../src/core/i18n';
import { HeightfieldSpace } from '../../src/core/space/heightfield';
import { VolumeSpace } from '../../src/core/space/volume';
import { SaveRegistry } from '../../src/core/sim/saves';
import { Simulation } from '../../src/core/sim/simulation';
import { GraphWalker, Routes, samplePolyline, type GraphEdge } from '../../src/core/move/graph';
import { Skirt, turnToward } from '../../src/core/move/surface';
import { Behavior } from '../../src/core/sim/behavior';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) < eps;

// ---------------- 图上行走 ----------------
{
  // 0 -2- 1 -3- 2 -1- 3，另有一条更长的 0-2 捷径；4 不连通
  const edges: GraphEdge[] = [
    { a: 0, b: 1, length: 2 },
    { a: 1, b: 2, length: 3 },
    { a: 2, b: 3, length: 1 },
    { a: 0, b: 2, length: 6 },
  ];
  const routes = new Routes();
  routes.build(5, edges);
  check('最短路经过 1 而不是捷径', routes.nextHop(0, 2) === 1 && routes.length(0, 2) === 5);
  check('不连通时下一跳是 -1', routes.nextHop(0, 4) === -1);
  const g = {
    nextHop: (a: number, b: number) => routes.nextHop(a, b),
    edgeBetween: (a: number, b: number) => edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))!,
  };
  const w = new GraphWalker<GraphEdge>();
  w.at(0);
  const r1 = w.advance(g, 1.5, 3);
  check('走到第一条边的中段', r1 === 'walking' && w.edge === edges[0] && w.s === 1.5 && w.nearNode() === 1 && w.along() === 1.5 && w.dir() === 1);
  const r2 = w.advance(g, 4, 3);
  check('一步跨过两个节点', r2 === 'walking' && w.edge === edges[2] && near(w.s, 0.5, 1e-9) && near(w.walked, 4, 1e-9), { r2, s: w.s, walked: w.walked });
  const r3 = w.advance(g, 2, 3);
  check('到达后走过的距离只算到终点', r3 === 'arrived' && w.node === 3 && w.edge === null && near(w.walked, 0.5, 1e-9));
  check('反向走时沿边坐标从 a 端量', w.advance(g, 0.25, 2) === 'walking' && w.dir() === -1 && w.along() === 0.75);
  w.at(4);
  check('没有路', w.advance(g, 1, 0) === 'noRoute' && !w.moved);
  const pe = { a: 0, b: 1, length: 4, points: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 0, 0), new THREE.Vector3(2, 0, 2)], cum: [0, 2, 4] };
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  samplePolyline(pe, 1, 1, p, t);
  check('从 b 端取折线上的点和切线', near(p.x, 2) && near(p.z, 1) && near(t.z, -1), [p.toArray(), t.toArray()]);
}

// ---------------- 地表转向与绕行 ----------------
{
  check('转向受角速度限制', near(turnToward(0, 1, 2, 0.1), 0.2));
  check('转向走近的一侧（跨过 ±π）', turnToward(3, -3, 10, 1) > 3);
  const s = new Skirt();
  const h1 = s.steer(-1, 0, 0, 0, 0);
  check('绕行方向和障碍相切', near(Math.abs(Math.cos(h1)), 0, 1e-9));
  let h = h1;
  let flipped = -1;
  for (let i = 0; i < 40; i++) {
    s.track(-1, 0, 0.1);
    h = s.steer(-1, 0, h, 0, 0);
    if (flipped < 0 && near(Math.cos(h - h1), -1, 1e-9)) flipped = i;
  }
  check('一直走不出去时约 3 秒后换方向', flipped >= 29 && flipped <= 31, flipped);
  for (let i = 0; i < 20; i++) s.track(5, 5, 0.1);
  check('被困反向后离开障碍再碰上，仍保持新方向', near(Math.cos(s.steer(-1, 0, h1, 0, 0) - h), 1, 1e-9));
  for (let i = 0; i < 220; i++) s.track(9, 9, 0.1);
  check('保持期过后按朝向重新选择', near(Math.cos(s.steer(-1, 0, h1, 0, 0) - h1), 1, 1e-9));
  // 在 (-1, 0) 绕圆心 (0, 0)，朝障碍是 0 方向
  check('贴边时朝障碍一侧弯', Math.cos(s.hug(h1, 2, 0.5)) > 0.8 && s.following(25));
  for (let i = 0; i < 16; i++) s.track(-1, 0, 0.1);
  check('一段时间没碰到障碍就不再贴边', !s.following(25));
}

// ---------------- 行为协程 ----------------
{
  type Cmd = { k: string; n: number };
  const b = new Behavior<Cmd>();
  const log: string[] = [];
  let made = 0;
  function* routine(): Generator<Cmd, void, unknown> {
    made++;
    const got = yield { k: 'a', n: 2 };
    log.push(`got ${got}`);
    yield { k: 'b', n: 1 };
  }
  const left = new Map<Cmd, number>();
  const exec = (c: Cmd, first: boolean) => {
    if (first) left.set(c, c.n);
    log.push(`${c.k}${first ? '!' : ''}`);
    const n = left.get(c)! - 1;
    left.set(c, n);
    if (n > 0) return false;
    if (c.k === 'a') b.result = 42;
    return true;
  };
  b.run(routine, exec);
  b.run(routine, exec);
  check('命令跨帧执行，完成后同一帧接着下一条、结果传回协程，协程结束后同一帧开始新协程', log.join(' ') === 'a! a got 42 b! a!' && made === 2, log.join(' '));
  log.length = 0;
  b.run(routine, exec, 2);
  check('每帧最多执行 maxCmds 条命令', made === 2 && log.join(' ') === 'a got 42 b!', log.join(' '));
  b.abort();
  log.length = 0;
  b.run(routine, exec, 1);
  check('abort 丢掉当前命令和协程，下一帧从新协程开头开始', made === 3 && log.join(' ') === 'a!' && b.started, log.join(' '));
  function* urgent(): Generator<Cmd, void, unknown> {
    yield { k: 'z', n: 1 };
  }
  b.start(urgent());
  log.length = 0;
  b.run(routine, exec, 3);
  check('start 换成指定的协程，它结束后再用 next 开新任务', made === 4 && log.join(' ') === 'z! a!', log.join(' '));
}

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

// ---------------- 体积空间 ----------------
{
  const vol = new THREE.Box3(new THREE.Vector3(-10, 0, -5), new THREE.Vector3(10, 10, 5));
  const cam = new THREE.Box3(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 100, 100));
  const sp = new VolumeSpace(vol, (x) => 1 + x * 0.05, cam);
  const out = new THREE.Vector3();
  const cast = (o: number[], d: number[]) => sp.raycast(new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize()), out);
  check('从上方看落在顶面', !!cast([0, 20, 0], [0, -1, 0]) && near(out.y, 10) && near(out.x, 0));
  check('顶面以外没有交点', cast([20, 20, 0], [0, -1, 0]) === null);
  check('隔着侧壁看落在底面', !!cast([0, 8, -15], [0, -0.5, 1]) && near(out.y, 1) && near(out.z, -1), out.toArray());
  check('在里面往下看落在底面', !!cast([4, 5, 0], [0, -1, 0]) && near(out.y, 1.2));
  check('在里面往上看落在到顶面这段的中点', !!cast([0, 5, 0], [0, 1, 0]) && near(out.y, 7.5, 0.3), out.toArray());
  check('隔着前后壁看水里落在盒中那段的中点', !!cast([3, 5, -15], [0, 0, 1]) && near(out.z, 0, 0.3) && near(out.y, 5) && near(out.x, 3), out.toArray());
  check('盒子外的表面是盒底', sp.surfaceAt(0, 0) === 1 && sp.surfaceAt(50, 0) === 0);
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

  const order2: string[] = [];
  const r2 = new SaveRegistry();
  r2.addLast('z', () => 0, () => order2.push('z'));
  r2.add('a', () => 0, () => order2.push('a'));
  r2.restore({ z: 0, a: 0 });
  check('addLast 的部分最后恢复', order2.join('') === 'az', order2);
  order2.length = 0;
  r2.restore({ a: 0 });
  check('addLast 的部分缺了跳过', order2.join('') === 'a', order2);
}

// ---------------- 随机数 ----------------
{
  const a = new Simulation(600, 6, 42);
  const b = new Simulation(600, 6, 42);
  check('同一种子的随机序列相同', a.rng.next() === b.rng.next() && a.rng.next() === b.rng.next());
  a.rng.next();
  const saved = JSON.parse(JSON.stringify(a.saves.save()));
  const want = [a.rng.next(), a.rng.next()];
  const c = new Simulation(600, 6, 42);
  c.saves.restore(saved);
  check('读档后接着产生存档时的序列', c.rng.next() === want[0] && c.rng.next() === want[1]);
}

// ---------------- 模拟内核与事件 ----------------
{
  type Ref = { kind: 'bug'; id: number } | { kind: 'rock' };
  const sim = new Simulation<Ref>(600, 6, 1);
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

  const bug = { x: 1, y: 2, z: 3 };
  sim.entities.define('bug', { pos: (r) => (r.id === 1 ? bug : null), viewDistance: 5, follow: true, unstable: true });
  sim.entities.define('rock', {});
  check('实体：位置、观察距离、能否跟随', sim.entities.pos({ kind: 'bug', id: 1 }) === bug && sim.entities.viewDistance({ kind: 'bug', id: 1 }) === 5 && sim.entities.canFollow({ kind: 'bug', id: 0 }));
  check('实体：没给的项取默认值', sim.entities.pos({ kind: 'rock' }) === null && sim.entities.viewDistance({ kind: 'rock' }) === sim.entities.defaultViewDistance && !sim.entities.canFollow({ kind: 'rock' }) && sim.entities.stable({ kind: 'rock' }));
  let dup = false;
  try {
    sim.entities.define('rock', {});
  } catch {
    dup = true;
  }
  check('实体类型重复登记时报错', dup);
  for (let i = 0; i < 12; i++) sim.events.push(L('raw', { s: `e${i}` }), i % 3 === 2 ? { kind: 'rock' } : { kind: 'bug', id: i % 3 });
  const e = sim.events.entries;
  check('事件最多 8 条，新的在前', e.length === 8 && tr(e[0].msg) === 'e11', e.map((x) => tr(x.msg)).join(' '));
  check('省略位置时取实体注册表里的位置', e.find((x) => x.ref?.kind === 'bug' && x.ref.id === 1)?.at?.join(',') === '1,2,3');
  const s = sim.events.toSave((r) => sim.entities.stable(r));
  check('不稳定的对象存档时只留位置', s.every((x) => x.ref?.kind !== 'bug') && s.some((x) => x.ref?.kind === 'rock') && s.length === 8);
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
