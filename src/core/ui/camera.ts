import * as THREE from 'three';
import type { Space } from '../space/space';
import { clamp } from '../util/math';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 手指移动不超过这么多像素算点按；两次点按间隔和距离在这以内算双击 */
const TAP_SLOP = 10;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 40;

interface TwoFinger {
  dist: number;
  angle: number;
  mx: number;
  my: number;
}

/**
 * 自由飞行相机：左键拖拽转视角，右键拖拽平移，滚轮推进，WASD/QE 移动。
 * 跟随模式下围绕目标环绕，滚轮调整距离。
 * 触屏按地图的习惯：单指拖动沿地面平移，双指捏合推拉、旋转转向、同向上下滑调俯仰；跟随时单指拖动环绕
 */
export class CameraController {
  mode: 'free' | 'follow' = 'free';
  private yaw = 0;
  private pitch = -0.5;
  private keys = new Set<string>();
  private drag: { button: number; x: number; y: number; moved: number } | null = null;
  private followPos = new THREE.Vector3();
  private followDist = 7;
  private followTheta = 0.6;
  private followPhi = 0.9;
  private getFollow: (() => THREE.Vector3 | null) | null = null;
  private fly: { from: THREE.Vector3; to: THREE.Vector3; look: THREE.Vector3; t: number; fromQ: THREE.Quaternion; toQ: THREE.Quaternion } | null = null;
  /** touch：这次点击来自手指，点选时放宽容差 */
  onClick: ((x: number, y: number, touch: boolean) => void) | null = null;
  onDoubleClick: ((x: number, y: number, touch: boolean) => void) | null = null;
  onUserMove: (() => void) | null = null;
  private touches = new Map<number, { x: number; y: number; x0: number; y0: number }>();
  private tap: { x: number; y: number; moved: number; multi: boolean } | null = null;
  private lastTap = { t: -1e9, x: 0, y: 0 };
  private two: TwoFinger | null = null;
  private twoStart: TwoFinger | null = null;
  private twoMode: 'zoom' | 'tilt' | null = null;
  private lastPointerTouch = false;

