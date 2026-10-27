import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/util/random';
import { CONFIG } from './config';
import { FLOWER_COLORS } from './palette';
import { SUGAR, bloomYaw, openness, plantScale, plantsOf, plantYaw, type FlowerPatch } from './sim/flowers';
import type { BeeRef, BeeWorld } from './world';

const F = CONFIG.flowers;

/** 一种花的模型：body 是茎叶（每株一个实例），bloom 是一朵花（每株 blooms.length 朵，各一个实例，合拢时缩） */
interface PlantModel {
  body: THREE.BufferGeometry;
  bloom: THREE.BufferGeometry;
  /** 每朵花在株里的位置（相对株的原点，跟着株转） */
  blooms: THREE.Vector3[];
  /** 整株大约多高，点选用 */
  height: number;
}

/** 转成不带索引、没有 uv、带顶点颜色的几何体，好合并 */
function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  const c = new THREE.Color(color);
  const count = n.getAttribute('position').count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) c.toArray(col, i * 3);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;
const landOf = (key: string) => F.species.find((s) => s.key === key)!.land;
const Y = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** 一片叶子：叶柄在原点，沿 +y 长 len、宽 wid，两边往 -z 折一点 */
function leaf(len: number, wid: number): THREE.BufferGeometry {
  const f = -wid * 0.15;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, wid / 2, len * 0.4, f, 0, len, 0, 0, 0, 0, 0, len, 0, -wid / 2, len * 0.4, f], 3));
  return g;
}

/** 从 a 到 b 的细茎 */
function stem(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 3): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r * 0.7, r, len, sides, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
  return g.translate(a.x, a.y, a.z);
}

