/**
 * 行为协程：一段任务写成生成器，用 yield 把一条指令（走到哪里、等多久）交给个体的运动层，
 * 指令完成后协程拿到结果（yield 的返回值）接着往下写。任务里的判断和指令交替进行，读起来就是任务本身的步骤
 */
export type Routine<C> = Generator<C, void, unknown>;

/**
 * 驱动一个个体的行为协程。指令的类型和执行由游戏决定，这里只管取指令、交结果、换任务。
 * 协程不能存档（生成器不能序列化）。游戏可以存下当前指令和它的执行进度，读档后用 resume 接着做完这一步，
 * 之后再由 run 的 next 开新任务（比如先把手里的东西送到）
 */
export class Behavior<C> {
  routine: Routine<C> | null = null;
  cmd: C | null = null;
  /** 当前指令已经执行过至少一步 */
  started = false;
  /** 执行者完成指令时可以设一个结果，协程在 yield 处拿到它 */
  result: unknown = undefined;

  /**
   * 推进一帧：没有指令就从协程取下一条，协程结束了就用 next 开一个新任务；exec 执行指令，返回 true 表示完成。
   * 立刻完成的指令在同一帧接着取下一条，最多 maxCmds 条，防止空转的任务卡住一帧
   */
  run(next: () => Routine<C>, exec: (cmd: C, first: boolean) => boolean, maxCmds = 4): void {
    for (let i = 0; i < maxCmds; i++) {
      if (!this.cmd) {
        if (!this.routine) this.routine = next();
        const r = this.routine.next(this.result);
        this.result = undefined;
        if (r.done) {
          this.routine = null;
          continue;
        }
        this.cmd = r.value;
        this.started = false;
      }
      const first = !this.started;
      this.started = true;
      if (!exec(this.cmd, first)) break;
      this.cmd = null;
    }
  }

  /** 丢掉当前协程和指令，下一帧从 r 开始（比如有急事要临时调派） */
  start(r: Routine<C>): void {
    this.routine = r;
    this.cmd = null;
    this.result = undefined;
  }

  /**
   * 读档：接着执行一条存下来的指令，不带协程；做完后下一帧开新任务。
   * started 为真时执行者不再把它当作第一步（进度由游戏自己恢复）
   */
  resume(cmd: C, started: boolean): void {
    this.routine = null;
    this.cmd = cmd;
    this.started = started;
    this.result = undefined;
  }

  /** 放弃当前任务，下一帧开新任务 */
  abort(): void {
    this.routine = null;
    this.cmd = null;
  }
}
