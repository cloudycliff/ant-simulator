import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Environment } from '../../core/render/environment';
import { RainView } from '../../core/render/rain';
import { clamp } from '../../core/util/math';
import { Rng } from '../../core/util/random';
import { BeesView } from './beeView';
import { CombView } from './combView';
import { CONFIG } from './config';
import { DanceView } from './danceView';
import { HeatView } from './heatView';
import { FlowerView } from './flowerView';
import { COMB_H } from './sim/comb';
import type { BeeRef, BeeWorld } from './world';

const H = CONFIG.hive;
const R = CONFIG.render;
const WOOD = 0x9a6a3a;
const HIVE_REF: BeeRef = { kind: 'hive', id: 0 };
/** 蜂箱的中心，相机离它近时阴影围着它 */
const HIVE_CENTER = new THREE.Vector3(0, H.baseY + COMB_H / 2, 0);
const _dir = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _focus = new THREE.Vector3();
/** 观察箱（含架子和顶棚）的范围：相机贴近它时按离它多远定快慢；贴着玻璃看时不画雨 */
export const HIVE_BOX = new THREE.Box3(new THREE.Vector3(-30, 0, -13), new THREE.Vector3(30, H.baseY + COMB_H + 20, 13));

/** 花园和观察箱的画面 */
export class BeeView {
  readonly group = new THREE.Group();
  readonly env: Environment;
  readonly comb: CombView;
  readonly flowers: FlowerView;
  readonly bees: BeesView;
  readonly dance: DanceView;
  readonly heat: HeatView;
  private rain = new RainView();
  /** 点选用：观察箱的各个部件，userData.ref 指向它们；花丛的圆柱在 flowers.pickables */
  private hiveParts: THREE.Object3D[] = [];
  glass = true;
  private glassMeshes: THREE.Mesh[] = [];
  private fills: THREE.DirectionalLight[] = [];
  private outline: THREE.LineSegments;
  /** 每丛草的位置 (x, z)；种了花就把花丛里的草藏起来 */
  private grass!: THREE.InstancedMesh;
  private grassAt!: Float32Array;
  private grassFor = -1;

