import * as THREE from 'three';
import type { WeatherSystem } from '../world/weather';

const COUNT = 2400;

/** 雨丝：在相机与注视点之间的一个盒子里循环下落，盒子大小随观察距离缩放 */
export class RainView {
  readonly lines: THREE.LineSegments;
  private drops = new Float32Array(COUNT * 3);
  private pos: Float32Array;
  private mat: THREE.LineBasicMaterial;
  private center = new THREE.Vector3();

  constructor() {
    for (let i = 0; i < this.drops.length; i++) this.drops[i] = Math.random();
    this.pos = new Float32Array(COUNT * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xc4d4e4, transparent: true, opacity: 0.4, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
  }

  sync(dt: number, camera: THREE.Camera, focus: THREE.Vector3, weather: WeatherSystem): void {
    const rain = weather.rain;
    this.lines.visible = rain > 0.02;
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
}
