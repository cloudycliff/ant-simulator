import * as THREE from 'three';
import { clamp } from '../../core/util/math';
import { CONFIG } from './config';
import { MAP_COLORS, MAP_KEYS, LARVA_GAP, PALETTE, glossy, larvaTurn, type MapKey } from './palette';
import { CELL, COMB_H, GRID, SITES, cellPos, siteAt, type Comb } from './sim/comb';

const H = CONFIG.hive;
const C = CONFIG.cell;
const P = C.pitch;
const RC = CONFIG.render.comb;
/** 中肋（两面房底之间的蜡）离巢脾中心面多远 */
const MIDRIB = H.combHalf - C.depth;
/** 房里的六边形（不含房壁）的外接圆半径 */
const INNER_R = (P / 2 - C.wall / 2) / Math.cos(Math.PI / 6);

const col = (c: number) => new THREE.Color(c);
/** 没清理的空房房底暗多少 */
const DIRTY = 0.62;
/** 巢房内容变得很勤（每步都有蜂在改），状态纹理和近处的实例最多隔这么久（ms）才重做一次 */
const SYNC_MS = 250;
const f = (x: number) => x.toFixed(6);
/** 内容着色时房壁是房里颜色的几成 */
const MAP_WALL = 0.5;
const ci = (k: MapKey) => `${MAP_KEYS.indexOf(k)}.0`;

/** 状态纹理 r 通道：低 4 位是内容，往上是白头蛹、巢虫的丝、巢虫在这里（T-024） */
const BALD = 16;
const SILK = 32;
const WORM = 64;

/** 巢房在内容着色里是哪一类（和着色器里的分类一样） */
function contentOf(comb: Comb, cell: number, worm: boolean): MapKey {
  const site = cell % SITES;
  if (comb.build[site] < 1) return 'building';
  if (comb.bald[cell]) return 'bald';
  if (worm || comb.silk[cell] > 0) return 'silk';
  switch (comb.content[cell]) {
    case CELL.egg:
      return 'egg';
    case CELL.larva:
      return 'larva';
    case CELL.capped:
      return comb.drone[site] ? 'droneCap' : 'capped';
    case CELL.nectar:
      return 'nectar';
    case CELL.honey:
      return 'honey';
    case CELL.cappedHoney:
      return 'cappedHoney';
    case CELL.pollen:
      return 'pollen';
    case CELL.sac:
      return 'sac';
    default:
      return comb.amount[cell] > 0 ? 'dirty' : 'empty';
  }
}

/** 着色器平板：按巢面坐标找所在的巢房，从状态纹理取内容（换算和 sim/comb.ts 的 siteAt 一样） */
const DEFINES = `
#define PITCH ${f(P)}
#define WALL ${f(C.wall)}
#define ROW_H ${f(GRID.rowH)}
#define ROWS ${f(GRID.rows)}
#define COLS ${f(GRID.cols)}
#define X0 ${f(GRID.x0)}
#define Y0 ${f(GRID.y0)}
#define FRAME_H ${f(H.frameH)}
#define BAR ${f(H.bar)}
#define FRAME_STEP ${f(GRID.frameStep)}
#define COMB_W ${f(H.combW)}
#define COMB_H ${f(COMB_H)}
#define COMB_HALF ${f(H.combHalf)}
#define BASE_Y ${f(H.baseY)}
#define LARVA_GAP ${f(LARVA_GAP)}
#define MAP_WALL ${f(MAP_WALL)}
`;

const FRAG_HEAD = `
uniform sampler2D uState;
uniform float uFace;
uniform vec3 uCam;
uniform float uNear;
uniform float uNearFace;
uniform vec3 uWax, uNewWax, uBottom, uEgg, uLarva, uCapped, uDroneCap, uNectar, uHoney, uCappedHoney;
uniform vec3 uSac, uSacHead, uPupa, uPupaEye, uSilk, uWorm, uWormHead;
uniform vec3 uPollen[${PALETTE.pollen.length}];
uniform float uMap;
uniform vec3 uMapCol[${MAP_KEYS.length}];
varying vec2 vComb;
varying vec3 vTanU;
varying vec3 vTanV;
`;

