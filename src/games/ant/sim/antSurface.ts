/** 蚂蚁在地表的运动：绕障碍、水洼和陷阱，返巢、搜索、走到某处、巡逻、爬植物。Ant.step 按指令调用 */
import * as THREE from 'three';
import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { alignToGround, turnToward } from '../../../core/move/surface';
import type { World } from '../world/world';
import type { Ant, Command } from './ant';

const _f = new THREE.Vector3();
const _n = new THREE.Vector3();

function skirt(a: Ant, cx: number, cz: number): void {
  a.heading = a.skirtNav.steer(a.pos.x, a.pos.z, a.heading, cx, cz);
}

/** 朝 heading 方向 hugProbe 以内有硬障碍 */
function blockedToward(a: Ant, w: World, heading: number): boolean {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const P = CONFIG.ant.hugProbe;
  for (let d = P / 3; d <= P + 1e-6; d += P / 3) if (w.veg.obstacleAt(a.pos.x + c * d, a.pos.z + s * d, 0.35, true)) return true;
  return false;
}

export function surfaceMove(a: Ant, dt: number, w: World, desired: number | null, turnRate = 5, speedMul = 1): void {
  if (desired !== null) {
    const A = CONFIG.ant;
    if (a.skirtNav.following(A.hugMax) && blockedToward(a, w, desired)) a.heading = a.skirtNav.hug(a.heading, A.hugRate, dt);
    else a.heading = turnToward(a.heading, desired, turnRate, dt);
  }
  const wetHere = w.water.at(a.pos.x, a.pos.z);
  const pit = w.predators.pitAt(a.pos.x, a.pos.z);
  let pdx = 0;
  let pdz = 0;
  let pull = 0;
  if (pit) {
    // 坑壁的松沙让蚂蚁往中心滑，越靠中心越陡；发觉打滑后拼命往坑外爬。蚁狮进食时不再扬沙，坑壁滑得慢
    const P = CONFIG.predators;
    pdx = a.pos.x - pit.x;
    pdz = a.pos.z - pit.z;
    const r = Math.hypot(pdx, pdz) || 0.01;
    pdx /= r;
    pdz /= r;
    pull = P.pitPull * (pit.feedT > 0 ? 0.35 : 1) * (0.4 + 0.6 * (1 - r / P.pitRadius)) * dt;
    a.pitT += dt;
    a.pitX = pit.x;
    a.pitZ = pit.z;
    if (a.pitT > 0.6) a.heading = Math.atan2(pdz, pdx) + (((a.id * 0.618) % 1) - 0.5) * 0.8;
  } else {
    if (a.pitT > 0.6) {
      a.avoidPit = { x: a.pitX, z: a.pitZ };
      a.note(w, L('note.escapedPit'));
    }
    a.pitT = 0;
  }
  const step = CONFIG.ant.speedSurface * a.speedFactor(w) * speedMul * (wetHere ? 0.35 : 1) * (pit ? 0.4 : 1) * dt;
  let nx = a.pos.x + Math.cos(a.heading) * step - pdx * pull;
  let nz = a.pos.z + Math.sin(a.heading) * step - pdz * pull;
  // 水洼是软障碍：先沿边缘绕行，被挡住几秒（目标在水里、或水洼盖住入口）就蹚水过去
  a.skirtNav.track(a.pos.x, a.pos.z, dt);
  const pd = wetHere ? null : w.water.at(nx, nz);
  if (pd && a.wadeT < 4) {
    a.wadeT += dt;
    skirt(a, pd.x, pd.z);
    nx = a.pos.x + Math.cos(a.heading) * step;
    nz = a.pos.z + Math.sin(a.heading) * step;
    if (w.water.at(nx, nz)) {
      nx = a.pos.x;
      nz = a.pos.z;
    }
  } else if (!pd && !wetHere) a.wadeT = Math.max(0, a.wadeT - dt * 0.5);
  const ap = a.avoidPit;
  if (ap && !pit) {
    const R = CONFIG.predators.pitRadius + CONFIG.defense.pitAvoidPad;
    if ((nx - ap.x) ** 2 + (nz - ap.z) ** 2 < R * R) {
      a.pitAvoidT += dt;
      // 目标就在坑里时绕不开，绕了一会儿就不再理会
      if (a.pitAvoidT > 6) a.avoidPit = null;
      else {
        skirt(a, ap.x, ap.z);
        nx = a.pos.x + Math.cos(a.heading) * step;
        nz = a.pos.z + Math.sin(a.heading) * step;
      }
    } else a.pitAvoidT = Math.max(0, a.pitAvoidT - dt);
  }
  const ob = w.veg.obstacleAt(nx, nz, 0.35, true);
  if (ob) {
    skirt(a, ob.x, ob.z);
    nx = a.pos.x + Math.cos(a.heading) * step;
    nz = a.pos.z + Math.sin(a.heading) * step;
    let ob2 = w.veg.obstacleAt(nx, nz, 0.3, true);
    // 树枝是一串小圆：沿一个圆的切线会撞进下一个圆，被推回去就卡在两圆之间的凹口，改沿两圆连线滑过去
    if (ob2 && ob2 !== ob) {
      skirt(a, (ob.x + ob2.x) / 2, (ob.z + ob2.z) / 2);
      nx = a.pos.x + Math.cos(a.heading) * step;
      nz = a.pos.z + Math.sin(a.heading) * step;
      ob2 = w.veg.obstacleAt(nx, nz, 0.3, true);
    }
    if (ob2) {
      const ang = Math.atan2(nz - ob2.z, nx - ob2.x);
      nx = ob2.x + Math.cos(ang) * (ob2.r + 0.4);
      nz = ob2.z + Math.sin(ang) * (ob2.r + 0.4);
    }
  }
  if (Math.hypot(nx, nz) > CONFIG.world.forageRadius) {
    a.heading = Math.atan2(-a.pos.z, -a.pos.x) + w.rng.range(-0.6, 0.6);
    return;
  }
  a.pos.set(nx, w.terrain.heightAt(nx, nz) + w.predators.liftAt(nx, nz), nz);
  w.pheromone.depositHome(nx, nz, CONFIG.pheromone.depositHome * dt);
  w.terrain.normalAt(nx, nz, _n);
  alignToGround(a.up, a.fwd, a.heading, _n);
  a.moving = true;
  a.gait += step * 9;
}

