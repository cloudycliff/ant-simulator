import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG, ROLE_COLORS } from '../config';
import type { Ant } from '../sim/ant';
import type { World } from '../world/world';

/** 部件标记：0=身体，1/2=两组三脚架步态的腿，3=触角 */
function part(geo: THREE.BufferGeometry, leg: number, hip: THREE.Vector3, shade: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const legA = new Float32Array(n).fill(leg);
  const hipA = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    hipA.set([hip.x, hip.y, hip.z], i * 3);
    col.set([shade, shade, shade], i * 3);
  }
  g.setAttribute('aLeg', new THREE.BufferAttribute(legA, 1));
  g.setAttribute('aHip', new THREE.BufferAttribute(hipA, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** 连接两点的细长段（腿节、触角节） */
function segment(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r * 0.8, r, len, 5, 1, false);
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** 体长约 1 的黑毛蚁：头、胸（中躯）、腹柄结节、柄后腹，六足与膝状触角。+X 为前方。 */
export function buildAntGeometry(queen = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const none = new THREE.Vector3();
  const gs = queen ? 1.35 : 1;
  parts.push(part(ellipsoid(0.27 * gs, 0.19 * gs, 0.2 * gs, -0.3 - (gs - 1) * 0.22, 0.17, 0, 12), 0, none, 1));
  parts.push(part(ellipsoid(0.045, 0.07, 0.05, -0.04, 0.16, 0), 0, none, 1));
  const tw = queen ? 1.3 : 1;
  parts.push(part(ellipsoid(0.17 * tw, 0.085 * tw, 0.075 * tw, 0.09, 0.17, 0), 0, none, 1));
  parts.push(part(ellipsoid(0.115, 0.095, 0.11, 0.33, 0.19, 0), 0, none, 1));
  // 复眼
  for (const s of [-1, 1]) parts.push(part(ellipsoid(0.03, 0.03, 0.02, 0.36, 0.22, s * 0.095, 6), 0, none, 0.3));
  // 上颚
  for (const s of [-1, 1])
    parts.push(part(segment(new THREE.Vector3(0.42, 0.15, s * 0.05), new THREE.Vector3(0.5, 0.14, s * 0.012), 0.022), 0, none, 1.4));
  // 膝状触角：柄节向上外伸，鞭节前折
  for (const s of [-1, 1]) {
    const base = new THREE.Vector3(0.4, 0.23, s * 0.05);
    const knee = new THREE.Vector3(0.42, 0.36, s * 0.16);
    const tip = new THREE.Vector3(0.62, 0.3, s * 0.2);
    parts.push(part(segment(base, knee, 0.014), 3, base, 1.3));
    parts.push(part(segment(knee, tip, 0.016), 3, base, 1.3));
  }
  // 六足：前足向前、后足向后，三脚架分组（左前、右中、左后 为一组）
  const legs = [
    { x: 0.16, fx: 0.42, kx: 0.3 },
    { x: 0.09, fx: 0.08, kx: 0.1 },
    { x: 0.02, fx: -0.38, kx: -0.16 },
  ];
  legs.forEach((l, i) => {
    for (const s of [-1, 1]) {
      const hip = new THREE.Vector3(l.x, 0.12, s * 0.06);
      const knee = new THREE.Vector3(l.kx, 0.24, s * 0.3);
      const foot = new THREE.Vector3(l.fx, 0.0, s * 0.42);
      const group = (i % 2 === 0) === (s < 0) ? 1 : 2;
      parts.push(part(segment(hip, knee, 0.022), group, hip, 1.35));
      parts.push(part(segment(knee, foot, 0.016), group, hip, 1.35));
    }
  });
  if (queen) {
    // 婚飞后脱落翅膀留下的翅基
    for (const s of [-1, 1]) parts.push(part(ellipsoid(0.05, 0.02, 0.04, 0.05, 0.27, s * 0.06, 6), 0, none, 1.5));
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

function gaitMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.15 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aLeg;
         attribute vec3 aHip;
         attribute float aGait;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if (aLeg > 0.5 && aLeg < 2.5) {
           float ph = aGait + (aLeg > 1.5 ? 3.14159 : 0.0);
           float swing = sin(ph) * 0.42 * sign(aHip.z);
           vec3 d = transformed - aHip;
           float c = cos(swing); float s = sin(swing);
           d = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
           transformed = aHip + d;
           transformed.y += max(0.0, cos(ph)) * 0.05 * smoothstep(0.05, 0.3, length(d.xz));
         } else if (aLeg > 2.5) {
           vec3 d = transformed - aHip;
           float sw = sin(aGait * 0.7 + aHip.z * 40.0) * 0.25;
           float c = cos(sw); float s = sin(sw);
           d = vec3(d.x * c - d.y * s, d.x * s + d.y * c, d.z);
           transformed = aHip + d;
         }`,
      );
  };
  return mat;
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _c = new THREE.Color();
const BODY = new THREE.Color(0x2b1e17);

export class AntView {
  workers: THREE.InstancedMesh;
  queens: THREE.InstancedMesh;
  private gaitW: THREE.InstancedBufferAttribute;
  private gaitQ: THREE.InstancedBufferAttribute;
  roleColors = false;
  xray = false;
  selectedId = -1;
  marker: THREE.Group;
  private markerRing: THREE.Mesh;

  constructor(private world: World) {
    const cap = CONFIG.colony.maxPopulation + 50;
    const wGeo = buildAntGeometry(false);
    this.gaitW = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.gaitW.setUsage(THREE.DynamicDrawUsage);
    wGeo.setAttribute('aGait', this.gaitW);
    this.workers = new THREE.InstancedMesh(wGeo, gaitMaterial(), cap);
    this.workers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.workers.setColorAt(0, BODY);
    this.workers.castShadow = true;
    this.workers.frustumCulled = false;

    const qGeo = buildAntGeometry(true);
    this.gaitQ = new THREE.InstancedBufferAttribute(new Float32Array(4), 1);
    qGeo.setAttribute('aGait', this.gaitQ);
    this.queens = new THREE.InstancedMesh(qGeo, gaitMaterial(), 4);
    this.queens.setColorAt(0, BODY);
    this.queens.castShadow = true;
    this.queens.frustumCulled = false;

    this.marker = new THREE.Group();
    this.markerRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.85, 0.06, 6, 32).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe066, depthTest: false, transparent: true }),
    );
    this.markerRing.renderOrder = 10;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 6, 4).translate(0, 3.6, 0),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.55, depthTest: false }),
    );
    beam.renderOrder = 10;
    this.marker.add(this.markerRing, beam);
    this.marker.visible = false;
  }

  isVisible(a: Ant): boolean {
    return this.xray || a.domain === 'surface';
  }

  update(time: number): void {
    const ants = this.world.colony.ants;
    let wi = 0;
    let qi = 0;
    let selected: Ant | null = null;
    for (const a of ants) {
      if (a.id === this.selectedId) selected = a;
      if (!this.isVisible(a)) continue;
      const isQ = a.role === 'queen';
      const s = a.size * (isQ ? CONFIG.ant.queenScale : CONFIG.ant.workerLength);
      _x.copy(a.fwd);
      _z.crossVectors(_x, a.up).normalize();
      _y.crossVectors(_z, _x).normalize();
      _m.makeBasis(_x.multiplyScalar(s), _y.multiplyScalar(s), _z.multiplyScalar(s));
      _m.setPosition(a.pos);
      if (this.roleColors) _c.setHex(ROLE_COLORS[a.role]).lerp(BODY, 0.35);
      else _c.copy(BODY);
      if (a.id === this.selectedId) _c.setHex(0xffd84a);
      if (isQ) {
        this.queens.setMatrixAt(qi, _m);
        this.queens.setColorAt(qi, _c);
        this.gaitQ.setX(qi, a.gait);
        qi++;
      } else {
        this.workers.setMatrixAt(wi, _m);
        this.workers.setColorAt(wi, _c);
        this.gaitW.setX(wi, a.gait);
        wi++;
      }
    }
    this.workers.count = wi;
    this.queens.count = qi;
    this.workers.instanceMatrix.needsUpdate = true;
    this.queens.instanceMatrix.needsUpdate = true;
    if (this.workers.instanceColor) this.workers.instanceColor.needsUpdate = true;
    if (this.queens.instanceColor) this.queens.instanceColor.needsUpdate = true;
    this.gaitW.needsUpdate = true;
    this.gaitQ.needsUpdate = true;

    if (selected && this.isVisible(selected)) {
      this.marker.visible = true;
      this.marker.position.copy(selected.pos);
      const sc = selected.role === 'queen' ? 2.2 : 1;
      this.marker.scale.setScalar(sc * (1 + Math.sin(time * 5) * 0.08));
    } else this.marker.visible = false;
  }
}