const FRAG_CELL = `
vec2 combTilt = vec2(0.0);
float combRough = 0.85;
{
  float frame = vComb.y < FRAME_H + BAR * 0.5 ? 0.0 : 1.0;
  float y = vComb.y - frame * FRAME_STEP;
  if (y < 0.0 || y > FRAME_H || vComb.x < 0.0 || vComb.x > COMB_W) discard;
  float px = vComb.x - X0;
  float py = y - Y0;
  float r0 = floor(py / ROW_H);
  vec2 best = vec2(0.0);
  vec2 rc = vec2(-1.0);
  float bestD = 1e9;
  for (int k = 0; k < 2; k++) {
    float r = r0 + float(k);
    float shift = mod(r, 2.0) > 0.5 ? PITCH * 0.5 : 0.0;
    float c = floor((px - shift) / PITCH + 0.5);
    vec2 d = vec2(px - shift - c * PITCH, py - r * ROW_H);
    float dd = dot(d, d);
    if (dd < bestD && r >= 0.0 && r < ROWS && c >= 0.0 && c < COLS) { bestD = dd; best = d; rc = vec2(r, c); }
  }
  if (rc.x < 0.0) discard;
  // 近处由实例网格画的巢房，平板按整个巢房让开（判断和 CombView.rebuildNear 一样）
  if (uFace == uNearFace) {
    vec3 wc = vec3(vComb.x - best.x - COMB_W * 0.5, BASE_Y + vComb.y - best.y, uFace > 0.5 ? -COMB_HALF : COMB_HALF);
    if (distance(wc, uCam) < uNear) discard;
  }
  vec4 st = texture2D(uState, vec2((rc.y + 0.5) / COLS, (uFace * 2.0 * ROWS + frame * ROWS + rc.x + 0.5) / (4.0 * ROWS))) * 255.0;
  float rbits = floor(st.r + 0.5);
  float content = mod(rbits, 16.0);
  float bald = mod(floor(rbits / ${BALD}.0), 2.0);
  float silk = mod(floor(rbits / ${SILK}.0), 2.0);
  float worm = floor(rbits / ${WORM}.0);
  float amount = st.g / 255.0;
  float build = st.b / 255.0;
  if (build <= 0.0) discard;
  float bits = floor(st.a + 0.5);
  float drone = bits >= 128.0 ? 1.0 : 0.0;
  bits -= drone * 128.0;
  float pk = floor(bits / 16.0);
  float prog = (bits - pk * 16.0) / 15.0;

  vec2 q = abs(best);
  float hd = max(q.x, dot(q, vec2(0.5, 0.8660254)));
  float wallW = WALL * 0.5 * (build < 1.0 ? mix(0.4, 1.0, build) : 1.0);
  float edge = PITCH * 0.5 - wallW;
  float t = clamp(hd / edge, 0.0, 1.0);
  float len = length(best);
  vec2 dir = len > 1e-5 ? best / len : vec2(0.0);

  // 房里：没东西时看到的是房底，中间深、靠壁亮；法线往里弯，像个坑
  vec3 inner = uBottom * mix(0.8, 1.2, t * t);
  vec2 tilt = -dir * t * 0.6;
  if (build < 1.0) {
    inner = uNewWax * mix(0.8, 0.95, t);
    tilt = vec2(0.0);
  } else if (content == ${CELL.empty}.0 && amount > 0.0) {
    // 还没清理：房底留着茧衣和残渣，发暗
    inner *= ${DIRTY.toFixed(2)};
  } else if (content == ${CELL.egg}.0) {
    vec2 e = best / vec2(0.028, 0.06);
    if (dot(e, e) < 1.0) { inner = uEgg; tilt = e * 0.3; }
  } else if (content == ${CELL.larva}.0) {
    // C 形：圆环缺一块，越大越粗
    float rl = edge * (0.35 + 0.6 * prog);
    float ring = rl * 0.58;
    float tube = rl * 0.42;
    float turn = mod(rc.x * 7.0 + rc.y * 3.0, 6.0) * 1.0471976 + 0.4;
    float gap = abs(mod(atan(best.y, best.x) - turn + 3.1415927, 6.2831853) - 3.1415927);
    float k = abs(len - ring) / tube;
    if (k < 1.0 && gap > LARVA_GAP) {
      inner = uLarva * (1.0 - 0.18 * k * k) * (0.95 + 0.05 * cos(atan(best.y, best.x) * 9.0));
      tilt = dir * sign(len - ring) * k * 0.8;
    }
  } else if (content == ${CELL.capped}.0 && bald > 0.5) {
    // 白头蛹：房盖被咬开，露出白色的蛹头和两只眼
    vec2 eye = vec2(abs(best.x) - edge * 0.28, best.y - edge * 0.12);
    if (len < edge * 0.62) {
      inner = uPupa * (1.05 - 0.15 * len / (edge * 0.62));
      tilt = dir * len / edge * 0.6;
      if (dot(eye, eye) < edge * edge * 0.018) inner = uPupaEye;
    } else inner *= 0.55;
  } else if (content == ${CELL.sac}.0) {
    // 中囊病死的幼虫：顺着房伸长的囊，头尖朝房口翘起、发褐
    vec2 e = best / vec2(edge * 0.4, edge * 0.82);
    if (dot(e, e) < 1.0) {
      inner = mix(uSac, uSacHead, smoothstep(0.35, 0.85, e.y));
      tilt = e * 0.5;
    }
  } else if (content == ${CELL.capped}.0) {
    // 封盖子：盖子差不多齐房口，略鼓；雄蜂房的盖更鼓，顶上有小孔
    inner = (drone > 0.5 ? uDroneCap : uCapped) * (1.08 - 0.2 * t);
    tilt = dir * t * (drone > 0.5 ? 1.1 : 0.4);
    if (drone > 0.5 && len < 0.022) inner *= 0.35;
  } else if (content == ${CELL.nectar}.0 || content == ${CELL.honey}.0) {
    vec3 liquid = content == ${CELL.nectar}.0 ? uNectar : uHoney;
    inner = mix(inner, liquid * mix(1.1, 0.85, t), 0.35 + 0.65 * amount);
    combRough = 0.15;
    tilt *= 0.3;
  } else if (content == ${CELL.cappedHoney}.0) {
    inner = uCappedHoney * (1.0 - 0.1 * t);
    tilt = dir * t * 0.25;
  } else if (content == ${CELL.pollen}.0) {
    float grain = fract(sin(dot(floor(best * 90.0), vec2(12.9898, 78.233))) * 43758.5453);
    inner = mix(inner, uPollen[int(pk)] * (0.88 + 0.2 * grain), 0.4 + 0.6 * amount);
    tilt = dir * t * 0.2;
  }
  // 巢虫的丝和虫粪（封盖的房看不见里面）；空着、没封盖的房里看得见巢虫
  bool seen = content != ${CELL.capped}.0 && content != ${CELL.cappedHoney}.0;
  if (build >= 1.0 && silk > 0.5 && seen) {
    float speck = fract(sin(dot(floor(best * 70.0), vec2(39.3468, 11.1353))) * 43758.5453);
    inner = mix(inner, uSilk, 0.5) * (speck > 0.9 ? 0.45 : 1.0);
  }
  if (build >= 1.0 && worm > 0.5 && seen) {
    vec2 g = best / vec2(edge * 0.32, edge * 0.75);
    if (dot(g, g) < 1.0) {
      inner = g.y > 0.7 ? uWormHead : uWorm * (0.92 + 0.08 * cos(g.y * 20.0));
      tilt = g * 0.5;
    }
  }
  // 内容着色：每类一种平的颜色，房壁压暗（分类和 contentOf 一样）
  if (uMap > 0.5) {
    float mi = ${ci('empty')};
    if (build < 1.0) mi = ${ci('building')};
    else if (bald > 0.5) mi = ${ci('bald')};
    else if (worm > 0.5 || silk > 0.5) mi = ${ci('silk')};
    else if (content == ${CELL.sac}.0) mi = ${ci('sac')};
    else if (content == ${CELL.empty}.0 && amount > 0.0) mi = ${ci('dirty')};
    else if (content == ${CELL.egg}.0) mi = ${ci('egg')};
    else if (content == ${CELL.larva}.0) mi = ${ci('larva')};
    else if (content == ${CELL.capped}.0) mi = drone > 0.5 ? ${ci('droneCap')} : ${ci('capped')};
    else if (content == ${CELL.nectar}.0) mi = ${ci('nectar')};
    else if (content == ${CELL.honey}.0) mi = ${ci('honey')};
    else if (content == ${CELL.cappedHoney}.0) mi = ${ci('cappedHoney')};
    else if (content == ${CELL.pollen}.0) mi = ${ci('pollen')};
    inner = uMapCol[int(mi)];
    tilt = vec2(0.0);
    combRough = 0.85;
  }

  // 房壁：顶上圆，和房里交界的地方压暗一线
  float wallMix = smoothstep(edge - 0.012, edge + 0.004, hd);
  vec3 wallCol = uMap > 0.5 ? inner * MAP_WALL : (build < 1.0 ? uNewWax : uWax) * (0.95 + 0.15 * clamp((hd - edge) / wallW, 0.0, 1.0));
  float ao = 1.0 - 0.35 * smoothstep(edge - 0.05, edge, hd) * (1.0 - wallMix);
  vec3 sharp = mix(inner * ao, wallCol, wallMix);
  tilt = mix(tilt, dir * (2.0 * clamp((hd - edge) / wallW, 0.0, 1.0) - 1.0) * 0.5, wallMix);
  // 巢房只有几个像素宽时房壁和房里混成平均色，不然满屏摩尔纹
  float fw = max(fwidth(vComb.x), fwidth(vComb.y));
  float detail = 1.0 - smoothstep(0.04, 0.18, fw / PITCH);
  diffuseColor.rgb *= mix(mix(inner, wallCol, 0.3), sharp, detail);
  combTilt = tilt * detail;
}
`;

