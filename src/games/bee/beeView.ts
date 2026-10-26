import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from './config';
import { CASTE, type Bee } from './sim/bees';
import type { BeeWorld } from './world';

const B = CONFIG.bees;
const H = CONFIG.hive;
const RB = CONFIG.render.bees;
const MIN_PX = CONFIG.render.minPx;

/** 转成不带索引、没有 uv、带顶点颜色的几何体；color 可以按顶点位置给 */
function paint(g: THREE.BufferGeometry, color: number | ((x: number) => number)): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  const pos = n.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) c.set(typeof color === 'number' ? color : color(pos.getX(i))).toArray(col, i * 3);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return n;
}

function limb(pts: THREE.Vector3[], r: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 3, 1, true).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    out.push(g.translate(a.x, a.y, a.z));
  }
  return out;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DARK = 0x2a1d12;
const THORAX = 0x6e4e2a;
/** 中蜂的腹部：黑褐和黄褐的环纹，尾尖黑（x 是身体坐标，-0.61 到 0.07） */
const stripes = (x: number) => (x < -0.52 ? DARK : Math.floor(((x + 0.61) / 0.68) * 7) % 2 ? 0xc8952e : DARK);

/**
 * 蜂身的三级细节（T-006），身长约 1.1，头朝 +x、背朝 +y，原点在身体中心，脚尖在 y = -lift。
 * 近：头、复眼、胸、带环纹的腹、六条腿、触角；中：三个低面数的球；远：一个八面体
 */
function models(): { near: THREE.BufferGeometry; mid: THREE.BufferGeometry; far: THREE.BufferGeometry; wings: THREE.BufferGeometry } {
  const near: THREE.BufferGeometry[] = [
    paint(new THREE.SphereGeometry(0.12, 8, 6).scale(0.9, 1, 1.1).translate(0.36, 0.02, 0), DARK),
    paint(new THREE.SphereGeometry(0.16, 8, 6).translate(0.13, 0.02, 0), THORAX),
    paint(new THREE.SphereGeometry(1, 10, 6).scale(0.34, 0.16, 0.18).translate(-0.27, 0, 0), stripes),
  ];
  for (const s of [1, -1]) {
    near.push(paint(new THREE.SphereGeometry(0.055, 5, 4).scale(1, 1.3, 0.8).translate(0.37, 0.05, s * 0.09), 0x141008));
    near.push(...limb([v3(0.44, 0.06, s * 0.04), v3(0.56, 0.17, s * 0.1), v3(0.67, 0.12, s * 0.17)], 0.01).map((g) => paint(g, DARK)));
    for (let k = 0; k < 3; k++) {
      const bx = 0.2 - k * 0.1;
      const lean = (1 - k) * 0.12;
      near.push(...limb([v3(bx, -0.06, s * 0.08), v3(bx + lean, -0.07, s * 0.27), v3(bx + lean * 1.8, -B.lift, s * 0.34)], 0.013).map((g) => paint(g, DARK)));
    }
  }
  const mid = [
    paint(new THREE.IcosahedronGeometry(0.12, 0).translate(0.36, 0.02, 0), DARK),
    paint(new THREE.IcosahedronGeometry(0.16, 0).translate(0.13, 0.02, 0), THORAX),
    paint(new THREE.IcosahedronGeometry(1, 1).scale(0.34, 0.16, 0.18).translate(-0.27, 0, 0), stripes),
  ];
  const far = paint(new THREE.OctahedronGeometry(1, 0).scale(0.55, 0.16, 0.18).translate(-0.05, 0, 0), 0x7a5a2a);
  const wings: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) wings.push(new THREE.CircleGeometry(1, 8).scale(0.28, 0.075, 1).rotateX(-Math.PI / 2).rotateY(-s * 0.18).translate(-0.12, 0.17, s * 0.08));
  return { near: mergeGeometries(near)!, mid: mergeGeometries(mid)!, far, wings: mergeGeometries(wings)! };
}

/** 蜂王身子长、发红褐；雄蜂粗壮、发黑 */
const CASTE_SCALE = [v3(1, 1, 1), v3(1.15, 1.25, 1.3), v3(1.45, 1.05, 1.05)];
const CASTE_TINT = [new THREE.Color(1, 1, 1), new THREE.Color(0.72, 0.68, 0.64), new THREE.Color(1, 0.78, 0.6)];

const _m = new THREE.Matrix4();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Sphere(new THREE.Vector3(), 1);
const _fr = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _k = new THREE.Vector3();
/** 飞着的蜂翅膀扇成一片虚影，画宽一点 */
const FLAP = new THREE.Matrix4().makeScale(1.05, 1, 1.6);

/**
 * 蜂身的朝向：巢面上背朝外；绕边时背从这一面的法线转到边的外侧再转到另一面。
 * 不在巢脾上时背朝上，飞着的按速度抬头低头
 */
function orient(b: Bee, fwd: THREE.Vector3, up: THREE.Vector3): void {
  if (b.out) {
    const v = b.vel;
    const pitch = b.out === 2 ? Math.max(-0.6, Math.min(0.6, Math.atan2(v.y, Math.hypot(v.x, v.z)))) : 0;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    fwd.set(Math.cos(b.h) * cp, sp, Math.sin(b.h) * cp);
    up.set(-Math.cos(b.h) * sp, cp, -Math.sin(b.h) * sp);
    return;
  }
  const zf = b.face ? -1 : 1;
  if (b.wrap > 0) {
    const th = Math.PI * b.wrap;
    const nx = Math.cos(b.wn);
    const ny = Math.sin(b.wn);
    up.set(nx * Math.sin(th), ny * Math.sin(th), zf * Math.cos(th));
    fwd.set(nx * Math.cos(th), ny * Math.cos(th), -zf * Math.sin(th));
    return;
  }
  up.set(0, 0, zf);
  fwd.set(Math.cos(b.h), Math.sin(b.h), 0);
}