export function stepEnter(a: Ant, dt: number, w: World, first: boolean): boolean {
  if (a.domain === 'nest') return true;
  if (first) {
    const e = w.nest.nearestEntrance(a.pos.x, a.pos.z);
    a.entranceTarget = w.nest.entrances.indexOf(e);
    a.pathNoise = w.rng.range(-0.25, 0.25);
  }
  const ent = w.nest.entrances[a.entranceTarget];
  const dx = ent.x - a.pos.x;
  const dz = ent.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) {
    a.domain = 'nest';
    a.walk.at(ent.node);
    a.room = -1;
    a.navTarget.copy(a.pos);
    return true;
  }
  // 路径整合：直接朝向巢口，误差随距离减小
  a.pathNoise += w.rng.gauss(0, 0.6) * dt;
  a.pathNoise *= 0.995;
  const desired = Math.atan2(dz, dx) + a.pathNoise * Math.min(1, d / 30);
  surfaceMove(a, dt, w, desired, 4);
  const carryingFood = a.crop > 0 || a.carrying?.type === 'food';
  if (carryingFood && a.layTrail > 0) w.pheromone.deposit(a.pos.x, a.pos.z, a.layTrail * dt);
  return false;
}

export function stepSearch(a: Ant, dt: number, w: World, cmd: Extract<Command, { k: 'search' }>, first: boolean): boolean {
  if (a.domain === 'nest') return true;
  if (first) a.timer = cmd.time;
  a.timer -= dt;
  if (a.timer <= 0) {
    a.behavior.result = null;
    return true;
  }
  const x = a.pos.x;
  const z = a.pos.z;
  const food = w.food.nearest(x, z, CONFIG.ant.senseFoodRadius);
  const aphid = food ? null : w.aphids.nearest(x, z, CONFIG.ant.senseFoodRadius);
  let desired: number | null = null;
  if (food) {
    const d = Math.hypot(food.x - x, food.z - z);
    if (d < food.radius + 0.5) {
      a.behavior.result = food;
      return true;
    }
    desired = Math.atan2(food.z - z, food.x - x);
  } else if (aphid) {
    // 植物茎是障碍物，走到茎旁约 1.7 单位处就算到达
    if (Math.hypot(aphid.x - x, aphid.z - z) < 1.9) {
      a.behavior.result = aphid;
      return true;
    }
    desired = Math.atan2(aphid.z - z, aphid.x - x);
  } else if (a.memory && !a.memoryChecked) {
    const dx = a.memory.x - x;
    const dz = a.memory.z - z;
    if (dx * dx + dz * dz < 16) {
      a.memoryChecked = true;
      a.memory = null;
    } else desired = Math.atan2(dz, dx) + w.rng.gauss(0, 0.15);
  } else {
    desired = followTrail(a, w);
  }
  if (desired === null) {
    a.heading += w.rng.gauss(0, 1) * 1.4 * Math.sqrt(dt);
    if (a.scout && w.pheromone.sampleHome(x + Math.cos(a.heading) * 4, z + Math.sin(a.heading) * 4) > 0.3) {
      desired = leastMarked(a, w);
    }
  }
  surfaceMove(a, dt, w, desired, food || aphid ? 6 : 3.5);
  return false;
}

