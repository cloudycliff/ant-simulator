import * as THREE from 'three';
import { clamp, wrapAngle } from '../util/math';

/** 朝 desired 转向，每秒最多转 rate 弧度 */
export function turnToward(heading: number, desired: number, rate: number, dt: number): number {
  const d = wrapAngle(desired - heading);
  return heading + clamp(d, -rate * dt, rate * dt);
}

const _f = new THREE.Vector3();

/** 身体贴合地面：up 向地面法线靠拢，fwd 是朝向 heading、贴着地面的方向 */
export function alignToGround(up: THREE.Vector3, fwd: THREE.Vector3, heading: number, normal: THREE.Vector3): void {
  up.lerp(normal, 0.2).normalize();
  _f.set(Math.cos(heading), 0, Math.sin(heading));
  _f.addScaledVector(up, -_f.dot(up)).normalize();
  fwd.copy(_f);
}

/**
 * 沿圆形障碍物的边缘绕行。绕行方向（顺/逆时针）会保持一段时间，否则在凹角处每步重新选择会来回摆动、原地打转；
 * 长时间没有离开原地时换一个方向。每步先 track 再 steer
 */
export class Skirt {
  private sign = 1;
  private t = 0;
  private blockedT = 0;
  private bx = 0;
  private bz = 0;
  /** 被困反向之后保持新方向的剩余时间：途中离开障碍再碰上也不按朝向重选，否则会被目标拉回刚才的凹角 */
  private keep = 0;
  private followT = 0;

  /** 正在贴边绕行，且连续绕行不到 maxFollow 秒 */
  following(maxFollow: number): boolean {
    return this.t > 0 && this.followT < maxFollow;
  }

  /**
   * 贴边：朝障碍一侧慢慢弯，碰到了再由 steer 改成切线，这样能沿凸边一直绕下去。
   * 目标方向被挡时用它代替朝目标转向；否则一离开障碍就转回目标，会在凹角里原地来回
   */
  hug(heading: number, rate: number, dt: number): number {
    return heading + this.sign * rate * dt;
  }

  /** 绕行期间按真实时间累计“没走出 escape 距离”的时长 */
  track(x: number, z: number, dt: number, escape = 3): void {
    this.keep -= dt;
    if (this.t > 0) {
      this.followT += dt;
      if (Math.hypot(x - this.bx, z - this.bz) > escape) {
        this.bx = x;
        this.bz = z;
        this.blockedT = 0;
      } else this.blockedT += dt;
    }
    this.t -= dt;
  }

  /** 绕开圆心在 (cx, cz) 的障碍，返回新的朝向；stuckAfter 秒没走出去就反向，并保持 keepAfterStuck 秒 */
  steer(x: number, z: number, heading: number, cx: number, cz: number, stuckAfter = 3, keepAfterStuck = 20): number {
    const radial = Math.atan2(z - cz, x - cx);
    if (this.t <= 0) {
      if (this.keep <= 0) this.sign = Math.abs(wrapAngle(radial + Math.PI / 2 - heading)) < Math.PI / 2 ? 1 : -1;
      this.bx = x;
      this.bz = z;
      this.blockedT = 0;
      this.followT = 0;
    }
    this.t = 1.5;
    if (this.blockedT > stuckAfter) {
      this.sign = -this.sign;
      this.blockedT = 0;
      this.keep = keepAfterStuck;
    }
    return radial + (this.sign * Math.PI) / 2;
  }
}
