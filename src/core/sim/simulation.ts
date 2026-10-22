import { ENGINE } from '../config';
import { SimClock } from './clock';
import { EntityRegistry, type EntityRef } from './entities';
import { EventLog } from './events';
import { SaveRegistry } from './saves';

/** 每个模拟步调用一次的子系统；update 可以被替换（性能测试用它统计各子系统的耗时） */
export interface SimSystem {
  readonly name: string;
  update: (dt: number) => void;
}

/**
 * 模拟内核：时钟、按固定步长依次推进的子系统、存档的各部分、实体注册表、最近事件。
 * 游戏的世界继承它，在构造时登记自己的子系统和存档部分。不依赖渲染和 DOM
 */
export class Simulation<R extends EntityRef = EntityRef> {
  readonly clock: SimClock;
  readonly systems: SimSystem[] = [];
  readonly saves = new SaveRegistry();
  readonly entities = new EntityRegistry<R>();
  readonly events: EventLog<R>;
  private acc = 0;
  /** 最近一帧实际执行的模拟步数（性能面板用） */
  lastSteps = 0;
  /** 最近的实际倍速（指数平均），模拟跟不上时低于 clock.speed */
  effectiveSpeed = 1;

  constructor(dayLength: number, startHour: number) {
    this.clock = new SimClock(dayLength, startHour);
    this.events = new EventLog<R>(this.clock);
    this.events.locate = (r) => this.entities.pos(r);
    this.saves.add(
      'clock',
      () => ({ seconds: this.clock.seconds, speed: this.clock.speed }),
      (d) => {
        this.clock.seconds = d.seconds;
        this.clock.speed = d.speed;
      },
    );
  }

  /** 每步按登记的顺序调用 */
  addSystem(name: string, update: (dt: number) => void): void {
    this.systems.push({ name, update });
  }

  /**
   * 推进真实时间 realDt 秒（内部乘以倍速）。一帧内模拟耗时超过 budgetMs 就停下，
   * 丢掉没来得及算的时间，这时实际倍速低于设定倍速（见 effectiveSpeed）。
   */
  advance(realDt: number, budgetMs = Infinity, maxSteps = ENGINE.loop.maxStepsPerFrame): void {
    this.lastSteps = 0;
    if (this.clock.paused) return;
    const step = ENGINE.loop.fixedStep;
    this.acc += Math.min(realDt * this.clock.speed, step * maxSteps);
    const start = performance.now();
    while (this.acc >= step) {
      this.acc -= step;
      this.tick(step);
      this.lastSteps++;
      if (performance.now() - start > budgetMs) {
        this.acc = Math.min(this.acc, step);
        break;
      }
    }
    const eff = (this.lastSteps * step) / Math.max(realDt, 1e-3);
    this.effectiveSpeed += (eff - this.effectiveSpeed) * 0.05;
  }

  private tick(dt: number): void {
    this.clock.seconds += dt;
    for (const s of this.systems) s.update(dt);
  }
}
