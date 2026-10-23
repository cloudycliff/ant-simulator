import type * as THREE from 'three';
import type { MsgKey, Text } from '../i18n';
import type { SaveMeta, SaveSlot } from '../platform/saveSlot';
import type { EntityRef } from '../sim/entities';
import type { Simulation } from '../sim/simulation';
import type { Space } from '../space/space';
import type { ToolController } from '../ui/tools';

/** 存档至少有世界种子；camera 由外壳在保存时写入（相机位置 + 注视点） */
export interface GameSave {
  seed: number;
  camera?: number[];
}

/**
 * 一个游戏交给外壳（core/app/app.ts 的 runApp）的全部东西：怎样创建、保存、读取世界，
 * 以及 mount：把场景、显示开关、点选和面板内容接到外壳上。
 */
export interface GameModule<W extends Simulation<R>, R extends EntityRef, D extends GameSave, M extends SaveMeta> {
  title(): string;
  subtitle(): string;
  /** 生成世界时显示的文字 */
  loading(): string;
  repoUrl?: string;
  /** 能添加到主屏幕：注册离线缓存脚本（public/sw.js）、显示安装按钮。页面要有自己的清单 */
  installable?: boolean;
  /** 视角（度）、近远裁剪面、开局的相机位置和注视点；pose 可以按屏幕宽高比给（竖屏时退远些把场景装下） */
  camera: { fov: number; near: number; far: number; pose: CameraPose | ((aspect: number) => CameraPose) };
  /** 创建世界之前读网址参数；返回 true 时不读存档、开新局 */
  configure?(params: URLSearchParams): boolean;
  /** 读档时 saved 是要读的存档（随后交给 save.read），新开局时为空 */
  create(seed: number, saved?: D): W;
  save: {
    slot: SaveSlot<D, M>;
    write(w: W, savedAt: number): D;
    /** 把存档套到用 d.seed 刚创建的世界上；失败时抛错 */
    read(w: W, d: D): void;
    /** 存档不能用于当前版本时返回原因 */
    problem(d: D): Text | null;
    meta(d: D): M;
    /** 存档面板里的一句摘要，比如“1000 只蚂蚁” */
    describe(m: M): string;
  };
  space(w: W): Space;
  mount(ctx: GameContext<W, R>): GameSession<R>;
}

/** 相机位置 x, y, z 和注视点 x, y, z */
export type CameraPose = [number, number, number, number, number, number];

/** 外壳交给游戏的东西 */
export interface GameContext<W, R> {
  world: W;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dom: HTMLElement;
  space: Space;
  toast(msg: string): void;
  select(sel: R | null): void;
  /** 相机正在跟随选中的对象 */
  following(): boolean;
}

/** 游戏声明的显示开关：外壳据此生成按钮、快捷键、?view= 参数 */
export interface ViewToggle {
  /** 按钮的 data-a 和 id（btn-<id>） */
  id: string;
  label(): string;
  /** 快捷键字母，如 'X'（对应 KeyX） */
  key?: string;
  /** ?view= 里的名字，默认是 id */
  param?: string;
  /** 手机布局里放在底栏上（否则放在“视图”抽屉里） */
  dock?: { icon: string; label(): string };
  on(): boolean;
  toggle(): void;
}

/** 每类对象的信息面板，类型检查要求每一类都有 */
export type InfoPanels<R extends EntityRef> = { [K in R['kind']]: (ref: Extract<R, { kind: K }>) => string };

export function renderInfo<R extends EntityRef>(panels: InfoPanels<R>, ref: R): string {
  return (panels[ref.kind as R['kind']] as (r: R) => string)(ref);
}

/** 面板内容。外壳负责面板的位置、开合、手机抽屉，游戏只给 HTML */
export interface GameUi<R extends EntityRef> {
  /** 顶栏时钟旁的图标和状态文字（天气、温度等） */
  status(compact: boolean): { icon: string; text: string };
  /** 帧率后面补充的内容，比如个体数 */
  perfExtra(): string;
  /** 主面板（DOM 里是 #colony） */
  panel: { icon: string; label(): string; html(folded: boolean): string };
  infoHint(): string;
  info: InfoPanels<R>;
  /** 统计面板：html 在创建时写入一次，draw 在打开时调用，force 为真时必须重画 */
  stats?: { html: string; draw(force: boolean): void };
  /** 图例（比如信息素颜色） */
  legend?: { html(): string; visible(): boolean };
  /** 帮助面板的各行；手机布局里 help.events 换成 help.dockEvents */
  help: { mouse: MsgKey[]; touch: MsgKey[] };
}

export interface FrameInfo<R> {
  /** 页面打开以来的秒数 */
  time: number;
  /** 视线落在表面上的点，或跟随的对象 */
  focus: THREE.Vector3;
  selection: R | null;
  following: boolean;
}

export interface GameSession<R extends EntityRef> {
  /** 投影的方向光（画质档位调它的阴影贴图） */
  shadowLight: THREE.DirectionalLight;
  views: ViewToggle[];
  tools: ToolController | null;
  pick(x: number, y: number, tolerance?: number): R | null;
  onSelect?(sel: R | null): void;
  /** 玩家用工具成功改动了世界之后 */
  onToolApplied?(): void;
  /** 外壳不认识的按钮动作（比如信息面板里的“移除”）；处理了返回 true */
  action?(a: string, v?: number): boolean;
  /** 读网址参数（在 ?hour= 之后、?select= 之前） */
  applyParams?(params: URLSearchParams): void;
  /** 显示开关变了，同步到场景 */
  syncViews(): void;
  /** 每帧在模拟推进、相机更新之后，渲染之前 */
  update(dt: number, f: FrameInfo<R>): void;
  ui: GameUi<R>;
}
