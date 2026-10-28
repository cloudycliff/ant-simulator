import * as THREE from 'three';
import { Rng } from '../../core/util/random';
import { CONFIG } from './config';
import { SITES, cellPos } from './sim/comb';
import { QUEEN_CELL, type QueenCell } from './sim/swarming';
import type { BeeRef, BeeWorld } from './world';

const H = CONFIG.hive;
const DEV = CONFIG.swarming.dev;
/** 王台粗 R cm，长成（封盖）时长 LONG cm，台基长 CUP cm；口朝下挂在巢面上 */
const R = 0.45;
const LONG = 2.4;
const CUP = 0.6;
const COLORS = { fresh: 0xd8b070, capped: 0xc49456, torn: 0x7a5634 };
const _p = { x: 0, y: 0, z: 0 };

/** 王台的外形：单位长度、往 -y 长，像花生壳，表面有一个个小坑 */
function shape(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // 根上和巢脾连着的地方粗一点，中间鼓，底下收圆
    const r = t < 0.85 ? 0.9 + 0.12 * Math.sin(Math.PI * t * 1.2) + 0.15 * (1 - t) ** 4 : Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2)) * 0.95;
    pts.push(new THREE.Vector2(Math.max(0.001, r), -t));
  }
  const g = new THREE.LatheGeometry(pts, 12);
  const pos = g.getAttribute('position');
  const rng = new Rng(17);
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - 0.07 * rng.next();
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** 巢脾上的王台（T-027）：每个一个网格（最多几个），按长到哪一步拉长、变色；点得到 */
export class QueenCellView {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Mesh[] = [];
  private geo = shape();
  private pool: THREE.Mesh[] = [];

  constructor(private readonly w: BeeWorld) {}

  private slot(i: number): THREE.Mesh {
    while (this.pool.length <= i) {
      const m = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: COLORS.fresh, roughness: 0.85 }));
      m.castShadow = false;
      this.pool.push(m);
      this.group.add(m);
    }
    return this.pool[i];
  }

  update(sel: number | null): void {
    const cells = this.w.swarming.cells;
    this.pickables.length = 0;
    cells.forEach((c, i) => {
      const m = this.slot(i);
      this.place(m, c, c.id === sel);
      m.visible = true;
      m.userData.ref = { kind: 'queenCell', id: c.id } satisfies BeeRef;
      this.pickables.push(m);
    });
    for (let i = cells.length; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  private place(m: THREE.Mesh, c: QueenCell, selected: boolean): void {
    cellPos(c.site + c.face * SITES, _p);
    const zf = c.face ? -1 : 1;
    const larva = c.stage === QUEEN_CELL.larva ? Math.min(1, (c.age - DEV.egg) / DEV.larva) : 0;
    const len = c.stage <= QUEEN_CELL.egg ? CUP : c.stage === QUEEN_CELL.larva ? CUP + (LONG - CUP) * larva : c.stage === QUEEN_CELL.capped ? LONG : LONG * 0.9;
    m.position.set(_p.x, _p.y + R * 0.3, zf * (H.combHalf + R * 0.8));
    m.scale.set(R, len, R);
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.color.setHex(c.stage === QUEEN_CELL.torn ? COLORS.torn : c.stage === QUEEN_CELL.capped ? COLORS.capped : COLORS.fresh);
    mat.emissive.setHex(selected ? 0x1e4e5c : 0x000000);
  }
}
