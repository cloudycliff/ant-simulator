import type { MsgKey } from '../i18n';

/** 笔记里的一条。tip 为真时第一次看到弹一张提示卡；hint 是还没看到时写的“在哪能看到” */
export interface NoteDef {
  /** 稳定的编号，记在本地，改了玩家已经看过的就没了 */
  id: string;
  group: MsgKey;
  title: MsgKey;
  /** 正文，可以有 <b>、<kbd>；一行一段 */
  body: MsgKey;
  hint?: MsgKey;
  tip?: boolean;
}

/**
 * 游戏的笔记（GameUi.notes）。key 是本地存储的键（各游戏不同）；title 是笔记面板的标题；
 * check(known) 在外壳刷新面板时调用（约每秒 4 次），返回这一刻看得到的条目编号，known 里已经有的可以不算
 */
export interface NotesDef {
  key: string;
  title: MsgKey;
  entries: NoteDef[];
  check(known: ReadonlySet<string>): Iterable<string>;
}

interface NotesStore {
  known: string[];
  read: string[];
  tips: boolean;
}

/**
 * 看到过的、读过的条目和“第一次的提示”开关，记在本地：属于玩家不属于世界，不进存档，新开局也留着。
 * 不碰 DOM（外壳画面板），本地存储不可用时只记在这一页里
 */
export class Notebook {
  readonly known = new Set<string>();
  readonly read = new Set<string>();
  tipsOn = true;
  /** 等着弹的提示卡，一次弹一张 */
  private readonly queue: string[] = [];
  private readonly byId: Map<string, NoteDef>;

  constructor(
    readonly def: NotesDef,
    private readonly store: Pick<Storage, 'getItem' | 'setItem'> | null,
    /** 这一页不弹提示卡（截图用，?tips=0），不记住 */
    private readonly quiet = false,
  ) {
    this.byId = new Map(def.entries.map((e) => [e.id, e]));
    try {
      const s = store?.getItem(def.key);
      if (s) {
        const d = JSON.parse(s) as Partial<NotesStore>;
        for (const id of d.known ?? []) if (this.byId.has(id)) this.known.add(id);
        for (const id of d.read ?? []) if (this.known.has(id)) this.read.add(id);
        this.tipsOn = d.tips !== false;
      }
    } catch {
      // 读不出来就当没看过
    }
  }

  get(id: string): NoteDef | undefined {
    return this.byId.get(id);
  }

  /** 看到了一条；新看到的返回 true，带提示卡的排进队里 */
  learn(id: string): boolean {
    const e = this.byId.get(id);
    if (!e || this.known.has(id)) return false;
    this.known.add(id);
    if (e.tip && this.tipsOn && !this.quiet) this.queue.push(id);
    this.save();
    return true;
  }

  /** 问一次游戏这一刻看得到什么 */
  poll(): void {
    for (const id of this.def.check(this.known)) this.learn(id);
  }

  /** 正在弹的提示卡 */
  get tip(): NoteDef | null {
    return this.queue.length ? this.byId.get(this.queue[0])! : null;
  }

  /** 关掉正在弹的提示卡，算读过 */
  dismiss(): void {
    const id = this.queue.shift();
    if (id) this.markRead(id);
  }

  markRead(id: string): void {
    if (!this.known.has(id) || this.read.has(id)) return;
    this.read.add(id);
    this.save();
  }

  /** 看到了还没读的条数（正在弹的提示卡不算） */
  get unread(): number {
    let n = 0;
    for (const id of this.known) if (!this.read.has(id) && !this.queue.includes(id)) n++;
    return n;
  }

  /** 关掉提示卡时等着弹的也不弹了，留在笔记里没读 */
  setTips(on: boolean): void {
    this.tipsOn = on;
    if (!on) this.queue.length = 0;
    this.save();
  }

  private save(): void {
    try {
      const d: NotesStore = { known: [...this.known], read: [...this.read], tips: this.tipsOn };
      this.store?.setItem(this.def.key, JSON.stringify(d));
    } catch {
      // 存不了就只记在这一页里
    }
  }
}
