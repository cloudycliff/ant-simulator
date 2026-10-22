import * as THREE from 'three';
import { Rng } from '../../core/util/random';
import { CONFIG, SPECIES, SPECIES_LIST, type Species } from './config';
import type { AqRef, Tank } from './tank';

const T = CONFIG.tank;
const _m = new THREE.Matrix4();
const _tail = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YZX');
const _one = new THREE.Vector3(1, 1, 1);
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const FULL = new THREE.Color(0x7ee07a);
const HUNGRY = new THREE.Color(0xff5a3a);
const WHITE = new THREE.Color(1, 1, 1);
const NIGHT_BG = new THREE.Color(0x0b0d12);
const DAY_BG = new THREE.Color(0x1d2229);

/** 背鳍和臀鳍（神仙鱼的帆）：xy 平面里向后掠的三角形，以身长为单位 */
const SAILS = [
  [0.18, 0.3, -0.22, 0.3, -0.42, 0.95],
  [0.05, -0.3, -0.25, -0.3, -0.45, -0.9],
];

/** 鱼身：x 轴朝前的椭球，顶点颜色画出各种鱼的花纹 */
function fishBody(sp: Species): THREE.BufferGeometry {
  const L = SPECIES[sp].len;
  const [sy, sz] = sp === 'angel' ? [0.75, 0.18] : sp === 'cory' ? [0.42, 0.38] : [0.3, 0.2];
  const g = new THREE.SphereGeometry(0.5, 18, 12).scale(L, L * sy, L * sz).toNonIndexed();
  g.deleteAttribute('uv');
  const pos = [...g.attributes.position.array];
  const nor = [...g.attributes.normal.array];
  if (sp === 'angel') {
    for (const [ax, ay, bx, by, cx, cy] of SAILS) {
      pos.push(ax * L, ay * L, 0, bx * L, by * L, 0, cx * L, cy * L, 0, ax * L, ay * L, 0, cx * L, cy * L, 0, bx * L, by * L, 0);
      const s = Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
      nor.push(0, 0, s, 0, 0, s, 0, 0, s, 0, 0, -s, 0, 0, -s, 0, 0, -s);
    }
  }
  const col: number[] = [];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] / L;
    const y = pos[i + 1] / L;
    let c = 0xb8c4cc;
    if (sp === 'neon') c = y > 0.1 ? 0x6f7a5a : y > 0.005 && y < 0.07 ? 0x2ef0ff : y < -0.01 && x < 0.12 ? 0xe0302a : 0xc8d0d4;
    else if (sp === 'angel') c = Math.abs(y) > 0.36 ? 0xb9beb8 : Math.abs(Math.sin(x * Math.PI * 3 + 0.4)) > 0.85 ? 0x2a2a2a : 0xdcdfd8;
    else c = y > 0.1 ? 0x6c5a3a : Math.sin(x * 37) + Math.sin(y * 53) > 1.3 ? 0x4a3c28 : 0xa48e60;
    _c.setHex(c);
    col.push(_c.r, _c.g, _c.b);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** 尾鳍：在 xy 平面里的三角形，转轴在原点（接到鱼身后端） */
function fishTail(sp: Species): THREE.BufferGeometry {
  const L = SPECIES[sp].len;
  const h = sp === 'angel' ? 0.32 : 0.2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -L * 0.32, L * h, 0, -L * 0.32, -L * h, 0, 0, 0, 0, -L * 0.32, -L * h, 0, -L * 0.32, L * h, 0], 3));
  g.computeVertexNormals();
  return g;
}

const TAIL_COLOR: Record<Species, number> = { neon: 0x9aa3a8, angel: 0xcfd3cf, cory: 0x8c7650 };

interface FishMeshes {
  body: THREE.InstancedMesh;
  tail: THREE.InstancedMesh;
}

