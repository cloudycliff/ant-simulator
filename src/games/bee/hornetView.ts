import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config';
import type { Hornet } from './sim/hornets';
import type { BeeWorld } from './world';

const N = CONFIG.hornets;
const MIN_PX = CONFIG.render.minPx;
const WING_HZ = CONFIG.render.anim.wingHz * 0.8;
/** 模型身长 1，画的时候乘 N.length */
const DARK = 0x1c140e;
const BROWN = 0x4a2e1a;
const ORANGE = 0xe08a1c;
const YELLOW = 0xe8c03a;

function coloured(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  const col = new Float32Array(n.getAttribute('position').count * 3);
  const k = new THREE.Color(c);
  for (let i = 0; i < col.length; i += 3) k.toArray(col, i);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

/**
 * 黄腿胡蜂：头朝 +x、背朝 +y，身长约 1。黑褐的胸、黑的腹部上一道橙色的环（第四节）、黄的腿尖、
 * 橙黄的脸；翅膀烟褐色，单独一个网格好扇
 */
function body(): THREE.BufferGeometry {
  const parts = [
    coloured(new THREE.SphereGeometry(0.1, 8, 6).scale(0.8, 1, 1.15).translate(0.4, 0.02, 0), ORANGE),
    coloured(new THREE.SphereGeometry(0.06, 6, 4).translate(0.36, 0.06, 0), DARK),
    coloured(new THREE.SphereGeometry(0.13, 8, 6).scale(1.2, 1, 1).translate(0.18, 0.02, 0), DARK),
    coloured(new THREE.SphereGeometry(1, 10, 6).scale(0.17, 0.11, 0.12).translate(-0.12, -0.01, 0), DARK),
    coloured(new THREE.SphereGeometry(1, 10, 6).scale(0.1, 0.112, 0.122).translate(-0.24, -0.02, 0), ORANGE),
    coloured(new THREE.ConeGeometry(0.1, 0.18, 8).rotateZ(Math.PI / 2).translate(-0.4, -0.03, 0), DARK),
  ];
  for (const s of [1, -1])
    for (let k = 0; k < 3; k++) {
      const x = 0.24 - k * 0.07;
      const leg = new THREE.CylinderGeometry(0.012, 0.012, 0.26, 3).rotateX((s * Math.PI) / 3).translate(x + (1 - k) * 0.05, -0.12, s * 0.12);
      parts.push(coloured(leg, k === 2 ? YELLOW : BROWN));
    }
  return mergeGeometries(parts)!;
}

const _m = new THREE.Matrix4();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** 胡蜂的画面：每只一组网格（最多几只，不用实例），飞着扇翅膀，远了放大到至少 MIN_PX 像素；死的侧躺在地上 */
export class HornetView {
  readonly group = new THREE.Group();
  private bodyGeo = body();
  private wingGeo = new THREE.CircleGeometry(1, 10).scale(0.3, 0.08, 1).rotateX(-Math.PI / 2).translate(-0.24, 0, 0);
  private bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 });
  private wingMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, roughness: 0.3 });
  private pool: { root: THREE.Group; wings: THREE.Mesh[] }[] = [];
  private mark: THREE.LineLoop;

  constructor(private readonly w: BeeWorld) {
    const ring: number[] = [];
    for (let k = 0; k < 24; k++) ring.push(Math.cos((k / 24) * Math.PI * 2) * 2.4, Math.sin((k / 24) * Math.PI * 2) * 2.4, 0);
    this.mark = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ring, 3)),
      new THREE.LineBasicMaterial({ color: 0x7ef0ff, depthTest: false, transparent: true }),
    );
    this.mark.renderOrder = 22;
    this.mark.visible = false;
    this.group.add(this.mark);
  }

  private slot(i: number): { root: THREE.Group; wings: THREE.Mesh[] } {
    while (this.pool.length <= i) {
      const root = new THREE.Group();
      const b = new THREE.Mesh(this.bodyGeo, this.bodyMat);
      b.castShadow = true;
      root.add(b);
      const wings = [1, -1].map((s) => {
        const pivot = new THREE.Mesh(this.wingGeo, this.wingMat);
        pivot.position.set(0.16, 0.13, s * 0.05);
        pivot.userData.side = s;
        pivot.renderOrder = 6;
        root.add(pivot);
        return pivot;
      });
      this.group.add(root);
      this.pool.push({ root, wings });
    }
    return this.pool[i];
  }

  update(camera: THREE.PerspectiveCamera, viewportH: number, selected: number | null, time: number): void {
    const list = this.w.hornets.list;
    const pxPerCm = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    let n = 0;
    for (const h of list) {
      if (h.state === 'away') continue;
      const s = this.slot(n++);
      s.root.visible = true;
      this.w.hornetPos(h.id, _p);
      this.orient(h, s.root);
      const px = (N.length * pxPerCm) / Math.max(0.01, camera.position.distanceTo(_p));
      const k = N.length * (h.state !== 'dead' && px < MIN_PX ? MIN_PX / px : 1);
      s.root.scale.setScalar(k);
      s.root.position.copy(_p);
      const flying = h.state !== 'dead' && h.state !== 'ball';
      for (const wg of s.wings) {
        const side = wg.userData.side as number;
        const open = flying ? 1 : 0.15;
        const beat = flying ? 0.25 + 0.8 * Math.sin(time * WING_HZ * Math.PI * 2 + h.id) : 0;
        wg.rotation.set(-side * beat, side * open * 0.9, 0, 'YXZ');
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].root.visible = false;
    const sel = selected === null ? undefined : this.w.hornets.get(selected);
    this.mark.visible = !!sel && sel.state !== 'away';
    if (sel && this.mark.visible) {
      this.w.hornetPos(sel.id, this.mark.position);
      this.mark.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  /** 飞着的按速度抬头低头、背朝上；死的侧躺 */
  private orient(h: Hornet, o: THREE.Object3D): void {
    const v = h.vel;
    const pitch = h.state === 'dead' ? 0 : Math.max(-0.5, Math.min(0.5, Math.atan2(v.y, Math.hypot(v.x, v.z) + 20)));
    _f.set(Math.cos(h.h) * Math.cos(pitch), Math.sin(pitch), Math.sin(h.h) * Math.cos(pitch));
    _u.set(0, 1, 0);
    if (h.state === 'dead') _u.set(Math.sin(h.h), 0, -Math.cos(h.h));
    _z.crossVectors(_f, _u).normalize();
    _u.crossVectors(_z, _f);
    _m.makeBasis(_f, _u, _z);
    _m.decompose(_s, _q, _s);
    o.quaternion.copy(_q);
  }

  /** 屏幕上离 (sx, sy) 不到 tol 像素的胡蜂里最近的一只 */
  pick(camera: THREE.PerspectiveCamera, w: number, h: number, sx: number, sy: number, tol: number): { id: number; dist: number } | null {
    let best: { id: number; dist: number } | null = null;
    let bestD = tol;
    for (const x of this.w.hornets.list) {
      if (x.state === 'away' || !this.w.hornetPos(x.id, _p)) continue;
      const dist = _p.distanceTo(camera.position);
      _p.project(camera);
      if (_p.z > 1) continue;
      const d = Math.hypot((_p.x * 0.5 + 0.5) * w - sx, (-_p.y * 0.5 + 0.5) * h - sy);
      if (d < bestD) {
        bestD = d;
        best = { id: x.id, dist };
      }
    }
    return best;
  }
}
