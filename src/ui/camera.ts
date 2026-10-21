import * as THREE from 'three';
import { clamp } from '../util/math';

type GroundFn = (x: number, z: number) => number;

/**
 * 自由飞行相机：左键拖拽转视角，右键拖拽平移，滚轮推进，WASD/QE 移动。
 * 跟随模式下围绕目标环绕，滚轮调整距离。
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
  onClick: ((x: number, y: number) => void) | null = null;
  onDoubleClick: ((x: number, y: number) => void) | null = null;
  onUserMove: (() => void) | null = null;

  constructor(
    public camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    private ground: GroundFn,
  ) {
    camera.rotation.order = 'YXZ';
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerup', (e) => {
      if (this.drag && this.drag.moved < 5 && this.drag.button === 0) this.onClick?.(e.clientX, e.clientY);
      this.drag = null;
    });
    dom.addEventListener('dblclick', (e) => this.onDoubleClick?.(e.clientX, e.clientY));
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
    return Math.abs(p.y - this.ground(p.x, p.z));
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
    p.x = clamp(p.x, -300, 300);
    p.z = clamp(p.z, -300, 300);
    p.y = clamp(p.y, -140, 320);
  }
}