/** 拱起后垂下的长叶（玉米）：从原点沿 +x 伸出，越往梢越窄 */
function archLeaf(len: number, wid: number, rise: number, seg = 5): THREE.BufferGeometry {
  const pos: number[] = [];
  const at = (t: number) => [len * t, len * (rise * t - 0.75 * t * t)];
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg;
    const t1 = (i + 1) / seg;
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    const w0 = (wid / 2) * (1 - t0 * 0.85);
    const w1 = (wid / 2) * (1 - t1 * 0.85);
    pos.push(x0, y0, -w0, x0, y0, w0, x1, y1, w1, x0, y0, -w0, x1, y1, w1, x1, y1, -w1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

/** 各种花的模型，大小照真的（cm）。模板里的随机只定这种花的样子，每株一样，靠实例的转角和缩放区分 */
function buildModel(key: string): PlantModel {
  const C = FLOWER_COLORS[key];
  const r = new Rng(key.length * 977 + key.charCodeAt(0));
  const body: THREE.BufferGeometry[] = [];
  const bloom: THREE.BufferGeometry[] = [];
  const blooms: THREE.Vector3[] = [v3(0, 0, 0)];
  let height: number;
  if (key === 'clover') {
    // 白三叶：贴地的三小叶，一根花梗顶着白色的球形花序
    height = 15;
    body.push(paint(stem(v3(0, 0, 0), v3(0.5, 12, 0), 0.15), C.leaf));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      body.push(paint(new THREE.CircleGeometry(1.1, 5).rotateX(-Math.PI / 2 + 0.3).translate(Math.cos(a) * 1.1 + 2, 4, Math.sin(a) * 1.1), C.leaf));
    }
    bloom.push(paint(new THREE.IcosahedronGeometry(1.2, 0).scale(1, 0.9, 1).translate(0.5, 12.5, 0), C.bloom));
  } else if (key === 'sunflower') {
    // 向日葵：一根粗茎、几片大叶，花盘朝东（+x）略低头
    height = 185;
    body.push(paint(new THREE.CylinderGeometry(1.1, 1.7, 170, 5, 1, true).translate(0, 85, 0), C.leaf));
    for (let k = 0; k < 6; k++) body.push(paint(leaf(24, 20).rotateX(-1.1).rotateY((k * 2.4) % (Math.PI * 2)).translate(0, 40 + k * 20, 0), C.leaf));
    const head: THREE.BufferGeometry[] = [paint(new THREE.CylinderGeometry(7.5, 7.5, 2.5, 12).rotateZ(Math.PI / 2), 0x4a2e14)];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2;
      const p = new THREE.BufferGeometry();
      const pt = (ang: number, rad: number, x: number) => [x, Math.cos(ang) * rad, Math.sin(ang) * rad];
      p.setAttribute('position', new THREE.Float32BufferAttribute([...pt(a - 0.12, 7, -0.3), ...pt(a + 0.12, 7, -0.3), ...pt(a, 15, -1.2)], 3));
      head.push(paint(p, C.bloom));
    }
    bloom.push(merge(head).rotateZ(-0.45).translate(3, 172, 0));
  } else if (key === 'pumpkin') {
    // 南瓜：大圆叶铺在地上，喇叭形的黄花清早开、上午合
    height = 40;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + r.range(-0.3, 0.3);
      const d = r.range(12, 38);
      const h = r.range(14, 30);
      body.push(paint(stem(v3(0, 2, 0), v3(Math.cos(a) * d, h, Math.sin(a) * d), 0.5), C.leaf));
      body.push(paint(new THREE.CircleGeometry(r.range(11, 16), 7).rotateX(-Math.PI / 2 + 0.35).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * d, h, Math.sin(a) * d), C.leaf));
    }
    const cup = new THREE.CylinderGeometry(6, 1, 9, 5, 1, true).translate(0, 4.5, 0);
    bloom.push(merge([paint(cup, C.bloom), paint(new THREE.ConeGeometry(1.4, 2.5, 5).rotateX(Math.PI).translate(0, 0.5, 0), 0x6e8a2c)]));
    // 花的位置按落脚点摆（蜂落在喇叭里，比花底高 5 cm）
    blooms.length = 0;
    for (const [x, y, z] of landOf(key)) blooms.push(v3(x, y - 5, z));
  } else if (key === 'lavender') {
    // 薰衣草：灰绿的一丛，十几根细梗顶着紫色的穗
    height = 60;
    for (let k = 0; k < 28; k++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(0, 12);
      body.push(paint(leaf(r.range(12, 20), 3).rotateX(-r.range(0.3, 1.1)).rotateY(a).translate(Math.cos(a) * d, 0, Math.sin(a) * d), C.leaf));
    }
    const spikes: THREE.BufferGeometry[] = [];
    // 前几根穗按落脚点摆：蜂落在穗的侧面，穗中心比梢高 3 cm、在蜂里侧 1.4 cm
    const land = landOf(key);
    for (let k = 0; k < 16; k++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(6, 22);
      let tip = v3(Math.cos(a) * d, r.range(40, 55), Math.sin(a) * d);
      if (k < land.length) {
        const [x, y, z] = land[k];
        const h = Math.hypot(x, z);
        tip = v3(x - (x / h) * 1.4, y - 3, z - (z / h) * 1.4);
      }
      body.push(paint(stem(v3(Math.cos(a) * d * 0.3, 10, Math.sin(a) * d * 0.3), tip, 0.3), 0x8aa070));
      const dir = tip.clone().sub(v3(0, 10, 0)).normalize();
      const spike = new THREE.OctahedronGeometry(1, 0).scale(1.1, 4.5, 1.1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir));
      spikes.push(paint(spike.translate(tip.x, tip.y + 3, tip.z), C.bloom));
    }
    bloom.push(merge(spikes));
  } else if (key === 'sugar') {
    // 糖水碟：木墩上一只浅瓷碟，糖水面上漂着几根草秆给蜂落脚（落脚点在碟沿里侧）
    height = 50;
    body.push(paint(new THREE.CylinderGeometry(9, 10, 44, 9).translate(0, 22, 0), 0x8a6238));
    body.push(paint(new THREE.CylinderGeometry(9.2, 9.2, 0.4, 9).translate(0, 44.2, 0), 0xb08a5a));
    body.push(paint(new THREE.CylinderGeometry(11, 8, 2.8, 16, 1, true).translate(0, 45.8, 0), 0xf2f0ea));
    body.push(paint(new THREE.CircleGeometry(8, 16).rotateX(-Math.PI / 2).translate(0, 44.5, 0), 0xf2f0ea));
    const syrup: THREE.BufferGeometry[] = [paint(new THREE.CircleGeometry(10, 16).rotateX(-Math.PI / 2).translate(0, 46.6, 0), C.bloom)];
    for (let k = 0; k < 5; k++) syrup.push(paint(new THREE.CylinderGeometry(0.25, 0.25, 12, 3).rotateZ(Math.PI / 2).rotateY(k * 0.7 + r.range(0, 0.3)).translate(r.range(-3, 3), 46.9, r.range(-3, 3)), 0xd8c070));
    bloom.push(merge(syrup));
  } else {
    // 玉米：高秆，长叶一左一右拱下来，顶上是散粉的雄穗
    height = 230;
    body.push(paint(new THREE.CylinderGeometry(1.2, 2, 210, 5, 1, true).translate(0, 105, 0), C.leaf));
    for (let k = 0; k < 9; k++) body.push(paint(archLeaf(r.range(60, 80), 7, 0.9).rotateY(k * Math.PI + r.range(-0.5, 0.5)).translate(0, 35 + k * 17, 0), C.leaf));
    body.push(paint(new THREE.CapsuleGeometry(2.2, 12, 2, 6).rotateZ(0.35).translate(3, 110, 0), 0x9ab45a));
    const tassel: THREE.BufferGeometry[] = [paint(stem(v3(0, 208, 0), v3(0, 238, 0), 0.4), C.bloom)];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      tassel.push(paint(stem(v3(0, 214, 0), v3(Math.cos(a) * 14, 228, Math.sin(a) * 14), 0.3), C.bloom));
    }
    bloom.push(merge(tassel));
  }
  return { body: merge(body), bloom: merge(bloom), blooms, height };
}