  constructor(
    private readonly w: BeeWorld,
    scene: THREE.Scene,
  ) {
    this.env = new Environment(scene, R.light, { sky: R.sky, fog: R.fog, shadow: R.shadowNear, sunDistance: 400 });
    for (const s of [1, -1]) {
      const fill = new THREE.DirectionalLight(0xfff4e0, R.fill);
      fill.position.set(0.4 * s, H.baseY + 60, 100 * s);
      fill.target.position.set(0, H.baseY + 20, 0);
      this.fills.push(fill);
      scene.add(fill, fill.target);
    }
    this.buildGarden();
    this.buildHive();
    this.comb = new CombView(w.comb);
    this.flowers = new FlowerView(w);
    this.bees = new BeesView(w);
    this.dance = new DanceView(w);
    this.heat = new HeatView(w);
    this.group.add(this.comb.group, this.flowers.group, this.bees.group, this.dance.group, this.heat.group);
    const box = new THREE.BoxGeometry(62, COMB_H + 30, 30);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x7ef0ff, transparent: true, opacity: 0.8, depthTest: false }));
    this.outline.position.set(0, H.baseY + COMB_H / 2 + 6, 0);
    this.outline.renderOrder = 20;
    this.outline.visible = false;
    this.group.add(this.outline);
    scene.add(this.group, this.rain.lines, this.rain.splashes);
  }

  /** 点选用：观察箱的部件和花丛的圆柱 */
  get pickables(): THREE.Object3D[] {
    return [...this.hiveParts, ...this.flowers.pickables];
  }

  syncViews(): void {
    for (const g of this.glassMeshes) g.visible = this.glass;
  }

  private buildGarden(): void {
    const w = this.w;
    const r = new Rng(w.seed + 1);
    const size = CONFIG.garden.size;
    const g = new THREE.PlaneGeometry(size, size, 160, 160).rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, w.groundAt(x, z));
      const n = Math.sin(x * 0.004) * Math.cos(z * 0.0037) * 0.5 + r.range(-0.08, 0.08);
      c.setHSL(0.25 + n * 0.03, 0.5, 0.16 + n * 0.04).toArray(col, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    ground.receiveShadow = true;
    // 花园外面接一圈平地一直铺到雾里，不然从高处看得见地面的边和天空球下半的深色
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size / 2 - 100, CONFIG.garden.horizon, 64, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.25, 0.5, 0.16), roughness: 0.95 }),
    );
    ring.position.y = -CONFIG.garden.bump - 2;
    this.group.add(ground, ring);

    // 一丛草是几片向外斜的细叶，越往外越稀
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) {
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute([-0.3, 0, 0, 0.3, 0, 0, 0.5, 1, 0], 3));
      b.computeVertexNormals();
      blades.push(b.rotateZ(0.25).rotateY((k / 5) * Math.PI * 2 + 0.3).translate(Math.cos(k * 1.3) * 0.8, 0, Math.sin(k * 1.3) * 0.8));
    }
    const grass = new THREE.InstancedMesh(mergeGeometries(blades)!, new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.9 }), 30000);
    this.grass = grass;
    this.grassAt = new Float32Array(grass.count * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < grass.count; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = CONFIG.garden.flatR + Math.pow(r.next(), 0.8) * (size / 2 - 200);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // 花丛里不长草，不然盖住贴地的三叶草
      if (w.flowers.patches.some((p) => Math.hypot(p.x - x, p.z - z) < p.r)) {
        i--;
        continue;
      }
      m.compose(new THREE.Vector3(x, w.groundAt(x, z), z), q.setFromAxisAngle(up, r.range(0, 3)), new THREE.Vector3(1, r.range(5, 16), 1));
      grass.setMatrixAt(i, m);
      this.grassAt[i * 2] = x;
      this.grassAt[i * 2 + 1] = z;
      grass.setColorAt(i, c.setHSL(0.24 + r.range(-0.04, 0.03), 0.5, r.range(0.28, 0.42)));
    }
    this.group.add(grass);
    this.grassFor = w.flowers.version;

    // 花园边上的一圈树
    const trunk = new THREE.MeshStandardMaterial({ color: 0x5a3e28 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x3a6a2a, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + r.range(-0.2, 0.2);
      const d = r.range(2300, 2900);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const h = r.range(500, 900);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(18, 28, h, 6), trunk);
      t.position.set(x, w.groundAt(x, z) + h / 2, z);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r.range(250, 380), 0), leaf);
      crown.position.set(x, w.groundAt(x, z) + h + 120, z);
      crown.castShadow = t.castShadow = true;
      this.group.add(t, crown);
    }
  }

  /** 花丛里不长草：种了花以后把新花丛里的草藏起来（只会多不会少，藏了不用再露出来） */
  private trimGrass(): void {
    this.grassFor = this.w.flowers.version;
    const P = this.w.flowers.patches;
    const at = this.grassAt;
    for (let i = 0; i < this.grass.count; i++) {
      const x = at[i * 2];
      const z = at[i * 2 + 1];
      if (P.some((p) => Math.abs(p.x - x) < p.r && Math.abs(p.z - z) < p.r && Math.hypot(p.x - x, p.z - z) < p.r)) this.grass.setMatrixAt(i, ZERO);
    }
    this.grass.instanceMatrix.needsUpdate = true;
  }

  /** 架子、顶棚、箱体、两框的框条、玻璃、巢门管 */
  private buildHive(): void {
    const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.8 });
    const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wood);
      b.position.set(x, y, z);
      b.castShadow = b.receiveShadow = true;
      b.userData.ref = HIVE_REF;
      this.hiveParts.push(b);
      this.group.add(b);
      return b;
    };
    const y0 = H.baseY;
    const t = H.combHalf * 2;
    const half = H.combW / 2;
    box(1, COMB_H + 2, t, -half - 0.5, y0 + COMB_H / 2, 0);
    box(1, COMB_H + 2, t, half + 0.5, y0 + COMB_H / 2, 0);
    box(H.combW + 2, 1, t, 0, y0 - 0.5, 0);
    box(H.combW + 2, 1, t, 0, y0 + COMB_H + 0.5, 0);
    box(H.combW, H.bar, t, 0, y0 + H.frameH + H.bar / 2, 0);
    // 箱体：左右立柱、底板、顶板，前后是玻璃
    const D = 5.2;
    box(2.5, COMB_H + 6, D, -half - 2.25, y0 + COMB_H / 2, 0);
    box(2.5, COMB_H + 6, D, half + 2.25, y0 + COMB_H / 2, 0);
    box(H.combW + 7, 2.5, D + 1, 0, y0 - 2.25, 0);
    box(H.combW + 7, 2.5, D + 1, 0, y0 + COMB_H + 2.25, 0);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false });
    for (const s of [1, -1]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(H.combW + 2, COMB_H + 3), glassMat);
      g.position.set(0, y0 + COMB_H / 2, s * (D / 2 - 0.2));
      if (s < 0) g.rotation.y = Math.PI;
      g.renderOrder = 5;
      this.glassMeshes.push(g);
      this.group.add(g);
    }
    // 顶棚和架子
    for (const s of [1, -1]) box(60, 1.2, 26, 0, y0 + COMB_H + 10, s * 6).rotation.x = s * 0.45;
    box(56, 3, 22, 0, y0 - 5, 0);
    for (const [x, z] of [[-24, -8], [24, -8], [-24, 8], [24, 8]]) box(3, y0 - 6.5, 3, x, (y0 - 6.5) / 2, z);
    for (const [x, z] of [[-27, -9], [27, -9], [-27, 9], [27, 9]]) box(2.5, COMB_H + 14, 2.5, x, y0 + COMB_H / 2 + 2, z);
    // 巢门管：从左侧立柱伸出去
    const tube = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 7.5, 12, 1, true).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    tube.position.set(-half - 6.25, y0 + 3, 0);
    this.group.add(tube);
  }

  /**
   * 阴影和太阳的焦点：相机在蜂箱附近时围着蜂箱，否则取视线落在地面的点。
   * 框架给的 focus 按蚂蚁的尺度只往前看 60 cm，这里自己算
   */
  private focusFor(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const cp = camera.position;
    if (cp.distanceTo(HIVE_CENTER) < R.hiveFocus) {
      this.env.scale.shadow = R.shadowNear;
      return _focus.copy(HIVE_CENTER);
    }
    this.env.scale.shadow = R.shadowFar;
    camera.getWorldDirection(_dir);
    const h = Math.max(50, cp.y - this.w.groundAt(cp.x, cp.z));
    const d = _dir.y < -0.05 ? Math.min(2000, h / -_dir.y) : 2000;
    _focus.copy(cp).addScaledVector(_dir, d);
    _focus.y = this.w.groundAt(_focus.x, _focus.z);
    return _focus;
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportH: number, focus: THREE.Vector3, following: boolean, sel: BeeRef | null): void {
    if (following) this.env.scale.shadow = R.shadowNear;
    const f = following ? focus : this.focusFor(camera);
    this.env.update(this.w.clock, camera, f, false, this.w.weather.cloud);
    // 雨丝在相机和焦点之间的盒子里落，贴近蜂箱时会落进箱子里
    const near = clamp((HIVE_BOX.distanceToPoint(camera.position) - 10) / 40, 0, 1);
    this.rain.sync(dt, camera, f, this.w.weather.rain * near, (x, z) => this.w.groundAt(x, z));
    const k = clamp(this.env.hemi.intensity / R.light.hemiDay, 0, 1);
    for (const f of this.fills) f.intensity = R.fill * k;
    this.outline.visible = sel?.kind === 'hive';
    this.comb.update(camera, viewportH, sel?.kind === 'cell' ? sel.id : null);
    if (this.grassFor !== this.w.flowers.version) this.trimGrass();
    this.flowers.update(this.w.clock.hour, sel?.kind === 'flower' ? sel.id : null);
    this.bees.update(camera, viewportH, sel?.kind === 'bee' ? sel.id : null);
    this.dance.update(camera);
    this.heat.update();
  }
}
