import * as THREE from 'three';
import { ENGINE } from '../config';
import { sunDirection, type SimClock } from '../sim/clock';
import { clamp } from '../util/math';

const DAY_TOP = new THREE.Color(0x5d9be0);
const DAY_BOTTOM = new THREE.Color(0xc9dff0);
const DUSK_TOP = new THREE.Color(0x3a4a7a);
const DUSK_BOTTOM = new THREE.Color(0xf0a060);
const NIGHT_TOP = new THREE.Color(0x060a18);
const NIGHT_BOTTOM = new THREE.Color(0x141c30);
const CLOUD_TOP = new THREE.Color(0x7d8794);
const CLOUD_BOTTOM = new THREE.Color(0xa3abb3);
const WHITE = new THREE.Color(0xffffff);
const MOONLIGHT = new THREE.Color(0xa8bcf0);
const LAMP_WARM = new THREE.Color(0xffe2b8);
const LAMP_COOL = new THREE.Color(0xdde6ff);
const _origin = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** 光照强度（three.js 单位） */
export interface LightLevels {
  sun: number;
  hemiDay: number;
  hemiNight: number;
  moon: number;
  /** 夜间地表跟随相机的观察灯 */
  surfaceLamp: number;
  /** 透视地下时跟随相机的观察灯 */
  xrayLamp: number;
}

/** 户外场景的尺度，单位和游戏一致；默认值是蚂蚁游戏的（cm） */
export interface EnvironmentScale {
  /** 天空球半径，要小于相机的远裁剪面；星星在它里面一点 */
  sky: number;
  /** 晴天时雾从多远开始、到多远看不见；阴雨时按比例拉近 */
  fog: [number, number];
  /** 太阳阴影覆盖焦点周围多大（正方形的半边长） */
  shadow: number;
  /** 太阳和月亮离焦点多远；阴影相机的深度是它的两倍 */
  sunDistance: number;
}