/** 巢里的蜂：每级细节一个实例网格，画面外和巢脾背后的不画；淡化时半透明、不画翅膀（P-009） */
export class BeesView {
  readonly group = new THREE.Group();
  fade = false;
  private meshes: THREE.InstancedMesh[] = [];
  private wings!: THREE.InstancedMesh;
  private bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  private wingMat = new THREE.MeshStandardMaterial({ color: 0xe8eef4, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, roughness: 0.2 });
  private geo = models();
  private cap = 0;
  private faded = false;
  private mark: THREE.LineLoop;

  constructor(private readonly w: BeeWorld) {
    this.alloc(4000);
    const ring: number[] = [];
    for (let k = 0; k < 24; k++) ring.push(Math.cos((k / 24) * Math.PI * 2) * 0.9, Math.sin((k / 24) * Math.PI * 2) * 0.9, 0);
    this.mark = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ring, 3)),
      new THREE.LineBasicMaterial({ color: 0x7ef0ff, depthTest: false, transparent: true }),
    );
    this.mark.renderOrder = 22;
    this.mark.visible = false;
    this.group.add(this.mark);
  }

  private alloc(n: number): void {
    for (const m of [...this.meshes, this.wings]) if (m) this.group.remove(m);
    this.cap = n;
    const make = (g: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
      return m;
    };
    this.meshes = [make(this.geo.near, this.bodyMat), make(this.geo.mid, this.bodyMat), make(this.geo.far, this.bodyMat)];
    this.wings = make(this.geo.wings, this.wingMat);
    this.wings.renderOrder = 6;
  }

  /** 这只蜂现在看不看得见：在画面里，没被巢脾挡住；p 是它画面上的位置 */
  private visible(b: Bee, p: THREE.Vector3, cam: THREE.Vector3): boolean {
    if (!b.out && b.wrap === 0 && cam.z * (b.face ? -1 : 1) < -H.combHalf - 1) return false;
    _s.center.copy(p);
    return _fr.intersectsSphere(_s);
  }

  update(camera: THREE.PerspectiveCamera, viewportH: number, selected: number | null): void {
    const list = this.w.bees.list;
    if (list.length > this.cap) this.alloc(Math.ceil(list.length * 1.5));
    if (this.fade !== this.faded) {
      this.faded = this.fade;
      Object.assign(this.bodyMat, { transparent: this.fade, opacity: this.fade ? RB.fade : 1, depthWrite: !this.fade, needsUpdate: true });
    }
    _fr.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const cam = camera.position;
    const pxPerCm = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const n = [0, 0, 0];
    let nw = 0;
    for (const b of list) {
      this.w.beePos(b, _p);
      if (!this.visible(b, _p, cam)) continue;
      const px = (B.length * pxPerCm) / Math.max(0.01, cam.distanceTo(_p));
      const lod = px >= RB.nearPx ? 0 : px >= RB.farPx ? 1 : 2;
      orient(b, _f, _u);
      _z.crossVectors(_f, _u);
      _m.makeBasis(_f, _u, _z).scale(CASTE_SCALE[b.caste]);
      if (b.out === 2 && px < MIN_PX) _m.scale(_k.setScalar(MIN_PX / px));
      _m.setPosition(_p);
      const mesh = this.meshes[lod];
      mesh.setMatrixAt(n[lod], _m);
      mesh.setColorAt(n[lod]++, CASTE_TINT[b.caste]);
      if (lod < 2 && !this.fade) this.wings.setMatrixAt(nw++, b.out === 2 ? _m.multiply(FLAP) : _m);
    }
    this.meshes.forEach((m, i) => {
      m.count = n[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    this.wings.count = nw;
    this.wings.instanceMatrix.needsUpdate = true;

    const sel = selected === null ? undefined : this.w.bees.get(selected);
    this.mark.visible = !!sel;
    if (sel) {
      this.w.beePos(sel, this.mark.position);
      if (sel.out) this.mark.rotation.set(-Math.PI / 2, 0, 0);
      else this.mark.rotation.set(0, sel.face ? Math.PI : 0, 0);
      this.mark.scale.setScalar(sel.caste === CASTE.worker ? 1 : 1.3);
    }
  }

  /** 屏幕上离 (sx, sy) 不到 tol 像素的蜂里最近的一只（近处的优先） */
  pick(camera: THREE.PerspectiveCamera, w: number, h: number, sx: number, sy: number, tol: number): { id: number; dist: number } | null {
    _fr.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let best: { id: number; dist: number } | null = null;
    let bestScore = Infinity;
    for (const b of this.w.bees.list) {
      this.w.beePos(b, _p);
      if (!this.visible(b, _p, camera.position)) continue;
      const dist = _p.distanceTo(camera.position);
      _p.project(camera);
      const d = Math.hypot((_p.x * 0.5 + 0.5) * w - sx, (-_p.y * 0.5 + 0.5) * h - sy);
      if (d > tol) continue;
      const score = d + dist * 0.02;
      if (score < bestScore) {
        bestScore = score;
        best = { id: b.id, dist };
      }
    }
    return best;
  }
}