/** 鱼缸的全部画面：房间、缸体、沙、石头、水草、鱼、鱼食、气泡、灯 */
export class TankView {
  readonly group = new THREE.Group();
  readonly lamp: THREE.DirectionalLight;
  /** 点选用：水草的叶子，userData.ref 指向那丛水草 */
  readonly pickables: THREE.Object3D[] = [];
  glass = true;
  bubbles = true;
  hungerColors = false;
  private fishMeshes = {} as Record<Species, FishMeshes>;
  private rot = new Map<number, THREE.Quaternion>();
  private wag = new Map<number, number>();
  private leaves: { mesh: THREE.Mesh; lean: number; phase: number }[] = [];
  private foodMesh: THREE.InstancedMesh;
  private bubblePts: THREE.Points;
  private glassMeshes: THREE.Object3D[] = [];
  private night: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private strip: THREE.MeshBasicMaterial;
  private marker: THREE.Mesh;
  private background = new THREE.Color();

  constructor(
    private readonly tank: Tank,
    scene: THREE.Scene,
  ) {
    scene.background = this.background;
    const g = this.group;
    const std = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
    const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };

    // 房间：地板、墙、桌面、柜子
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800).rotateX(-Math.PI / 2), std(0x3a3028));
    floor.position.y = -76;
    floor.receiveShadow = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(800, 400), std(0x2b3038));
    wall.position.set(0, 100, -90);
    g.add(floor, wall);
    box(T.w + 30, 3, T.d + 24, std(0x5a4632), 0, -1.5, 0).receiveShadow = true;
    box(T.w + 20, 73, T.d + 14, std(0x23262b), 0, -39.5, 0);

    // 沙面
    const sand = new THREE.PlaneGeometry(T.w, T.d, 80, 32).rotateX(-Math.PI / 2);
    const sp = sand.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, tank.floorAt(sp.getX(i), sp.getZ(i)));
    sand.computeVertexNormals();
    const sandMesh = new THREE.Mesh(sand, std(0xd8c39a, { roughness: 1 }));
    sandMesh.receiveShadow = true;
    g.add(sandMesh);

    const vr = new Rng(tank.seed + 1);
    for (const r of tank.rocks) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(r.r, 1), std(0x7c7f84, { flatShading: true }));
      rock.scale.set(1, 0.55, vr.range(0.7, 1));
      rock.rotation.y = vr.range(0, Math.PI);
      rock.position.set(r.x, tank.floorAt(r.x, r.z) - r.r * 0.12, r.z);
      rock.castShadow = rock.receiveShadow = true;
      g.add(rock);
    }

    // 水草：每片叶子一个网格，根部在原点，每帧轻轻摆动
    for (const p of tank.plants) {
      const pg = new THREE.Group();
      pg.position.set(p.x, tank.floorAt(p.x, p.z) - 0.5, p.z);
      const mat = std(p.kind === 'vallis' ? 0x5f9e3a : 0x3f8a3a, { side: THREE.DoubleSide, roughness: 0.7 });
      for (let i = 0; i < p.leaves; i++) {
        const h = p.height * vr.range(0.7, 1);
        const w = p.kind === 'vallis' ? 1.1 : 4.2;
        const geo = new THREE.PlaneGeometry(w, h, 1, 8).translate(0, h / 2, 0);
        const lp = geo.attributes.position;
        for (let k = 0; k < lp.count; k++) {
          const v = lp.getY(k) / h;
          lp.setX(k, lp.getX(k) * (p.kind === 'vallis' ? 1 - v * 0.6 : Math.sin(Math.PI * Math.min(1, v * 1.1 + 0.05))));
        }
        geo.computeVertexNormals();
        const leaf = new THREE.Mesh(geo, mat);
        leaf.rotation.y = (i / p.leaves) * Math.PI * 2 + vr.range(-0.3, 0.3);
        leaf.position.set(vr.range(-1.5, 1.5), 0, vr.range(-1.5, 1.5));
        leaf.castShadow = true;
        leaf.userData.ref = { kind: 'plant', id: p.id } satisfies AqRef;
        this.leaves.push({ mesh: leaf, lean: p.kind === 'vallis' ? vr.range(0.02, 0.15) : vr.range(0.5, 0.9), phase: vr.range(0, 6) });
        this.pickables.push(leaf);
        pg.add(leaf);
      }
      g.add(pg);
    }

    for (const s of SPECIES_LIST) {
      const n = tank.fish.filter((f) => f.species === s).length;
      const body = new THREE.InstancedMesh(fishBody(s), std(0xffffff, { vertexColors: true, roughness: 0.45, metalness: 0.15 }), Math.max(1, n));
      const tail = new THREE.InstancedMesh(fishTail(s), std(TAIL_COLOR[s], { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), Math.max(1, n));
      body.castShadow = true;
      for (let i = 0; i < n; i++) {
        body.setColorAt(i, WHITE);
        tail.setColorAt(i, WHITE);
      }
      body.frustumCulled = tail.frustumCulled = false;
      this.fishMeshes[s] = { body, tail };
      g.add(body, tail);
    }

    this.foodMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.7), std(0xc8742e), CONFIG.food.max);
    this.foodMesh.frustumCulled = false;
    g.add(this.foodMesh);

    const bp = new Float32Array(90 * 3);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    this.bubblePts = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xe6f8ff, size: 0.9, transparent: true, opacity: 0.75, depthWrite: false }));
    this.bubblePts.frustumCulled = false;
    g.add(this.bubblePts);
    box(2.4, 1.2, 2.4, std(0x445055), T.w / 2 - 8, tank.floorAt(T.w / 2 - 8, -T.d / 2 + 6), -T.d / 2 + 6);

    // 水、水面、玻璃和边框（透明的最后画）
    const water = box(T.w, T.water, T.d, std(0x2f86a8, { transparent: true, opacity: 0.12, depthWrite: false }), 0, T.water / 2, 0);
    water.renderOrder = 1;
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(T.w, T.d).rotateX(-Math.PI / 2), std(0xa8e2f5, { transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1 }));
    surface.position.y = T.water;
    surface.renderOrder = 2;
    g.add(surface);
    const glassGeo = new THREE.BoxGeometry(T.w + 0.8, T.h, T.d + 0.8);
    const glass = new THREE.Mesh(glassGeo, std(0xcfeeff, { transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    glass.position.y = T.h / 2;
    glass.renderOrder = 3;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(glassGeo), new THREE.LineBasicMaterial({ color: 0x111111 }));
    frame.position.y = T.h / 2;
    g.add(glass, frame);
    this.glassMeshes.push(glass, frame);

    // 灯：缸顶的灯罩和灯条，房间的天光，关灯后的蓝色夜灯
    box(T.w + 2, 2, 12, std(0x1b1d20), 0, T.h + 1.6, 0);
    this.strip = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(T.w - 4, 6).rotateX(Math.PI / 2), this.strip);
    strip.position.y = T.h + 0.5;
    g.add(strip);
    this.lamp = new THREE.DirectionalLight(0xf4fbff, CONFIG.render.lamp);
    this.lamp.position.set(0, 160, 20);
    this.lamp.castShadow = true;
    const sc = this.lamp.shadow.camera;
    sc.left = sc.bottom = -75;
    sc.right = sc.top = 75;
    sc.near = 20;
    sc.far = 260;
    this.lamp.shadow.bias = -0.0005;
    this.night = new THREE.DirectionalLight(0x4466ff, 0);
    this.night.position.set(-40, 120, 60);
    this.hemi = new THREE.HemisphereLight(0xe8eef8, 0x3a3028, CONFIG.render.room);
    g.add(this.lamp, this.lamp.target, this.night, this.night.target, this.hemi);

    this.marker = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    g.add(this.marker);
    scene.add(g);
  }

  syncViews(): void {
    for (const o of this.glassMeshes) o.visible = this.glass;
    this.bubblePts.visible = this.bubbles;
  }

  update(dt: number, time: number, camera: THREE.Camera, sel: AqRef | null): void {
    const tank = this.tank;
    const light = tank.light();
    const R = CONFIG.render;
    this.lamp.intensity = R.lamp * light;
    this.lamp.castShadow = light > 0.05;
    this.night.intensity = R.night * (1 - light);
    this.hemi.intensity = R.room * (0.25 + 0.75 * tank.clock.daylight);
    this.strip.color.setScalar(0.12 + 0.88 * light);
    this.background.copy(NIGHT_BG).lerp(DAY_BG, tank.clock.daylight);

    const idx: Record<Species, number> = { neon: 0, angel: 0, cory: 0 };
    const k = 1 - Math.exp(-dt * 8);
    for (const f of tank.fish) {
      const S = SPECIES[f.species];
      const v = f.vel;
      const speed = v.length();
      const ph = (this.wag.get(f.id) ?? f.id) + dt * (4 + speed * 1.6);
      this.wag.set(f.id, ph);
      _e.set(0, Math.atan2(-v.z, v.x) + Math.sin(ph) * 0.06, Math.max(-0.5, Math.min(0.5, Math.atan2(v.y, Math.hypot(v.x, v.z)))));
      _q.setFromEuler(_e);
      let q = this.rot.get(f.id);
      if (!q) this.rot.set(f.id, (q = _q.clone()));
      else q.slerp(_q, k);
      _m.compose(f.pos, q, _s.setScalar(f.size));
      const i = idx[f.species]++;
      const fm = this.fishMeshes[f.species];
      fm.body.setMatrixAt(i, _m);
      _tail.makeRotationY(Math.sin(ph) * 0.55).setPosition(-S.len * 0.46, 0, 0);
      fm.tail.setMatrixAt(i, _m.multiply(_tail));
      if (this.hungerColors) _c.copy(FULL).lerp(HUNGRY, f.hunger);
      else _c.copy(WHITE);
      fm.body.setColorAt(i, _c);
      fm.tail.setColorAt(i, _c);
    }
    for (const s of SPECIES_LIST) {
      const fm = this.fishMeshes[s];
      for (const m of [fm.body, fm.tail]) {
        m.count = idx[s];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }

    for (const l of this.leaves) {
      l.mesh.rotation.z = l.lean + Math.sin(time * 0.9 + l.phase) * 0.1;
      l.mesh.rotation.x = Math.cos(time * 0.7 + l.phase) * 0.06;
    }

    const fm = this.foodMesh;
    tank.food.forEach((p, i) => {
      _e.set(p.state === 'sink' ? p.t * 2 + p.drift : 0, p.drift, p.state === 'sink' ? p.t * 1.3 : 0);
      fm.setMatrixAt(i, _m.compose(p.pos, _q.setFromEuler(_e), _one));
    });
    fm.count = tank.food.length;
    fm.instanceMatrix.needsUpdate = true;

    if (this.bubbles) {
      const a = this.bubblePts.geometry.attributes.position as THREE.BufferAttribute;
      const bx = T.w / 2 - 8;
      const bz = -T.d / 2 + 6;
      const y0 = tank.floorAt(bx, bz) + 1;
      const span = T.water - y0;
      for (let i = 0; i < a.count; i++) {
        const y = (time * (7 + (i % 5)) + i * 3.7) % span;
        a.setXYZ(i, bx + Math.sin(time * 3 + i) * 0.5 * (y / span + 0.2), y0 + y, bz + Math.cos(time * 2.3 + i * 1.7) * 0.5 * (y / span + 0.2));
      }
      a.needsUpdate = true;
    }

    const at = sel && sel.kind !== 'plant' ? tank.entities.pos(sel) : null;
    this.marker.visible = !!at;
    if (at) {
      const size = sel!.kind === 'fish' ? SPECIES[tank.fishById(sel!.id)!.species].len * 0.8 : 1.2;
      this.marker.position.set(at.x, at.y, at.z);
      this.marker.quaternion.copy(camera.quaternion);
      this.marker.scale.setScalar(size);
    }
  }
}