const DEFAULT_SCALE: EnvironmentScale = { sky: 900, fog: [140, 420], shadow: 45, sunDistance: 200 };

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
  private tmpCloud = new THREE.Color();
  /** 阴影相机现在用的范围，scale.shadow 变了才重算投影 */
  private shadowExtent = 0;
  private lightBasis = new THREE.Matrix4();
  private axisX = new THREE.Vector3();
  private axisY = new THREE.Vector3();
  private axisZ = new THREE.Vector3();
  private shadowFocus = new THREE.Vector3();
  /** 游戏可以每帧改 fog 和 shadow（比如镜头从蜂箱飞到花园时放大）；sky 和 sunDistance 只在构造时用 */
  readonly scale: EnvironmentScale;

  constructor(
    scene: THREE.Scene,
    private readonly levels: LightLevels,
    scale: Partial<EnvironmentScale> = {},
  ) {
    this.scale = { ...DEFAULT_SCALE, ...scale, fog: [...(scale.fog ?? DEFAULT_SCALE.fog)] };
    const S = this.scale;
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = S.sunDistance * 2;
    this.applyShadowExtent();
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
        gain: { value: 1 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform float sunVis; uniform vec3 ground; uniform float gain; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 c = mix(bottom, top, smoothstep(0.5, 0.95, h));
          float s = max(0.0, dot(d, sunDir));
          c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 3.0 + pow(s, 12.0) * 0.25) * sunVis * step(0.0, d.y);
          // 地平线以下是大地（透视地下时透过地表看到的远景）
          c = mix(c, ground, smoothstep(0.0, -0.08, d.y));
          gl_FragColor = vec4(c * gain, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(S.sky, 32, 16), this.skyMat);
    this.sky.renderOrder = -1;
    // 天空不经过色调映射，玩家调的亮度倍数要单独乘上
    this.sky.onBeforeRender = (r) => (this.skyMat.uniforms.gain.value = r.toneMappingExposure / ENGINE.render.exposure);
    scene.add(this.sky);

    const starGeo = new THREE.BufferGeometry();
    const sp: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = Math.abs(v.y) + 0.05;
      v.normalize().multiplyScalar(S.sky * (850 / 900));
      sp.push(v.x, v.y, v.z);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(
      starGeo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, fog: false }),
    );
    scene.add(this.stars);

    this.fog = new THREE.Fog(0xc9dff0, S.fog[0], S.fog[1]);
    scene.fog = this.fog;
  }

  private applyShadowExtent(): void {
    const e = this.scale.shadow;
    if (e === this.shadowExtent) return;
    this.shadowExtent = e;
    const sc = this.sun.shadow.camera;
    sc.left = -e;
    sc.right = e;
    sc.top = e;
    sc.bottom = -e;
    sc.updateProjectionMatrix();
  }

  /**
   * 阴影相机跟着焦点走时，只按阴影贴图的整像素移动：亚像素的平移会让整张阴影图每帧重新采样，
   * 细腿、草叶的影子在镜头移动时闪烁。在阴影相机自己的朝向里对齐（和 three.js 的 lookAt 同一套轴）
   */
  private snapToShadowTexel(focus: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 {
    const texel = (2 * this.shadowExtent) / this.sun.shadow.mapSize.x;
    this.lightBasis.lookAt(dir, _origin, _up).extractBasis(this.axisX, this.axisY, this.axisZ);
    const u = Math.round(focus.dot(this.axisX) / texel) * texel;
    const v = Math.round(focus.dot(this.axisY) / texel) * texel;
    return this.shadowFocus
      .copy(this.axisX)
      .multiplyScalar(u)
      .addScaledVector(this.axisY, v)
      .addScaledVector(this.axisZ, focus.dot(this.axisZ));
  }

  /** cloud：阴雨云量 0..1，天空变灰、阳光变弱、雾气拉近 */
  update(clock: SimClock, camera: THREE.Camera, focus: THREE.Vector3, xray: boolean, cloud = 0): void {
    const hour = clock.hour;
    const s = sunDirection(hour);
    const dir = new THREE.Vector3(s.x, s.y, s.z);
    const elev = dir.y;
    const day = clamp((elev + 0.08) / 0.35, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) / 0.3, 0, 1);

    this.tmpTop.copy(NIGHT_TOP).lerp(DAY_TOP, day).lerp(DUSK_TOP, dusk * 0.5);
    this.tmpBottom.copy(NIGHT_BOTTOM).lerp(DAY_BOTTOM, day).lerp(DUSK_BOTTOM, dusk * 0.6);
    if (cloud > 0) {
      const grey = 0.25 + 0.75 * day;
      this.tmpTop.lerp(this.tmpCloud.copy(CLOUD_TOP).multiplyScalar(grey), cloud * 0.85);
      this.tmpBottom.lerp(this.tmpCloud.copy(CLOUD_BOTTOM).multiplyScalar(grey), cloud * 0.85);
    }
    this.skyMat.uniforms.top.value.copy(this.tmpTop);
    this.skyMat.uniforms.bottom.value.copy(this.tmpBottom);
    this.skyMat.uniforms.sunDir.value.copy(dir);
    this.skyMat.uniforms.sunVis.value = clamp(elev * 4 + 0.3, 0, 1) * (1 - cloud);
    this.skyMat.uniforms.ground.value.setHex(0x1c140e).lerp(new THREE.Color(0x3a2c1f), day);
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    (this.stars.material as THREE.PointsMaterial).opacity = clamp(1 - day * 1.6, 0, 1) * (1 - cloud);

    const L = this.levels;
    this.sun.intensity = L.sun * clamp(elev * 3, 0, 1) * (1 - 0.75 * cloud);
    this.sun.color.setHSL(0.09, 0.6 * dusk + 0.2, 0.75 + 0.2 * (1 - dusk));
    const S = this.scale;
    this.applyShadowExtent();
    const sf = this.snapToShadowTexel(focus, dir);
    this.sun.position.copy(sf).addScaledVector(dir, S.sunDistance);
    this.sun.target.position.copy(sf);
    this.sun.castShadow = elev > 0.02 && cloud < 0.8;

    const moonDir = dir.clone().negate();
    // 月亮一直挂得较高：刚日落时若贴着地平线，平地几乎照不到，反而比深夜更黑
    moonDir.y = Math.abs(moonDir.y) + 1.2;
    this.moon.position.copy(focus).addScaledVector(moonDir.normalize(), S.sunDistance);
    this.moon.target.position.copy(focus);
    this.moon.intensity = L.moon * (1 - day) * (1 - 0.6 * cloud);

    this.hemi.intensity = (L.hemiNight + (L.hemiDay - L.hemiNight) * day) * (1 - 0.15 * cloud);
    this.hemi.color.copy(this.tmpTop).lerp(this.tmpCloud.copy(WHITE).lerp(MOONLIGHT, 1 - day), 0.4 + 0.3 * (1 - day));
    this.fog.color.copy(this.tmpBottom);
    // 全阴时雾的起点缩到约 36%、终点缩到约 52%（蚂蚁场景里是 140 → 50、420 → 220）
    this.fog.near = S.fog[0] * (1 - (9 / 14) * cloud);
    this.fog.far = S.fog[1] * (1 - (10 / 21) * cloud);

    this.lamp.position.copy(camera.position);
    this.lamp.intensity = xray ? L.xrayLamp * (0.4 + 0.6 * (1 - day)) : L.surfaceLamp * (1 - day);
    this.lamp.color.copy(xray ? LAMP_WARM : LAMP_COOL);
  }
}
