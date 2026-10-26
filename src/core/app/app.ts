import * as THREE from 'three';
import { Music } from '../audio/music';
import { t, tr } from '../i18n';
import type { BackgroundRunner } from '../platform/background';
import { MOBILE } from '../platform/device';
import { initLang } from '../platform/lang';
import { Installer, registerServiceWorker } from '../platform/install';
import type { SaveMeta } from '../platform/saveSlot';
import { Brightness } from '../render/brightness';
import { QUALITY_LEVELS, Quality } from '../render/quality';
import type { EntityRef } from '../sim/entities';
import type { SimEvent } from '../sim/events';
import type { Simulation } from '../sim/simulation';
import type { Space } from '../space/space';
import { CameraController } from '../ui/camera';
import type { ToolController } from '../ui/tools';
import { runAction } from './actions';
import { createRenderer, openWorld } from './boot';
import type { GameModule, GameSave, GameSession } from './game';
import { bindInput } from './input';
import { startBackground, startLoop } from './loop';
import { SaveControl } from './saving';
import { Shell } from './shell';
import { applyUrlParams, startPose } from './urlParams';

/**
 * 启动一个游戏：渲染器、相机、读档或新开局、界面外壳、选中与跟随、按键、自动保存、后台运行、主循环。
 * 网址参数：?new=1 忽略存档；?seed= 地图编号；?skip= 开局先快进的秒数；?cam=x,y,z,tx,ty,tz 视角；
 * ?hour= 开局时刻；?select=类型:编号（&follow=1 跟随，&fly=1 飞过去）；?view= 打开的显示开关；?lang= 界面语言
 */
export async function runApp<W extends Simulation<R>, R extends EntityRef, D extends GameSave, M extends SaveMeta>(game: GameModule<W, R, D, M>): Promise<void> {
  const params = new URLSearchParams(location.search);
  // ?lang=zh 或 ?lang=en 指定界面语言（截图用），不会被记住
  initLang(params.get('lang'));
  document.title = game.title();
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = game.loading();
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  const renderer = createRenderer();
  const opened = openWorld(game, params);
  const app = new App<R>(game, renderer, opened.world, opened.seed, startPose(params, opened.camera));
  bindInput(app);
  applyUrlParams(app, params);

  app.session.syncViews();
  document.getElementById('loading')?.remove();
  if (opened.message) app.shell.toast(opened.message);
  setTimeout(() => app.shell.hideHelp(), 25000);
  startLoop(app);

  const { world, camera, controller, shell: hud, quality, music, brightness } = app;
  Object.assign(window, { world, camera, controller, hud, quality, music, brightness, renderer });
}

/**
 * 运行中的外壳：场景、相机、游戏的 session、界面外壳，以及选中、跟随、点到表面、使用工具这些各处共用的操作。
 * 按键和点击（input.ts）、按钮动作（actions.ts）、网址参数（urlParams.ts）、主循环和后台运行（loop.ts）、保存（saving.ts）都拿它做第一个参数
 */
