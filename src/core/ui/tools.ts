import * as THREE from 'three';
import { L, type Text } from '../i18n';

export interface ToolResult {
  ok: boolean;
  msg?: Text;
}

export interface ToolOption {
  label: Text;
  radius: number;
  /** 线状预览的长度（比如树枝） */
  len?: number;
}

export interface ToolDef<K extends string = string> {
  kind: K;
  name: Text;
  /** 快捷键（数字键），也显示在按钮上 */
  key: string;
  hint: Text;
  options: ToolOption[];
}

/** 写成方法签名：外壳只认 ToolController<string>，方法参数才允许这样放宽 */
export interface ToolRunner<K extends string> {
  /** 执行一次工具；dry 为真时只检查能否放（预览圈变红或变绿） */
  run(def: ToolDef<K>, option: number, p: THREE.Vector3, yaw: number, dry: boolean): ToolResult;
}

/** 玩家工具：当前选择、地面预览、执行。工具做什么由游戏的 run 决定 */
export class ToolController<K extends string = string> {
  active = -1;
  option: number[];
  yaw = 0;
  /** 触屏上点地面先选好的位置，确认后才放下（手指没有悬停，看不到预览） */
  pending: THREE.Vector3 | null = null;
  readonly preview = new THREE.Group();
  private ring: THREE.Mesh;
  private stick: THREE.Mesh;
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x8be07a, transparent: true, opacity: 0.85, depthTest: false });
  private ground: THREE.Vector3 | null = null;

  constructor(
    readonly defs: ToolDef<K>[],
    private readonly runner: ToolRunner<K>,
  ) {
    this.option = defs.map(() => 0);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.stick = new THREE.Mesh(new THREE.BoxGeometry(1, 0.15, 0.5), this.ringMat);
    this.ring.renderOrder = 10;
    this.stick.renderOrder = 10;
    this.preview.add(this.ring, this.stick);
    this.preview.visible = false;
  }

  get def(): ToolDef<K> | null {
    return this.active >= 0 ? this.defs[this.active] : null;
  }

  get current(): ToolOption | null {
    const d = this.def;
    return d ? d.options[this.option[this.active]] : null;
  }

  /** 选择工具；再次选择同一工具时切换到下一个选项 */
  select(i: number): void {
    if (this.active === i) this.option[i] = (this.option[i] + 1) % this.defs[i].options.length;
    else {
      this.active = i;
      this.pending = null;
    }
  }

  setOption(i: number): void {
    if (this.active >= 0) this.option[this.active] = i;
  }

  exit(): void {
    this.active = -1;
    this.pending = null;
    this.preview.visible = false;
  }

  rotate(): void {
    this.yaw = (this.yaw + Math.PI / 4) % Math.PI;
  }

  /** 每帧更新鼠标下的地面点和预览 */
  hover(p: THREE.Vector3 | null): void {
    this.ground = p;
    const opt = this.current;
    if (!opt || !p) {
      this.preview.visible = false;
      return;
    }
    this.preview.visible = true;
    this.preview.position.set(p.x, p.y + 0.35, p.z);
    const len = opt.len ?? 0;
    this.ring.scale.setScalar(len ? 1.2 : opt.radius);
    this.stick.visible = len > 0;
    if (len) {
      this.stick.scale.set(len, 1, 1);
      this.stick.rotation.y = -this.yaw;
    }
    const r = this.run(true);
    this.ringMat.color.setHex(r.ok ? 0x8be07a : 0xe0604a);
  }

  apply(): ToolResult {
    return this.run(false);
  }

  private run(dry: boolean): ToolResult {
    const d = this.def;
    const p = this.ground;
    if (!d || !p) return { ok: false, msg: L('tool.clickGround') };
    return this.runner.run(d, this.option[this.active], p, this.yaw, dry);
  }
}