  constructor(
    public camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private space: Space,
  ) {
    camera.rotation.order = 'YXZ';
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture(e.pointerId);
      this.lastPointerTouch = e.pointerType === 'touch';
      if (this.lastPointerTouch) return this.touchDown(e);
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
    });
    dom.addEventListener('pointermove', (e) => (e.pointerType === 'touch' ? this.touchMove(e) : this.onMove(e)));
    dom.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return this.touchUp(e, true);
      if (this.drag && this.drag.moved < 5 && this.drag.button === 0) this.onClick?.(e.clientX, e.clientY, false);
      this.drag = null;
    });
    dom.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') this.touchUp(e, false);
      else this.drag = null;
    });
    // 触屏的双击由 touchUp 自己判断，浏览器补发的 dblclick 不再处理
    dom.addEventListener('dblclick', (e) => {
      if (!this.lastPointerTouch) this.onDoubleClick?.(e.clientX, e.clientY, false);
    });
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  setPose(pos: THREE.Vector3, look: THREE.Vector3): void {
    this.camera.position.copy(pos);
    this.lookAt(look);
  }

  private lookAt(p: THREE.Vector3): void {
    const d = p.clone().sub(this.camera.position).normalize();
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.applyRotation();
  }

  private applyRotation(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private heightAboveGround(): number {
    const p = this.camera.position;
    return Math.abs(p.y - this.space.surfaceAt(p.x, p.z));
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag.x = e.clientX;
    this.drag.y = e.clientY;
    this.drag.moved += Math.abs(dx) + Math.abs(dy);
    if (this.drag.moved < 5) return;
    this.fly = null;
    if (this.mode === 'follow') {
      if (this.drag.button === 0) {
        this.followTheta -= dx * 0.006;
        this.followPhi = clamp(this.followPhi - dy * 0.006, 0.08, Math.PI - 0.08);
      }
      return;
    }
    if (this.drag.button === 0) {
      this.yaw -= dx * 0.0045;
      this.pitch = clamp(this.pitch - dy * 0.0045, -1.55, 1.55);
      this.applyRotation();
    } else {
      const s = Math.max(0.6, this.heightAboveGround()) * 0.0025;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    }
  }

  private touchDown(e: PointerEvent): void {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    if (this.touches.size === 1) {
      this.tap = { x: e.clientX, y: e.clientY, moved: 0, multi: false };
    } else {
      if (this.tap) this.tap.multi = true;
      this.startTwo();
    }
  }

  private touchMove(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    t.x = e.clientX;
    t.y = e.clientY;
    if (this.touches.size === 1) {
      if (!this.tap) return;
      this.tap.moved += Math.abs(dx) + Math.abs(dy);
      if (this.tap.moved < TAP_SLOP) return;
      this.fly = null;
      if (this.mode === 'follow') {
        this.followTheta -= dx * 0.008;
        this.followPhi = clamp(this.followPhi - dy * 0.008, 0.08, Math.PI - 0.08);
      } else {
        this.panGround(dx, dy);
      }
      return;
    }
    this.moveTwo();
  }

  private touchUp(e: PointerEvent, ended: boolean): void {
    if (!this.touches.delete(e.pointerId)) return;
    if (this.touches.size >= 2) this.startTwo();
    else this.two = this.twoStart = null;
    if (this.touches.size > 0) return;
    const tap = this.tap;
    this.tap = null;
    if (!ended || !tap || tap.multi || tap.moved >= TAP_SLOP) return;
    const now = performance.now();
    const last = this.lastTap;
    if (now - last.t < DOUBLE_TAP_MS && Math.hypot(tap.x - last.x, tap.y - last.y) < DOUBLE_TAP_PX) {
      this.lastTap = { t: -1e9, x: 0, y: 0 };
      this.onDoubleClick?.(tap.x, tap.y, true);
    } else {
      this.lastTap = { t: now, x: tap.x, y: tap.y };
      this.onClick?.(tap.x, tap.y, true);
    }
  }

  /** 前两根手指的间距、连线角度和中点 */
  private twoFinger(): TwoFinger {
    const [a, b] = [...this.touches.values()];
    return { dist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), angle: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  private startTwo(): void {
    for (const t of this.touches.values()) {
      t.x0 = t.x;
      t.y0 = t.y;
    }
    this.two = this.twoFinger();
    this.twoStart = this.two;
    this.twoMode = null;
  }

  /**
   * 双指手势先判断意图再执行：两指同向上下滑且间距几乎不变是调俯仰，
   * 否则是捏合 / 旋转 / 双指平移（三者可以同时进行，和地图一样）
   */
  private moveTwo(): void {
    let prev = this.two;
    const start = this.twoStart;
    if (!prev || !start) return;
    const cur = this.twoFinger();
    this.two = cur;
    if (!this.twoMode) {
      // 浏览器逐根手指发移动事件，判断时允许两指一前一后；两指同向竖直移动只算俯仰，不算平移
      const [a, b] = [...this.touches.values()].map((t) => t.y - t.y0);
      const ratio = cur.dist / start.dist;
      const turn = Math.abs(wrapAngle(cur.angle - start.angle));
      if (Math.min(Math.abs(a), Math.abs(b)) > 10 && Math.sign(a) === Math.sign(b) && Math.abs(ratio - 1) < 0.1 && turn < 0.2) this.twoMode = 'tilt';
      else if (Math.abs(ratio - 1) > 0.08 || turn > 0.15 || Math.abs(cur.mx - start.mx) > 14) this.twoMode = 'zoom';
      else return;
      // 判断之前的移动也算进去
      prev = start;
    }
    this.fly = null;
    const dAngle = wrapAngle(cur.angle - prev.angle);
    if (this.mode === 'follow') {
      if (this.twoMode === 'tilt') this.followPhi = clamp(this.followPhi - (cur.my - prev.my) * 0.006, 0.08, Math.PI - 0.08);
      else {
        this.followDist = clamp(this.followDist * (prev.dist / cur.dist), 1.6, 120);
        this.followTheta -= dAngle;
      }
      return;
    }
    if (this.twoMode === 'tilt') {
      this.orbitFocus(0, -(cur.my - prev.my) * 0.005);
      return;
    }
    this.panGround(cur.mx - prev.mx, cur.my - prev.my);
    this.orbitFocus(dAngle, 0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const step = clamp(this.viewDistance() * (1 - prev.dist / cur.dist), -40, 40);
    this.camera.position.addScaledVector(fwd, step);
  }

  /** 沿视线到地面的大致距离，用来把手指移动的像素换算成世界距离 */
  private viewDistance(): number {
    return clamp(this.heightAboveGround() / Math.max(0.25, Math.sin(-this.pitch)), 1.5, 120);
  }

  /** 沿地面平移，让手指下的地面大致跟着手指走 */
  private panGround(dx: number, dy: number): void {
    const k = (2 * this.viewDistance() * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.dom.clientHeight);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    p.addScaledVector(right, -dx * k).addScaledVector(fwd, (dy * k) / Math.max(0.3, Math.sin(-this.pitch)));
    const b = this.space.cameraBox;
    p.x = clamp(p.x, b.min.x, b.max.x);
    p.z = clamp(p.z, b.min.z, b.max.z);
  }

  /** 绕视线落点转向（dYaw）和俯仰（dPitch），落点保持在画面同一位置 */
  private orbitFocus(dYaw: number, dPitch: number): void {
    const d = this.viewDistance();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const focus = this.camera.position.clone().addScaledVector(fwd, d);
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -1.5, 0.2);
    this.applyRotation();
    fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camera.position.copy(focus).addScaledVector(fwd, -d);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.fly = null;
    if (this.mode === 'follow') {
      this.followDist = clamp(this.followDist * (e.deltaY > 0 ? 1.12 : 0.89), 1.6, 120);
      return;
    }
    const s = clamp(this.heightAboveGround() * 0.12, 0.5, 30) * Math.sign(e.deltaY);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.camera.position.addScaledVector(fwd, -s);
  }

  follow(getter: () => THREE.Vector3 | null): void {
    const p = getter();
    if (!p) return;
    this.getFollow = getter;
    this.mode = 'follow';
    this.fly = null;
    this.followPos.copy(p);
    const off = this.camera.position.clone().sub(p);
    this.followDist = clamp(off.length(), 3, 14);
    this.followTheta = Math.atan2(off.x, off.z);
    this.followPhi = clamp(Math.acos(clamp(off.y / (off.length() || 1), -1, 1)), 0.25, 1.3);
  }

  stopFollow(): void {
    if (this.mode !== 'follow') return;
    this.mode = 'free';
    this.getFollow = null;
    this.lookAt(this.followPos);
  }

  /** 平滑飞到能看到目标的位置 */
  flyTo(target: THREE.Vector3, dist: number): void {
    this.stopFollow();
    const dir = this.camera.position.clone().sub(target);
    dir.y = Math.max(dir.y, 0.2);
    dir.normalize();
    if (dir.y < 0.45) {
      dir.y = 0.45;
      dir.normalize();
    }
    const to = target.clone().addScaledVector(dir, dist);
    const fromQ = this.camera.quaternion.clone();
    const m = new THREE.Matrix4().lookAt(to, target, new THREE.Vector3(0, 1, 0));
    const toQ = new THREE.Quaternion().setFromRotationMatrix(m);
    this.fly = { from: this.camera.position.clone(), to, look: target.clone(), t: 0, fromQ, toQ };
  }

  update(dt: number): void {
    const k = this.keys;
    const moving = k.has('KeyW') || k.has('KeyS') || k.has('KeyA') || k.has('KeyD') || k.has('KeyQ') || k.has('KeyE');
    if (moving) {
      this.fly = null;
      if (this.mode === 'follow') {
        this.stopFollow();
        this.onUserMove?.();
      }
    }

    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.camera.position.lerpVectors(f.from, f.to, e);
      this.camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, e);
      if (f.t >= 1) {
        this.fly = null;
        this.lookAt(f.look);
      }
      return;
    }

    if (this.mode === 'follow' && this.getFollow) {
      const p = this.getFollow();
      if (!p) {
        this.stopFollow();
        return;
      }
      this.followPos.lerp(p, 1 - Math.exp(-dt * 8));
      const sp = Math.sin(this.followPhi);
      const off = new THREE.Vector3(
        Math.sin(this.followTheta) * sp,
        Math.cos(this.followPhi),
        Math.cos(this.followTheta) * sp,
      ).multiplyScalar(this.followDist);
      this.camera.position.copy(this.followPos).add(off);
      this.camera.lookAt(this.followPos);
      return;
    }

    const boost = k.has('ShiftLeft') || k.has('ShiftRight') ? 3.5 : 1;
    const speed = clamp(this.heightAboveGround() * 1.3, 4, 90) * boost * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const p = this.camera.position;
    if (k.has('KeyW')) p.addScaledVector(fwd, speed);
    if (k.has('KeyS')) p.addScaledVector(fwd, -speed);
    if (k.has('KeyA')) p.addScaledVector(right, -speed);
    if (k.has('KeyD')) p.addScaledVector(right, speed);
    if (k.has('KeyE')) p.y += speed;
    if (k.has('KeyQ')) p.y -= speed;
    p.clamp(this.space.cameraBox.min, this.space.cameraBox.max);
  }
}