export class App<R extends EntityRef> {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly space: Space;
  readonly controller: CameraController;
  readonly session: GameSession<R>;
  readonly tools: ToolController | null;
  readonly quality: Quality;
  readonly shell: Shell<R, SaveMeta>;
  readonly installer: Installer | null;
  readonly music = new Music();
  readonly brightness = new Brightness();
  readonly saving: SaveControl<R>;
  readonly background: BackgroundRunner;
  selection: R | null = null;
  fps = 60;
  /** 鼠标在画面上的位置（触屏没有悬停，始终为 null） */
  mouse: { x: number; y: number } | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    readonly game: GameModule<Simulation<R>, R, GameSave, SaveMeta>,
    readonly renderer: THREE.WebGLRenderer,
    readonly world: Simulation<R>,
    seed: number,
    pose: number[] | null,
  ) {
    const C = game.camera;
    this.camera = new THREE.PerspectiveCamera(C.fov, window.innerWidth / window.innerHeight, C.near, C.far);
    this.space = game.space(world);
    this.controller = new CameraController(this.camera, renderer.domElement, this.space);
    this.setPose(typeof C.pose === 'function' ? C.pose(this.camera.aspect) : C.pose);
    if (pose) this.setPose(pose);

    this.session = game.mount({
      world,
      scene: this.scene,
      camera: this.camera,
      dom: renderer.domElement,
      space: this.space,
      toast: (m) => this.shell.toast(m),
      select: (s) => this.select(s),
      following: () => this.shell.state.following,
    });
    this.tools = this.session.tools;
    this.quality = new Quality(renderer, this.session.shadowLight, MOBILE);
    const shell = (this.shell = new Shell<R, SaveMeta>({
      world,
      seed,
      title: game.title,
      subtitle: game.subtitle,
      repoUrl: game.repoUrl,
      ui: this.session.ui,
      views: this.session.views,
      tools: this.tools,
      describeSave: game.save.describe,
    }));
    shell.quality = this.quality;
    shell.music = this.music;
    shell.brightness = this.brightness;
    this.installer = game.installable ? new Installer() : null;
    if (this.installer) {
      shell.installer = this.installer;
      this.installer.onChange = () => this.refresh();
      registerServiceWorker();
    }
    this.quality.onDrop = () => shell.toast(t('toast.qualityDrop', { q: t(`quality.${QUALITY_LEVELS[this.quality.level]}`) }));
    shell.saveMeta = game.save.slot.readMeta();
    if (this.tools) this.scene.add(this.tools.preview);

    this.saving = new SaveControl(this);
    shell.onAction = (a, v) => runAction(this, a, v);
    shell.onEvent = (e) => this.openEvent(e);
    this.background = startBackground(this);
  }

  /** 相机位置 x, y, z 和注视点 x, y, z */
  setPose(p: readonly number[]): void {
    this.controller.setPose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(p[3], p[4], p[5]));
  }

  refresh(): void {
    this.shell.refresh(this.selection, this.fps);
  }

  /** 屏幕上这一点对着的表面点 */
  groundPoint(clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.space.raycast(this.ray.ray, out);
  }

  select(sel: R | null): void {
    this.selection = sel;
    this.session.onSelect?.(sel);
    if (this.controller.mode === 'follow' && !(sel && this.world.entities.canFollow(sel))) this.controller.stopFollow();
    if (sel && this.shell.compact) this.shell.hideHelp();
  }

  flyToSelection(): void {
    if (!this.selection) return;
    const p = this.world.entities.pos(this.selection);
    if (p) this.controller.flyTo(p, this.world.entities.viewDistance(this.selection));
  }

  toggleFollow(): void {
    const { controller, world, shell } = this;
    if (controller.mode === 'follow') {
      controller.stopFollow();
      return;
    }
    const sel = this.selection;
    if (!sel || !world.entities.canFollow(sel)) {
      shell.toast(t('toast.selectFollowable'));
      return;
    }
    controller.follow(() => world.entities.pos(sel));
    shell.toast(t('toast.following'));
  }

  /** 在 p 处使用当前工具；成功返回 true */
  applyTool(p: THREE.Vector3 | null): boolean {
    const tools = this.tools;
    if (!tools) return false;
    tools.hover(p);
    const r = tools.apply();
    if (r.msg) this.shell.toast(tr(r.msg));
    if (r.ok) {
      this.refresh();
      this.session.onToolApplied?.();
    }
    return r.ok;
  }

  /** 点了事件列表里的一条：对象还在就选中并飞过去，不在了飞到事件发生的地方 */
  private openEvent(e: SimEvent<R>): void {
    const sel = e.ref;
    if (sel && this.world.entities.pos(sel)) {
      this.select(sel);
      this.flyToSelection();
    } else if (e.at) {
      this.select(null);
      this.controller.flyTo(new THREE.Vector3(...e.at), this.world.entities.defaultViewDistance);
      if (sel) this.shell.toast(t('toast.eventGone'));
    }
    this.refresh();
  }
}