/** 侦察蚁偏向同伴足迹较少的方向，以探索未开发的区域 */
function leastMarked(a: Ant, w: World): number | null {
  let best = Infinity;
  let bestA: number | null = null;
  for (const off of [-0.8, 0, 0.8]) {
    const ang = a.heading + off;
    const v = w.pheromone.sampleHome(a.pos.x + Math.cos(ang) * 4, a.pos.z + Math.sin(ang) * 4);
    if (v < best) {
      best = v;
      bestA = ang;
    }
  }
  return bestA;
}

/** 三个触角感受点比较信息素浓度；出巢时偏向远离蚁穴的一侧 */
function followTrail(a: Ant, w: World): number | null {
  const sd = 2.2;
  const fidelity = a.scout ? 0.25 : 1;
  const ent = w.nest.entrances[0];
  const ax = a.pos.x - ent.x;
  const az = a.pos.z - ent.z;
  const al = Math.hypot(ax, az) || 1;
  let best = 0;
  let bestA = 0;
  for (const off of [-0.65, 0, 0.65]) {
    const ang = a.heading + off;
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    const p = w.pheromone.sample(a.pos.x + cx * sd, a.pos.z + cz * sd);
    const out = (cx * ax + cz * az) / al;
    const v = p * fidelity * Math.max(0.05, 1 + 0.9 * out);
    if (v > best) {
      best = v;
      bestA = ang;
    }
  }
  return best > 0.06 ? bestA + w.rng.gauss(0, 0.1) : null;
}

export function stepWalk(a: Ant, dt: number, w: World, cmd: Extract<Command, { k: 'walk' }>): boolean {
  if (a.domain === 'nest') return true;
  const dx = cmd.x - a.pos.x;
  const dz = cmd.z - a.pos.z;
  if (dx * dx + dz * dz < cmd.r * cmd.r) return true;
  surfaceMove(a, dt, w, Math.atan2(dz, dx) + w.rng.gauss(0, 0.2), 5);
  return false;
}

