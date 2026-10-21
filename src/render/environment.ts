import * as THREE from 'three';
import type { SimClock } from '../sim/clock';
import { TAU, clamp } from '../util/math';

const DAY_TOP = new THREE.Color(0x5d9be0);
const DAY_BOTTOM = new THREE.Color(0xc9dff0);
const DUSK_TOP = new THREE.Color(0x3a4a7a);
const DUSK_BOTTOM = new THREE.Color(0xf0a060);
const NIGHT_TOP = new THREE.Color(0x060a18);
const NIGHT_BOTTOM = new THREE.Color(0x141c30);

export class Environment {
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** 透视地下时跟随相机的观察灯，保证夜间也能看清蚁穴 */
  lamp: THREE.PointLight;
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private fog: THREE.Fog;
  private tmpTop = new THREE.Color();
  private tmpBottom = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8aa4ff, 0.0);
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0xbcd8ff, 0x4a3a28, 0.9);
    scene.add(this.hemi);

    this.lamp = new THREE.PointLight(0xffe2b8, 0, 160, 0.6);
    scene.add(this.lamp);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunVis: { value: 1 },
        ground: { value: new THREE.Color(0x2a1f16) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform float sunVis; uniform vec3 ground; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottom, top, smoothstep(0.5, 0.95, h));
          float s = max(0.0, dot(d, sunDir));
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25) * sunVis * step(0.0, d.y);
          // 地平线以下是大地（透视地下时透过地表看到的远景）
          c = mix(c, ground, smoothstep(0.0, -0.08, d.y));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    const starGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(850);
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false }),
    );
    scene.add(this.stars);

    this.fog = new THREE.Fog(0xc9dff0, 140, 420);
    scene.fog = this.fog;
  }

  update(clock: SimClock, camera: THREE.Camera, focus: THREE.Vector3, xray: boolean): void {
    const hour = clock.hour;
    const ang = ((hour - 6) / 24) * TAU;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.85, Math.sin(ang), 0.35).normalize();
    const elev = dir.y;
    const day = clamp((elev + 0.08) / 0.35, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) / 0.3, 0, 1);

    this.tmpTop.copy(NIGHT_TOP).lerp(DAY_TOP, day).lerp(DUSK_TOP, dusk * 0.5);
    this.tmpBottom.copy(NIGHT_BOTTOM).lerp(DAY_BOTTOM, day).lerp(DUSK_BOTTOM, dusk * 0.6);
    this.skyMat.uniforms.top.value.copy(this.tmpTop);
    this.skyMat.uniforms.bottom.value.copy(this.tmpBottom);
    this.skyMat.uniforms.sunDir.value.copy(dir);
    this.skyMat.uniforms.sunVis.value = clamp(elev * 4 + 0.3, 0, 1);
    this.skyMat.uniforms.ground.value.setHex(0x1c140e).lerp(new THREE.Color(0x3a2c1f), day);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(1 - day * 1.6, 0, 1);

    this.sun.intensity = 2.8 * clamp(elev * 3, 0, 1);
    this.sun.color.setHSL(0.09, 0.6 * dusk + 0.2, 0.75 + 0.2 * (1 - dusk));
    this.sun.position.copy(focus).addScaledVector(dir, 200);
    this.sun.target.position.copy(focus);
    this.sun.castShadow = elev > 0.02;

    const moonDir = dir.clone().negate();
    moonDir.y = Math.abs(moonDir.y) + 0.3;
    this.moon.position.copy(focus).addScaledVector(moonDir.normalize(), 200);
    this.moon.target.position.copy(focus);
    this.moon.intensity = 1.3 * (1 - day);

    this.hemi.intensity = 0.55 + 0.45 * day;
    this.hemi.color.copy(this.tmpTop).lerp(new THREE.Color(0xffffff), 0.4 + 0.25 * (1 - day));
    this.fog.color.copy(this.tmpBottom);

    this.lamp.position.copy(camera.position);
    this.lamp.intensity = xray ? 12 * (0.4 + 0.6 * (1 - day)) : 0;
  }
}