interface Placed {
  x: number;
  y: number;
  z: number;
  k: number;
  yaw: number;
  s: number;
  patch: FlowerPatch;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _o = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** 一种花在画面上的东西；sig 是上次排实例时的开合、长成和糖水剩多少，变了才重排 */
interface Kind {
  body: THREE.InstancedMesh;
  blooms: THREE.InstancedMesh;
  patches: FlowerPatch[];
  place: Placed[];
  sig: number;
}

/**
 * 每种花一组实例网格（这种花的所有花丛合在一起），外加花丛底下的一片颜色和点选用的圆柱。
 * 种了花、放了糖水、读了档（Flowers.version 变了）就整个重建
 */
export class FlowerView {
  readonly group = new THREE.Group();
  /** 点选用的圆柱（不画），userData.ref 指向花丛 */
  readonly pickables: THREE.Object3D[] = [];
  private models = F.species.map((sp) => buildModel(sp.key));
  private kinds: Kind[] = [];
  private parts: THREE.Object3D[] = [];
  private built = -1;
  private plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  private bloomMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  private proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  private mark: THREE.LineLoop;
  private marked: number | null = null;

  constructor(private readonly w: BeeWorld) {
    this.mark = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7ef0ff, depthTest: false, transparent: true }));
    this.mark.renderOrder = 20;
    this.mark.visible = false;
    this.group.add(this.mark);
    this.build();
  }

  private build(): void {
    for (const o of this.parts) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        if (o.material !== this.proxyMat) (o.material as THREE.Material).dispose();
      }
    }
    this.parts = [];
    this.pickables.length = 0;
    this.kinds = [];
    this.built = this.w.flowers.version;
    const w = this.w;
    F.species.forEach((_sp, kind) => {
      const model = this.models[kind];
      const patches = w.flowers.patches.filter((p) => p.species === kind);
      const place: Placed[] = [];
      for (const p of patches) {
        const pl = plantsOf(p);
        for (let i = 0; i < pl.length; i += 3) {
          const x = pl[i];
          const z = pl[i + 1];
          const k = pl[i + 2];
          place.push({ x, y: w.groundAt(x, z), z, k, yaw: plantYaw(k), s: plantScale(k), patch: p });
        }
        this.addPatch(p, model.height);
      }
      const body = new THREE.InstancedMesh(model.body, this.plantMat, Math.max(1, place.length));
      body.count = 0;
      body.castShadow = body.receiveShadow = true;
      const n = place.length * model.blooms.length;
      const blooms = new THREE.InstancedMesh(model.bloom, this.bloomMat, Math.max(1, n));
      blooms.count = 0;
      blooms.castShadow = true;
      for (let i = 0; i < n; i++) blooms.setColorAt(i, _c.setScalar(0.9 + 0.1 * ((i * 0.618) % 1)));
      this.group.add(body, blooms);
      this.parts.push(body, blooms);
      this.kinds.push({ body, blooms, patches, place, sig: -1 });
    });
    this.marked = -1;
  }

  /** 花丛底下那片地带着花的颜色、往外淡掉：远处看不清一株株的花时靠它认出花丛 */
  private addPatch(p: FlowerPatch, height: number): void {
    const seg = 32;
    const R = p.r * 1.15;
    const tint = new THREE.Color(FLOWER_COLORS[F.species[p.species].key].tint);
    const pos: number[] = [p.x, this.w.groundAt(p.x, p.z) + 0.6, p.z];
    const col: number[] = [tint.r, tint.g, tint.b, 0.6];
    for (const [rr, alpha] of [[R * 0.7, 0.45], [R, 0]]) {
      for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr;
        pos.push(x, this.w.groundAt(x, z) + 0.6, z);
        col.push(tint.r, tint.g, tint.b, alpha);
      }
    }
    const idx: number[] = [];
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      idx.push(0, 1 + k1, 1 + k, 1 + k, 1 + k1, 1 + seg + k1, 1 + k, 1 + seg + k1, 1 + seg + k);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    const disc = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2 }));
    disc.receiveShadow = true;
    this.group.add(disc);
    this.parts.push(disc);

    const proxy = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 1.1, p.r * 1.1, height, 16), this.proxyMat);
    proxy.position.set(p.x, this.w.groundAt(p.x, p.z) + height / 2, p.z);
    proxy.updateMatrixWorld();
    proxy.userData.ref = { kind: 'flower', id: p.id } satisfies BeeRef;
    this.pickables.push(proxy);
    this.parts.push(proxy);
  }

  /**
   * 会合拢的花按时刻开合；刚种下的花丛按长成多少从小苗长大，长成前不开花；糖水喝完了碟子里是空的。
   * 这些变了才重排实例；向日葵的花盘都朝东
   */
  update(hour: number, selected: number | null): void {
    if (this.built !== this.w.flowers.version) this.build();
    F.species.forEach((sp, kind) => {
      const K = this.kinds[kind];
      const open = sp.closes ? openness(sp, hour) : 1;
      let sig = open;
      for (const p of K.patches) sig += p.grown * 3 + (kind === SUGAR && p.nectar <= 0.01 ? 7 : 0);
      if (K.sig >= 0 && Math.abs(sig - K.sig) < 0.02) return;
      K.sig = sig;
      const model = this.models[kind];
      const sx = 0.25 + 0.75 * open;
      let i = 0;
      let nb = 0;
      for (const pl of K.place) {
        const p = pl.patch;
        const g = p.grown < 1 ? 0.15 + 0.85 * p.grown : 1;
        K.body.setMatrixAt(nb++, _m.compose(_p.set(pl.x, pl.y, pl.z), _q.setFromAxisAngle(Y, pl.yaw), _s.setScalar(pl.s * g)));
        const shown = p.grown >= 1 && !(kind === SUGAR && p.nectar <= 0.01);
        _q.setFromAxisAngle(Y, bloomYaw(sp, pl.k));
        _o.set(pl.x, pl.y, pl.z);
        for (const b of model.blooms) {
          if (!shown) {
            K.blooms.setMatrixAt(i++, ZERO);
            continue;
          }
          _p.copy(b).multiplyScalar(pl.s).applyQuaternion(_q).add(_o);
          K.blooms.setMatrixAt(i++, _m.compose(_p, _q, _s.set(sx * pl.s, pl.s * (0.9 + 0.1 * open), sx * pl.s)));
        }
      }
      K.body.count = nb;
      K.body.instanceMatrix.needsUpdate = true;
      K.body.computeBoundingSphere();
      K.blooms.count = i;
      K.blooms.instanceMatrix.needsUpdate = true;
      if (K.blooms.instanceColor) K.blooms.instanceColor.needsUpdate = true;
      K.blooms.computeBoundingSphere();
    });
    if (selected !== this.marked) this.markPatch(selected);
  }

  private markPatch(id: number | null): void {
    this.marked = id;
    const p = id === null ? undefined : this.w.flowers.get(id);
    this.mark.visible = !!p;
    if (!p) return;
    const pts: number[] = [];
    const R = p.r * 1.15 + (p.species === SUGAR ? 4 : 0);
    const y = p.species === SUGAR ? 48 : 2;
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * Math.PI * 2;
      const x = p.x + Math.cos(a) * R;
      const z = p.z + Math.sin(a) * R;
      pts.push(x, this.w.groundAt(x, z) + y, z);
    }
    this.mark.geometry.dispose();
    this.mark.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
}
