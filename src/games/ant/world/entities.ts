import type { World } from './world';

/** 蚂蚁游戏里能选中、能出现在事件里的对象 */
export type GameRef =
  | { kind: 'ant'; id: number }
  | { kind: 'chamber'; id: number }
  | { kind: 'food'; id: number }
  | { kind: 'entrance'; id: number }
  | { kind: 'midden' }
  | { kind: 'stone' }
  | { kind: 'plant'; id: number }
  | { kind: 'placed'; id: number }
  | { kind: 'puddle'; id: number }
  | { kind: 'predator'; id: number };

/** 读档后狼蛛、蚁狮、食物源、玩家障碍物、水洼的编号会重新分配（unstable） */
export function defineEntities(w: World): void {
  const ground = (x: number, z: number, lift = 0) => ({ x, y: w.terrain.heightAt(x, z) + lift, z });
  const e = w.entities;
  e.define('ant', { pos: (r) => w.colony.antById(r.id)?.pos ?? null, viewDistance: 6, follow: true });
  e.define('chamber', { pos: (r) => w.nest.chambers[r.id]?.floor ?? null, viewDistance: 26 });
  e.define('entrance', {
    pos: (r) => {
      const n = w.nest.entrances[r.id];
      return n ? ground(n.x, n.z) : null;
    },
  });
  e.define('midden', { pos: () => ground(w.colony.midden.x, w.colony.midden.z) });
  e.define('stone', {});
  e.define('food', {
    pos: (r) => {
      const f = w.food.byId(r.id);
      return f ? { x: f.x, y: f.y, z: f.z } : null;
    },
    unstable: true,
  });
  e.define('plant', {
    pos: (r) => {
      const p = w.veg.plants[r.id];
      if (!p) return null;
      const ac = w.aphids.byPlant(r.id);
      return { x: p.x, y: ac ? ac.bandLo : p.baseY + 4, z: p.z };
    },
  });
  e.define('predator', {
    pos: (r) => {
      const p = w.predators.byId(r.id);
      return p ? ground(p.x, p.z, 1) : null;
    },
    unstable: true,
  });
  e.define('placed', {
    pos: (r) => {
      const p = w.veg.placedById(r.id);
      return p ? ground(p.x, p.z) : null;
    },
    unstable: true,
  });
  e.define('puddle', {
    pos: (r) => {
      const p = w.water.byId(r.id);
      return p ? ground(p.x, p.z) : null;
    },
    unstable: true,
  });
}
