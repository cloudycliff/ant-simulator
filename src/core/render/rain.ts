import * as THREE from 'three';
const COUNT = 2400;
const SPLASHES = 480;
const RING_SEGS = 8;
/** 大雨时每秒溅起的水花数，与观察距离无关 */
const SPLASH_RATE = 700;
const SPLASH_LIFE = 0.32;

/** 雨丝：在相机与注视点之间的一个盒子里循环下落，盒子大小随观察距离缩放；地面上溅起扩散的小水圈 */
export class RainView {
  readonly lines: THREE.LineSegments;
  readonly splashes: THREE.LineSegments;
  private drops = new Float32Array(COUNT * 3);
  private pos: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private center = new THREE.Vector3();
  private sPos = new Float32Array(SPLASHES * RING_SEGS * 2 * 3);
  private sCol = new Float32Array(SPLASHES * RING_SEGS * 2 * 4);
  /** 每个水花：x, y, z, 已存在秒数（< 0 表示空闲）, 最大半径 */
  private sState = new Float32Array(SPLASHES * 5);
  private spawnAcc = 0;

  constructor() {
    for (let i = 0; i < this.drops.length; i++) this.drops[i] = Math.random();
    this.pos = new Float32Array(COUNT * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xc4d4e4, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;

    for (let i = 0; i < SPLASHES; i++) this.sState[i * 5 + 3] = -1;
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(this.sCol, 4));
    const sMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.splashes = new THREE.LineSegments(sGeo, sMat);
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
  }

  /** rain：雨势 0..1 */
  sync(dt: number, camera: THREE.Camera, focus: THREE.Vector3, rain: number, heightAt: (x: number, z: number) => number): void {
    this.lines.visible = rain > 0.02;
    this.syncSplashes(dt, camera, focus, rain, heightAt);
    if (!this.lines.visible) return;
    const dist = camera.position.distanceTo(focus);
    const size = THREE.MathUtils.clamp(dist * 1.2, 30, 260);
    const len = size * 0.035;
    const fall = (dt * 0.9 * 60) / size;
    this.center.copy(camera.position).lerp(focus, 0.55);
    const n = Math.round(COUNT * Math.min(1, rain * 1.2));
    const d = this.drops;
    const p = this.pos;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      d[k + 1] -= fall * (0.8 + (i % 5) * 0.1);
      if (d[k + 1] < 0) {
        d[k + 1] += 1;
        d[k] = Math.random();
        d[k + 2] = Math.random();
      }
      const x = this.center.x + (d[k] - 0.5) * size;
      const y = this.center.y + (d[k + 1] - 0.5) * size;
      const z = this.center.z + (d[k + 2] - 0.5) * size;
      const j = i * 6;
      p[j] = x;
      p[j + 1] = y;
      p[j + 2] = z;
      p[j + 3] = x - len * 0.12;
      p[j + 4] = y - len;
      p[j + 5] = z;
    }
    const geo = this.lines.geometry;
    geo.setDrawRange(0, n * 2);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.mat.opacity = 0.18 + 0.3 * rain;
  }

  private syncSplashes(dt: number, camera: THREE.Camera, focus: THREE.Vector3, rain: number, heightAt: (x: number, z: number) => number): void {
    const st = this.sState;
    let alive = false;
    const dist = camera.position.distanceTo(focus);
    const area = THREE.MathUtils.clamp(dist * 0.45, 8, 90);
    const rmax = THREE.MathUtils.clamp(dist * 0.012, 0.3, 1.6);
    this.spawnAcc += rain > 0.02 ? rain * SPLASH_RATE * dt : 0;
    for (let i = 0; i < SPLASHES; i++) {
      const k = i * 5;
      if (st[k + 3] < 0 && this.spawnAcc >= 1) {
        this.spawnAcc--;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * area;
        st[k] = focus.x + Math.cos(a) * r;
        st[k + 2] = focus.z + Math.sin(a) * r;
        st[k + 1] = heightAt(st[k], st[k + 2]) + 0.15;
        st[k + 3] = Math.random() * 0.05;
        st[k + 4] = rmax * (0.6 + Math.random() * 0.6);
      } else if (st[k + 3] >= 0) {
        st[k + 3] += dt;
        if (st[k + 3] > SPLASH_LIFE) st[k + 3] = -1;
      }
      this.writeRing(i);
      if (st[k + 3] >= 0) alive = true;
    }
    this.spawnAcc = Math.min(this.spawnAcc, SPLASHES);
    this.splashes.visible = alive;
    if (!alive) return;
    const geo = this.splashes.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  private writeRing(i: number): void {
    const st = this.sState;
    const k = i * 5;
    const age = st[k + 3];
    const v0 = i * RING_SEGS * 2;
    if (age < 0) {
      for (let v = 0; v < RING_SEGS * 2; v++) this.sCol[(v0 + v) * 4 + 3] = 0;
      return;
    }
    const u = age / SPLASH_LIFE;
    const r = st[k + 4] * (1 - (1 - u) * (1 - u));
    const alpha = 0.55 * (1 - u);
    for (let s = 0; s < RING_SEGS; s++) {
      for (let e = 0; e < 2; e++) {
        const a = ((s + e) / RING_SEGS) * Math.PI * 2;
        const v = v0 + s * 2 + e;
        this.sPos[v * 3] = st[k] + Math.cos(a) * r;
        this.sPos[v * 3 + 1] = st[k + 1];
        this.sPos[v * 3 + 2] = st[k + 2] + Math.sin(a) * r;
        this.sCol[v * 4] = 0.82;
        this.sCol[v * 4 + 1] = 0.88;
        this.sCol[v * 4 + 2] = 0.95;
        this.sCol[v * 4 + 3] = alpha;
      }
    }
  }
}
