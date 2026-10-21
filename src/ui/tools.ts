import * as THREE from 'three';
import { CONFIG } from '../config';
import { PLACEABLE_FOOD, SOURCE_INFO } from '../world/food';
import { PREDATOR_INFO, type PredatorKind } from '../world/predators';
import { OBSTACLE_INFO, type PlaceableObstacle } from '../world/vegetation';
import type { ToolResult, World } from '../world/world';

export type ToolKind = 'food' | 'obstacle' | 'water' | 'predator';

export interface ToolOption {
  label: string;
  radius: number;
  /** 线状预览的长度（树枝） */
  len?: number;
}

export interface ToolDef {
  kind: ToolKind;
  name: string;
  key: string;
  hint: string;
  options: ToolOption[];
}

const OBSTACLES: (PlaceableObstacle | 'remove')[] = ['pebble', 'rock', 'twig', 'remove'];
const PREDATORS: (PredatorKind | 'remove')[] = ['spider', 'antlion', 'remove'];

export const TOOLS: ToolDef[] = [
  {
    kind: 'food',
    name: '投食',
    key: '6',
    hint: '单击地面投放。糖水会被吸进嗉囊，猎物喂幼虫，种子的油质体也是食物',
    options: PLACEABLE_FOOD.map((t) => ({ label: SOURCE_INFO[t].name, radius: SOURCE_INFO[t].radius })),
  },
  {
    kind: 'obstacle',
    name: '障碍',
    key: '7',
    hint: '单击地面放置，R 旋转树枝。挡在信息素路径上，看蚂蚁怎样绕路',
    options: OBSTACLES.map((k) =>
      k === 'remove' ? { label: '移除', radius: 2.5 } : { label: OBSTACLE_INFO[k].name, radius: OBSTACLE_INFO[k].r, len: OBSTACLE_INFO[k].len },
    ),
  },
  {
    kind: 'water',
    name: '浇水',
    key: '8',
    hint: '单击地面浇水。水会冲掉信息素，形成的水洼会慢慢蒸发',
    options: CONFIG.intervention.waterRadius.map((r, i) => ({ label: i === 0 ? '一点水' : '一大杯水', radius: r })),
  },
  {
    kind: 'predator',
    name: '天敌',
    key: '9',
    hint: '单击地面放入。狼蛛在地表游猎，蚁狮挖坑等蚂蚁滑进去；也可以赶走它们',
    options: PREDATORS.map((k) =>
      k === 'remove' ? { label: '赶走', radius: CONFIG.predators.pitRadius + 1 } : { label: PREDATOR_INFO[k].name, radius: k === 'spider' ? 1.5 : CONFIG.predators.pitRadius },
    ),
  },
];

/** 玩家工具：当前选择、地面预览、执行。实际改动全部通过 World 的干预方法完成 */
export class ToolController {
  active = -1;
  option = TOOLS.map(() => 0);
  yaw = 0;
  readonly preview = new THREE.Group();
  private ring: THREE.Mesh;
  private stick: THREE.Mesh;
  private ringMat = new THREE.MeshBasicMaterial({ color: 0x8be07a, transparent: true, opacity: 0.85, depthTest: false });
  private ground: THREE.Vector3 | null = null;

  constructor(private world: World) {
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.88, 1, 40).rotateX(-Math.PI / 2), this.ringMat);
    this.stick = new THREE.Mesh(new THREE.BoxGeometry(1, 0.15, 0.5), this.ringMat);
    this.ring.renderOrder = 10;
    this.stick.renderOrder = 10;
    this.preview.add(this.ring, this.stick);
    this.preview.visible = false;
  }

  get def(): ToolDef | null {
    return this.active >= 0 ? TOOLS[this.active] : null;
  }

  get current(): ToolOption | null {
    const d = this.def;
    return d ? d.options[this.option[this.active]] : null;
  }

  /** 选择工具；再次选择同一工具时切换到下一个选项 */
  select(i: number): void {
    if (this.active === i) this.option[i] = (this.option[i] + 1) % TOOLS[i].options.length;
    else this.active = i;
  }

  setOption(i: number): void {
    if (this.active >= 0) this.option[this.active] = i;
  }

  exit(): void {
    this.active = -1;
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
    if (!d || !p) return { ok: false, msg: '请点击地面' };
    const w = this.world;
    const i = this.option[this.active];
    if (d.kind === 'food') return w.dropFood(PLACEABLE_FOOD[i], p.x, p.z, dry);
    if (d.kind === 'water') return w.pourWater(p.x, p.z, i === 1, dry);
    if (d.kind === 'predator') {
      const k = PREDATORS[i];
      return k === 'remove' ? w.removePredator(p.x, p.z, dry) : w.placePredator(k, p.x, p.z, dry);
    }
    const k = OBSTACLES[i];
    return k === 'remove' ? w.removeObstacle(p.x, p.z, dry) : w.placeObstacle(k, p.x, p.z, this.yaw, dry);
  }
}
