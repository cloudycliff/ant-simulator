import { ENGINE } from '../config';
import { Rng } from '../util/random';
import { SimClock, type Calendar } from './clock';
import { EntityRegistry, type EntityRef } from './entities';
import { EventLog } from './events';
import { IdPool } from './ids';
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

  /**
   * 模拟用的随机数，由世界的种子决定并进存档：同一个存档读进来，之后的运行每次都一样。
   * 只影响画面的随机（雨滴、叶子抖动）用 Math.random，不要动它
   */
  readonly rng: Rng;
  readonly ids = new IdPool();

  /** calendar：季节的日历（T-076），不给就冻在夏天 */
  constructor(dayLength: number, startHour: number, seed: number, calendar?: Calendar) {
    this.clock = new SimClock(dayLength, startHour, calendar);
    this.rng = new Rng(seed);
    this.events = new EventLog<R>(this.clock);
    this.events.locate = (r) => this.entities.pos(r);
    this.saves.add(
      'clock',
      // 日历冻住的游戏不写 yearStart，存档和以前一样
      () => ({ seconds: this.clock.seconds, speed: this.clock.speed, ...(this.clock.seasonal ? { yearStart: this.clock.yearStart } : {}) }),
      (d: { seconds: number; speed: number; yearStart?: number }) => {
        this.clock.seconds = d.seconds;
        this.clock.speed = d.speed;
        this.clock.yearStart = d.yearStart ?? this.clock.calendar.start;
      },
    );
    this.saves.addLast(
      'rng',
      () => this.rng.state,
      (s) => (this.rng.state = s),
    );
    this.saves.addLast(
      'ids',
      () => this.ids.toSave(),
      (d) => this.ids.restore(d),
    );
  }

  /**
   * 上一步之后又攒了多少不够一步的时间，0..1（按步长算）。画面在上一步和这一步的位置之间按它插值，
   * 跑得快的东西（每步走几厘米）在 60 帧的屏幕上才不会一顿一顿
   */
  get alpha(): number {
    return Math.min(1, this.acc / ENGINE.loop.fixedStep);
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