/** 尖角朝上的六边形环：里面六面房壁（法线朝里）加顶上一圈，z 从 -1 到 0 */
function wallGeometry(): THREE.BufferGeometry {
  const ro = P / 2 / Math.cos(Math.PI / 6);
  const pos: number[] = [];
  const corner = (r: number, k: number, z: number) => [r * Math.cos(Math.PI / 2 + (k * Math.PI) / 3), r * Math.sin(Math.PI / 2 + (k * Math.PI) / 3), z];
  for (let k = 0; k < 6; k++) {
    const a0 = corner(INNER_R, k, -1);
    const a1 = corner(INNER_R, k + 1, -1);
    const b0 = corner(INNER_R, k, 0);
    const b1 = corner(INNER_R, k + 1, 0);
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    const o0 = corner(ro, k, 0);
    const o1 = corner(ro, k + 1, 0);
    pos.push(...b0, ...o0, ...b1, ...b1, ...o0, ...o1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 房里的一层（房底、液面、花粉、封盖）：底边在 z = 0、中间鼓到 z = 1 的六边形，法线平滑 */
function domeGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const RINGS = 3;
  pos.push(0, 0, 1);
  for (let i = 1; i <= RINGS; i++) {
    const s = i / RINGS;
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 2 + (k * Math.PI) / 3;
      pos.push(INNER_R * s * Math.cos(a), INNER_R * s * Math.sin(a), 1 - s * s);
    }
  }
  for (let k = 0; k < 6; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 6));
  for (let i = 1; i < RINGS; i++) {
    const a = 1 + (i - 1) * 6;
    const b = 1 + i * 6;
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      idx.push(a + k, b + k, b + k1, a + k, b + k1, a + k1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 幼虫：平躺的 C 形圆环，缺口朝 +x，外径 1 */
function larvaGeometry(): THREE.BufferGeometry {
  const arc = Math.PI * 2 - 2 * LARVA_GAP;
  const g = new THREE.TorusGeometry(0.58 / 1.0, 0.42, 6, 14, arc);
  return g.rotateZ(LARVA_GAP);
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _cell = { x: 0, y: 0, z: 0 };
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const NONE = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();

/**
 * 巢脾的画面（T-005）：两面各一块着色器平板，相机贴近时视线这一面上够大的巢房改用实例网格
 * （房壁、房里的一层、卵和幼虫），平板在那些巢房上让开
 */
export class CombView {
  readonly group = new THREE.Group();
  private data = new Uint8Array(4 * GRID.cols * GRID.rows * 4);
  private tex = new THREE.DataTexture(this.data, GRID.cols, GRID.rows * 4, THREE.RGBAFormat);
  private uniforms: Record<string, THREE.IUniform>;
  private version = -1;
  private syncedAt = -Infinity;
  private nearAt = -Infinity;
  private walls: THREE.InstancedMesh;
  private layer: THREE.InstancedMesh;
  private liquid: THREE.InstancedMesh;
  private blobs: THREE.InstancedMesh;
  private larvae: THREE.InstancedMesh;
  private nearCam = new THREE.Vector3(Infinity, 0, 0);
  private nearDist = 0;
  private nearFace = -1;
  private nearVersion = -1;
  private mark: THREE.LineLoop;

  /** worms：巢虫在哪些巢房下面（T-024） */
  constructor(
    private readonly comb: Comb,
    private readonly worms: () => Iterable<number> = () => [],
  ) {
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.uniforms = {
      uState: { value: this.tex },
      uCam: { value: new THREE.Vector3() },
      uNear: { value: 0 },
      uNearFace: { value: -1 },
      uWax: { value: col(PALETTE.wax) },
      uNewWax: { value: col(PALETTE.newWax) },
      uBottom: { value: col(PALETTE.bottom) },
      uEgg: { value: col(PALETTE.egg) },
      uLarva: { value: col(PALETTE.larva) },
      uCapped: { value: col(PALETTE.capped) },
      uDroneCap: { value: col(PALETTE.droneCap) },
      uNectar: { value: col(PALETTE.nectar) },
      uHoney: { value: col(PALETTE.honey) },
      uCappedHoney: { value: col(PALETTE.cappedHoney) },
      uSac: { value: col(PALETTE.sac) },
      uSacHead: { value: col(PALETTE.sacHead) },
      uPupa: { value: col(PALETTE.pupa) },
      uPupaEye: { value: col(PALETTE.pupaEye) },
      uSilk: { value: col(PALETTE.silk) },
      uWorm: { value: col(PALETTE.worm) },
      uWormHead: { value: col(PALETTE.wormHead) },
      uPollen: { value: PALETTE.pollen.map(col) },
      uMap: { value: 0 },
      uMapCol: { value: MAP_KEYS.map((k) => col(MAP_COLORS[k])) },
    };
    for (const face of [0, 1]) {
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
      m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.uniforms, { uFace: { value: face } });
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>\n${DEFINES}\nuniform float uFace;\nvarying vec2 vComb;\nvarying vec3 vTanU;\nvarying vec3 vTanV;`)
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            vComb = vec2(uFace > 0.5 ? COMB_W * 0.5 - position.x : position.x + COMB_W * 0.5, position.y + COMB_H * 0.5);
            vTanU = normalize(normalMatrix * vec3(uFace > 0.5 ? -1.0 : 1.0, 0.0, 0.0));
            vTanV = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', `#include <common>\n${DEFINES}\n${FRAG_HEAD}`)
          .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_CELL}`)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = combRough;')
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + combTilt.x * vTanU + combTilt.y * vTanV);');
      };
      m.customProgramCacheKey = () => `bee-comb-${face}`;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(H.combW, COMB_H), m);
      plane.position.set(0, H.baseY + COMB_H / 2, face ? -H.combHalf : H.combHalf);
      if (face) plane.rotation.y = Math.PI;
      plane.receiveShadow = true;
      this.group.add(plane);
    }
    const inst = (g: THREE.BufferGeometry, roughness: number, n = SITES) => {
      const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness }), n);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.walls = inst(wallGeometry(), 0.75);
    this.layer = inst(domeGeometry(), 0.85);
    this.liquid = inst(domeGeometry(), 0.15);
    // 卵一个、死囊两个、白头蛹三个、巢虫两个
    this.blobs = inst(new THREE.IcosahedronGeometry(1, 1), 0.6, 2 * SITES);
    this.larvae = inst(larvaGeometry(), 0.45);
    for (const m of this.nearMeshes()) m.setColorAt(0, _c.set(0xffffff));

    const ring: number[] = [];
    const r = P / 2 / Math.cos(Math.PI / 6);
    for (let k = 0; k < 6; k++) ring.push(r * Math.cos(Math.PI / 2 + (k * Math.PI) / 3), r * Math.sin(Math.PI / 2 + (k * Math.PI) / 3), 0);
    this.mark = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(ring, 3)),
      new THREE.LineBasicMaterial({ color: 0x7ef0ff, depthTest: false, transparent: true }),
    );
    this.mark.renderOrder = 21;
    this.mark.visible = false;
    this.group.add(this.mark);
  }

  /** 巢房内容着色的视图 */
  get contentMap(): boolean {
    return this.uniforms.uMap.value > 0.5;
  }

  set contentMap(on: boolean) {
    this.uniforms.uMap.value = on ? 1 : 0;
    this.nearFace = -1;
  }

  private nearMeshes(): THREE.InstancedMesh[] {
    return [this.walls, this.layer, this.liquid, this.blobs, this.larvae];
  }

  /** 射线最先碰到的巢房：和看得见的那一面求交，换算成编号；没有巢房的地方返回 null */
  pick(ray: THREE.Ray): { cell: number; dist: number } | null {
    const dz = ray.direction.z;
    if (Math.abs(dz) < 1e-6) return null;
    const face = dz < 0 ? 0 : 1;
    const dist = ((face ? -H.combHalf : H.combHalf) - ray.origin.z) / dz;
    if (dist < 0) return null;
    ray.at(dist, _p);
    const site = siteAt(_p.x + H.combW / 2, _p.y - H.baseY);
    if (site < 0 || this.comb.build[site] <= 0) return null;
    return { cell: face * SITES + site, dist };
  }

  update(camera: THREE.PerspectiveCamera, viewportH: number, selected: number | null): void {
    const now = performance.now();
    if (this.version !== this.comb.version && now - this.syncedAt >= SYNC_MS) {
      this.syncedAt = now;
      this.syncState();
    }
    this.updateNear(camera, viewportH);
    this.mark.visible = selected !== null;
    if (selected !== null) {
      cellPos(selected, _cell);
      const out = selected >= SITES ? -1 : 1;
      this.mark.position.set(_cell.x, _cell.y, _cell.z + out * 0.03);
      this.mark.quaternion.copy(out < 0 ? FLIP : NONE);
    }
  }

  private syncState(): void {
    const cb = this.comb;
    const W = CONFIG.brood.worker;
    const D = CONFIG.brood.drone;
    for (let cell = 0; cell < 2 * SITES; cell++) {
      const site = cell % SITES;
      const c = cb.content[cell];
      const T = cb.drone[site] ? D : W;
      const a = cb.age[cell];
      const prog = c === CELL.egg ? a / T.egg : c === CELL.larva ? (a - T.egg) / T.larva : 0;
      const o = cell * 4;
      this.data[o] = c | (cb.bald[cell] ? BALD : 0) | (cb.silk[cell] > 0 ? SILK : 0);
      this.data[o + 1] = Math.round(clamp(cb.amount[cell], 0, 1) * 255);
      this.data[o + 2] = Math.round(cb.build[site] * 255);
      this.data[o + 3] = (cb.drone[site] << 7) | (cb.pollen[cell] << 4) | Math.round(Math.min(1, Math.max(0, prog)) * 15);
    }
    for (const cell of this.worms()) this.data[cell * 4] |= WORM;
    this.tex.needsUpdate = true;
    this.version = cb.version;
  }

  /** 巢房宽过 nearPx 像素的距离以内，视线这一面的巢房用实例网格画 */
  private updateNear(camera: THREE.PerspectiveCamera, viewportH: number): void {
    const cp = camera.position;
    const face = cp.z >= 0 ? 0 : 1;
    const near = (P * viewportH) / (2 * Math.tan((camera.fov * Math.PI) / 360) * RC.nearPx);
    const zf = face ? -H.combHalf : H.combHalf;
    const dx = Math.max(0, Math.abs(cp.x) - H.combW / 2);
    const dy = Math.max(0, H.baseY - cp.y, cp.y - H.baseY - COMB_H);
    const off = Math.hypot(dx, dy, cp.z - zf) >= near;
    if (off) {
      if (this.nearFace !== -1) {
        this.nearFace = -1;
        this.uniforms.uNear.value = 0;
        for (const m of this.nearMeshes()) m.count = 0;
      }
      return;
    }
    const fresh = this.nearVersion === this.comb.version || performance.now() - this.nearAt < SYNC_MS;
    if (face === this.nearFace && fresh && cp.distanceTo(this.nearCam) < RC.rebuild && Math.abs(near - this.nearDist) < 1) return;
    this.nearAt = performance.now();
    this.nearFace = face;
    this.nearVersion = this.comb.version;
    this.nearCam.copy(cp);
    this.nearDist = near;
    this.uniforms.uCam.value.copy(cp);
    this.uniforms.uNear.value = near;
    this.uniforms.uNearFace.value = face;
    this.rebuildNear(face, near);
  }

  private rebuildNear(face: number, near: number): void {
    const cb = this.comb;
    const q = face ? FLIP : NONE;
    const out = face ? -1 : 1;
    const W = CONFIG.brood.worker;
    const D = CONFIG.brood.drone;
    let nw = 0;
    let nl = 0;
    let nq = 0;
    let nb = 0;
    let nv = 0;
    const near2 = near * near;
    const cp = this.nearCam;
    const map = this.contentMap;
    let mapColor = 0;
    const worms = new Set(this.worms());
    // dy：沿巢面往上挪（白头蛹的眼睛、囊翘起来的头）
    const put = (mesh: THREE.InstancedMesh, i: number, z: number, sx: number, sz: number, color: number, k = 1, rot: THREE.Quaternion = q, dx = 0, dy = 0) => {
      _p.set(_cell.x + dx, _cell.y + dy, out * z);
      mesh.setMatrixAt(i, _m.compose(_p, rot, _s.set(sx, sx, sz)));
      if (map) mesh.setColorAt(i, _c.set(mapColor).multiplyScalar(mesh === this.walls ? MAP_WALL : mesh === this.blobs && color === PALETTE.bottom ? 0.4 : 1));
      else mesh.setColorAt(i, _c.set(color).multiplyScalar(k));
    };
    for (let site = 0; site < SITES; site++) {
      const b = cb.build[site];
      if (b <= 0) continue;
      const cell = face * SITES + site;
      cellPos(cell, _cell);
      if ((_cell.x - cp.x) ** 2 + (_cell.y - cp.y) ** 2 + (_cell.z - cp.z) ** 2 >= near2) continue;
      const worm = worms.has(cell);
      if (map) mapColor = MAP_COLORS[contentOf(cb, cell, worm)];
      put(this.walls, nw++, MIDRIB + C.depth * b, 1, C.depth * b, b < 1 ? PALETTE.newWax : PALETTE.wax);
      if (b < 1) {
        put(this.layer, nl++, MIDRIB, 1, 0.01, PALETTE.newWax, 0.85);
        continue;
      }
      const c = cb.content[cell];
      const amount = cb.amount[cell];
      const drone = cb.drone[site] === 1;
      if (glossy(c)) put(this.liquid, nq++, MIDRIB + amount * C.depth * 0.9, 1, 0.01, c === CELL.nectar ? PALETTE.nectar : PALETTE.honey);
      else if (c === CELL.capped && cb.bald[cell]) {
        put(this.layer, nl++, MIDRIB, 1, 0.02, PALETTE.bottom, 0.6);
        put(this.blobs, nb++, H.combHalf - 0.2, 0.14, 0.14, PALETTE.pupa);
        for (const dx of [-0.06, 0.06]) put(this.blobs, nb++, H.combHalf - 0.08, 0.025, 0.02, PALETTE.pupaEye, 1, q, dx, 0.03);
      } else if (c === CELL.sac) {
        put(this.layer, nl++, MIDRIB, 1, 0.02, PALETTE.bottom);
        put(this.blobs, nb++, MIDRIB + 0.1, 0.12, 0.08, PALETTE.sac, 1, q, 0, -0.07);
        put(this.blobs, nb++, MIDRIB + 0.14, 0.1, 0.08, PALETTE.sac, 0.9, q, 0, 0.04);
        put(this.blobs, nb++, MIDRIB + 0.22, 0.05, 0.06, PALETTE.sacHead, 1, q, 0, 0.13);
      } else if (c === CELL.capped) {
        put(this.layer, nl++, H.combHalf - 0.04, 1, drone ? 0.14 : 0.05, drone ? PALETTE.droneCap : PALETTE.capped);
        if (drone) put(this.blobs, nb++, H.combHalf + 0.1, 0.02, 0.01, PALETTE.bottom, 0.4);
      } else if (c === CELL.cappedHoney) put(this.layer, nl++, H.combHalf - 0.02, 1, 0.01, PALETTE.cappedHoney);
      else if (c === CELL.pollen) put(this.layer, nl++, MIDRIB + amount * C.depth * 0.75, 1, 0.06, PALETTE.pollen[cb.pollen[cell]]);
      else put(this.layer, nl++, MIDRIB, 1, 0.02, cb.silk[cell] > 0 ? PALETTE.silk : PALETTE.bottom, c === CELL.empty && amount > 0 ? DIRTY : 1);
      if (worm && c !== CELL.capped && c !== CELL.cappedHoney) {
        put(this.blobs, nb++, MIDRIB + 0.05, 0.08, 0.05, PALETTE.worm, 1, q, 0, -0.02);
        put(this.blobs, nb++, MIDRIB + 0.06, 0.04, 0.04, PALETTE.wormHead, 1, q, 0, 0.13);
      }
      if (c === CELL.egg) put(this.blobs, nb++, MIDRIB + 0.06, 0.028, 0.06, PALETTE.egg);
      else if (c === CELL.larva) {
        const T = drone ? D : W;
        const r = (P / 2 - C.wall / 2) * (0.35 + 0.6 * Math.min(1, (cb.age[cell] - T.egg) / T.larva));
        // 巢面坐标里缺口朝 turn；背面的局部 x 和 u 反向，角度要镜像
        const local = site % (GRID.rows * GRID.cols);
        const turn = larvaTurn(Math.floor(local / GRID.cols), local % GRID.cols);
        _q.setFromAxisAngle(Z, face ? Math.PI - turn : turn).premultiply(q);
        put(this.larvae, nv++, MIDRIB + r * 0.42, r, r, PALETTE.larva, 1, _q);
      }
    }
    for (const [m, n] of [[this.walls, nw], [this.layer, nl], [this.liquid, nq], [this.blobs, nb], [this.larvae, nv]] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