export function stepPatrol(a: Ant, dt: number, w: World, cmd: Extract<Command, { k: 'patrol' }>, first: boolean): boolean {
  if (a.domain === 'nest') return true;
  if (first) {
    a.timer = cmd.time;
    a.patrolT = 0;
  }
  a.timer -= dt;
  if (a.pauseT > 0) {
    a.pauseT -= dt;
    return a.timer <= 0;
  }
  // 在巡逻范围里走走停停：走到一个随机点，停一会儿，再换一个点
  a.patrolT -= dt;
  const dx = a.localTarget.x - a.pos.x;
  const dz = a.localTarget.z - a.pos.z;
  const arrived = dx * dx + dz * dz < 0.36;
  if (arrived || a.patrolT <= 0) {
    if (arrived) a.pauseT = w.rng.range(0.5, 3);
    const ang = w.rng.range(0, Math.PI * 2);
    // 偏向中心：离中心越远的点越少，巡逻的大多还在入口 / 闲逛点附近
    const r = cmd.radius * w.rng.next();
    a.localTarget.set(cmd.x + Math.cos(ang) * r, 0, cmd.z + Math.sin(ang) * r);
    a.patrolT = 2 + (cmd.radius * 2) / CONFIG.ant.speedSurface;
    return a.timer <= 0;
  }
  surfaceMove(a, dt, w, Math.atan2(dz, dx) + w.rng.gauss(0, 1) * 0.3, 4, 0.7);
  return a.timer <= 0;
}

/** 路径：先沿地面靠近茎，再沿茎竖直向上；climbS 是沿路径走过的距离 */
export function stepClimb(a: Ant, dt: number, w: World, cmd: Extract<Command, { k: 'climb' }>, first: boolean): boolean {
  if (a.domain === 'nest') return true;
  const ra = cmd.r + 0.05;
  if (first) {
    a.climbS = 0;
    a.climbPhase = 0;
    a.climbR0 = Math.max(ra, Math.hypot(a.pos.x - cmd.x, a.pos.z - cmd.z));
    a.climbY0 = w.terrain.heightAt(cmd.x + Math.cos(cmd.angle) * ra, cmd.z + Math.sin(cmd.angle) * ra);
    a.timer = cmd.stay;
  }
  const flat = a.climbR0 - ra;
  const total = flat + Math.max(0, cmd.top - a.climbY0);
  const sp = CONFIG.ant.speedSurface * a.speedFactor(w) * 0.6 * dt;
  if (a.climbPhase === 0) {
    a.climbS = Math.min(total, a.climbS + sp);
    if (a.climbS >= total) a.climbPhase = 1;
  } else if (a.climbPhase === 1) {
    a.timer -= dt;
    if (a.timer <= 0) a.climbPhase = 2;
  } else {
    a.climbS -= sp;
    if (a.climbS <= 0) {
      a.heading = cmd.angle;
      a.placeOnSurface(cmd.x + Math.cos(cmd.angle) * a.climbR0, cmd.z + Math.sin(cmd.angle) * a.climbR0, w);
      return true;
    }
  }
  const ca = Math.cos(cmd.angle);
  const sa = Math.sin(cmd.angle);
  const s = a.climbS;
  const dir = a.climbPhase === 2 ? -1 : 1;
  if (s < flat) {
    const rad = a.climbR0 - s;
    const px = cmd.x + ca * rad;
    const pz = cmd.z + sa * rad;
    a.pos.set(px, w.terrain.heightAt(px, pz), pz);
    w.terrain.normalAt(px, pz, _n);
    _f.set(-ca * dir, 0, -sa * dir);
  } else {
    a.pos.set(cmd.x + ca * ra, a.climbY0 + (s - flat), cmd.z + sa * ra);
    _n.set(ca, 0, sa);
    _f.set(0, dir, 0);
  }
  a.up.lerp(_n, 0.3).normalize();
  // 在茎顶掉头时前向反转，插值无法跨过 180°
  if (a.fwd.dot(_f) < -0.3) a.fwd.copy(_f);
  else a.fwd.lerp(_f, 0.3).normalize();
  if (a.climbPhase !== 1) {
    a.moving = true;
    a.gait += sp * 9;
  }
  return false;
}
