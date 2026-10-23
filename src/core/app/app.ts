import * as THREE from 'three';
import { ENGINE } from '../config';
import { LANGS, t, tr } from '../i18n';
import { chooseLang, initLang } from '../platform/lang';
import { BACKGROUND_LIMITED, BackgroundRunner } from '../platform/background';
import { MOBILE } from '../platform/device';
import { Installer, registerServiceWorker } from '../platform/install';
import type { SaveMeta } from '../platform/saveSlot';
import { QUALITY_LEVELS, QUALITY_MODES, Quality } from '../render/quality';
import type { EntityRef } from '../sim/entities';
import type { Simulation } from '../sim/simulation';
import { CameraController } from '../ui/camera';
import type { GameModule, GameSave } from './game';
import { Shell } from './shell';

const SPEED_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 5, Digit4: 10, Digit5: 20 };
const TOUCH_PICK_PX = 32;

/**
 * 启动一个游戏：渲染器、相机、读档或新开局、界面外壳、选中与跟随、按键、自动保存、后台运行、主循环。
 * 网址参数：?new=1 忽略存档；?seed= 地图编号；?skip= 开局先快进的秒数；?cam=x,y,z,tx,ty,tz 视角；
 * ?hour= 开局时刻；?select=类型:编号（&follow=1 跟随，&fly=1 飞过去）；?view= 打开的显示开关；?lang= 界面语言
 */
export async function runApp<W extends Simulation<R>, R extends EntityRef, D extends GameSave, M extends SaveMeta>(game: GameModule<W, R, D, M>): Promise<void> {
  // ?lang=zh 或 ?lang=en 指定界面语言（截图用），不会被记住
  initLang(new URLSearchParams(location.search).get('lang'));
  document.title = game.title();
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = game.loading();
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const C = game.camera;
  const camera = new THREE.PerspectiveCamera(C.fov, window.innerWidth / window.innerHeight, C.near, C.far);

  const params = new URLSearchParams(location.search);
  const forceNew = game.configure?.(params) ?? false;
  // 有存档时接着上次继续；?new=1 忽略存档（之后的自动保存会覆盖它）
  // 新开局每次随机生成地图；?seed=数字 指定地图，便于复现和截图
  const seedParam = Number(params.get('seed'));
  const newSeed = seedParam > 0 ? seedParam >>> 0 : (Math.random() * 2 ** 31) >>> 0;
  const S = game.save;
  let world: W;
  let seed = newSeed;
  let loadMsg = '';
  let savedCamera: number[] | undefined;
  const saved = params.get('new') === '1' || forceNew ? null : S.slot.read();
  const problem = saved ? S.problem(saved) : null;
  if (saved && !problem) {
    try {
      world = game.create(saved.seed);
      S.read(world, saved);
      seed = saved.seed;
      loadMsg = t('toast.loaded', { stamp: tr(world.clock.stamp()) });
      savedCamera = saved.camera;
    } catch (e) {
      console.error(e);
      world = game.create(newSeed);
      loadMsg = t('toast.loadFailed');
    }
  } else {
    world = game.create(newSeed);
    if (problem) loadMsg = t('toast.problem', { problem });
  }
  // ?skip=秒数：开局先在后台快进模拟，便于直接观察扩建等慢过程
  const skip = Math.min(20000, Number(params.get('skip')) || 0);
  const chunk = ENGINE.loop.fixedStep * ENGINE.loop.maxStepsPerFrame;
  for (let t = 0; t < skip; t += chunk) world.advance(chunk);

  const space = game.space(world);
  const controller = new CameraController(camera, renderer.domElement, space);
  const pose = (p: number[]) => controller.setPose(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(p[3], p[4], p[5]));
  pose(typeof C.pose === 'function' ? C.pose(camera.aspect) : C.pose);
  // 支持 ?cam=x,y,z,tx,ty,tz 指定初始视角，便于分享观察位置；否则恢复存档时的视角
  const camParam = params.get('cam')?.split(',').map(Number) ?? savedCamera;
  if (camParam?.length === 6 && camParam.every(Number.isFinite)) pose(camParam);

  let selection: R | null = null;
  let fps = 60;
  const session = game.mount({
    world,
    scene,
    camera,
    dom: renderer.domElement,
    space,
    toast: (m) => shell.toast(m),
    select: (s) => select(s),
    following: () => shell.state.following,
  });
  const tools = session.tools;
  const quality = new Quality(renderer, session.shadowLight, MOBILE);
  const shell = new Shell<R, M>({
    world,
    seed,
    title: game.title,
    subtitle: game.subtitle,
    repoUrl: game.repoUrl,
    ui: session.ui,
    views: session.views,
    tools,
    describeSave: S.describe,
  });
  shell.quality = quality;
  const installer = game.installable ? new Installer() : null;
  if (installer) {
    shell.installer = installer;
    installer.onChange = () => shell.refresh(selection, fps);
    registerServiceWorker();
  }
  quality.onDrop = () => shell.toast(t('toast.qualityDrop', { q: t(`quality.${QUALITY_LEVELS[quality.level]}`) }));
  shell.saveMeta = S.slot.readMeta();
  if (tools) scene.add(tools.preview);
  let mouse: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') mouse = { x: e.clientX, y: e.clientY };
  });
  // iOS Safari 不认 touch-action 时仍会整页缩放
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  renderer.domElement.addEventListener('pointerleave', () => (mouse = null));

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPt = new THREE.Vector3();
  /** 鼠标下的表面点 */
  const groundPoint = (clientX: number, clientY: number, out = new THREE.Vector3()): THREE.Vector3 | null => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return space.raycast(ray.ray, out);
  };

  const select = (sel: R | null) => {
    selection = sel;
    session.onSelect?.(sel);
    if (controller.mode === 'follow' && !(sel && world.entities.canFollow(sel))) controller.stopFollow();
    if (sel && shell.compact) shell.hideHelp();
  };

  const flyToSelection = () => {
    if (!selection) return;
    const p = world.entities.pos(selection);
    if (p) controller.flyTo(p, world.entities.viewDistance(selection));
  };

  const toggleFollow = () => {
    if (controller.mode === 'follow') {
      controller.stopFollow();
      return;
    }
    const sel = selection;
    if (!sel || !world.entities.canFollow(sel)) {
      shell.toast(t('toast.selectFollowable'));
      return;
    }
    controller.follow(() => world.entities.pos(sel));
    shell.toast(t('toast.following'));
  };

  // 读档和重新开始都通过重新载入页面完成；载入前不再自动保存，以免覆盖
  let saveBlocked = false;
  let autosaveWarned = false;
  const camDir = new THREE.Vector3();
  const save = (manual: boolean) => {
    if (saveBlocked) return;
    const d = S.write(world, Date.now());
    camera.getWorldDirection(camDir);
    const target = camera.position.clone().addScaledVector(camDir, 10);
    d.camera = [...camera.position.toArray(), ...target.toArray()].map((n) => Math.round(n * 100) / 100);
    const err = S.slot.write(d, S.meta(d));
    shell.saveMeta = S.slot.readMeta();
    if (manual) shell.toast(err ? t('toast.saveFailed', { err }) : t('toast.saved', { stamp: tr(world.clock.stamp()) }));
    else if (err && !autosaveWarned) {
      autosaveWarned = true;
      shell.toast(t('toast.autosaveFailed', { err }));
    }
  };
  const reloadClean = () => {
    saveBlocked = true;
    location.replace(location.href.split(/[?#]/)[0]);
  };
  window.addEventListener('pagehide', () => save(false));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save(false);
  });

  const applyTool = (p: THREE.Vector3 | null): boolean => {
    if (!tools) return false;
    tools.hover(p);
    const r = tools.apply();
    if (r.msg) shell.toast(tr(r.msg));
    if (r.ok) {
      shell.refresh(selection, fps);
      session.onToolApplied?.();
    }
    return r.ok;
  };

  const action = (a: string, v?: number) => {
    const c = world.clock;
    const view = shell.views.find((x) => x.id === a);
    if (view) {
      view.toggle();
      if (view.id === 'stats') shell.refresh(selection, 60);
    } else
      switch (a) {
        case 'pause':
          c.paused = !c.paused;
          break;
        case 'speed':
          c.speed = v ?? 1;
          c.paused = false;
          break;
        case 'follow':
          toggleFollow();
          break;
        case 'flyto':
          flyToSelection();
          break;
        case 'deselect':
          select(null);
          break;
        case 'help':
          shell.toggleHelp();
          break;
        case 'tool':
          tools?.select(v ?? 0);
          shell.hideHelp();
          shell.setSheet(null);
          break;
        case 'toolopt':
          tools?.setOption(v ?? 0);
          break;
        case 'toolexit':
          tools?.exit();
          break;
        case 'toolPlace':
          if (tools?.pending && applyTool(tools.pending)) tools.pending = null;
          break;
        case 'toolRotate':
          tools?.rotate();
          break;
        case 'savePanel':
          shell.toggleSave();
          shell.saveMeta = S.slot.readMeta();
          break;
        case 'saveNow':
          save(true);
          break;
        case 'loadSave':
          if (S.slot.readMeta()) reloadClean();
          break;
        case 'newGame':
          if (!confirm(t('toast.confirmNew'))) break;
          S.slot.clear();
          reloadClean();
          break;
        case 'background':
          if (BACKGROUND_LIMITED) {
            shell.toast(t('toast.bgLimited'));
            break;
          }
          background.setEnabled(!background.enabled);
          shell.state.background = background.enabled;
          shell.toast(t(background.enabled ? 'toast.bgOn' : 'toast.bgOff'));
          break;
        case 'quality': {
          const mode = QUALITY_MODES[v ?? (QUALITY_MODES.indexOf(quality.mode) + 1) % QUALITY_MODES.length];
          quality.setMode(mode);
          shell.toast(t('toast.quality', { q: shell.qualityLabel() }));
          shell.refresh(selection, fps);
          break;
        }
        case 'install':
          if (installer?.kind === 'ios') shell.toast(t('toast.installIos'));
          else void installer?.install().then((ok) => ok && shell.toast(t('toast.installed')));
          break;
        case 'langMenu':
          shell.toggleLangMenu();
          break;
        case 'lang':
          shell.setLangMenu(false);
          if (!chooseLang(LANGS[v ?? 0] ?? 'zh')) break;
          document.title = game.title();
          shell.relocalize();
          shell.refresh(selection, fps);
          shell.toast(t('toast.lang'));
          break;
        default:
          session.action?.(a, v);
      }
    shell.renderTool();
    shell.renderSave();
    session.syncViews();
  };
  shell.onAction = action;
  shell.onEvent = (e) => {
    const sel = e.ref;
    if (sel && world.entities.pos(sel)) {
      select(sel);
      flyToSelection();
    } else if (e.at) {
      select(null);
      controller.flyTo(new THREE.Vector3(...e.at), world.entities.defaultViewDistance);
      if (sel) shell.toast(t('toast.eventGone'));
    }
    shell.refresh(selection, fps);
  };

  controller.onClick = (x, y, touch) => {
    // 手机布局里点画面先收起打开的抽屉，和地图应用一样
    if (shell.sheet) {
      shell.setSheet(null);
      return;
    }
    if (tools && tools.active >= 0) {
      if (!touch) return void applyTool(groundPoint(x, y, groundPt));
      tools.pending = groundPoint(x, y)?.clone() ?? null;
      if (!tools.pending) shell.toast(t('tool.clickGround'));
      shell.renderTool();
      return;
    }
    select(session.pick(x, y, touch ? TOUCH_PICK_PX : undefined));
  };
  // 触屏没有悬停：选好位置后，按在预览圈上拖动就让它跟着手指走
  const grabPt = new THREE.Vector3();
  const toScreen = (p: THREE.Vector3): [number, number] => {
    const rect = renderer.domElement.getBoundingClientRect();
    grabPt.copy(p).project(camera);
    return [rect.left + ((grabPt.x + 1) / 2) * rect.width, rect.top + ((1 - grabPt.y) / 2) * rect.height];
  };
  controller.onTouchDragStart = (x, y) => {
    const p = tools && tools.active >= 0 ? tools.pending : null;
    const opt = tools?.current;
    if (!p || !opt) return false;
    const [cx, cy] = toScreen(p);
    const [ex, ey] = toScreen(new THREE.Vector3(p.x + Math.max(opt.radius, (opt.len ?? 0) / 2), p.y, p.z));
    return Math.hypot(x - cx, y - cy) < Math.max(TOUCH_PICK_PX * 1.5, Math.hypot(ex - cx, ey - cy));
  };
  controller.onTouchDrag = (x, y) => {
    const p = groundPoint(x, y, groundPt);
    if (p && tools?.pending) tools.pending.copy(p);
  };
  controller.onDoubleClick = (x, y, touch) => {
    if (tools && tools.active >= 0) return;
    const s = session.pick(x, y, touch ? TOUCH_PICK_PX : undefined);
    if (s) {
      select(s);
      flyToSelection();
    }
  };

  const viewKeys = new Map(shell.views.filter((v) => v.key).map((v) => [`Key${v.key}`, v.id]));
  const toolKeys = new Map((tools?.defs ?? []).map((d, i) => [`Digit${d.key}`, i]));
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      return action('saveNow');
    }
    if (e.code in SPEED_KEYS) return action('speed', SPEED_KEYS[e.code]);
    const view = viewKeys.get(e.code);
    if (view) return action(view);
    const tool = toolKeys.get(e.code);
    if (tool !== undefined) return action('tool', tool);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        return action('pause');
      case 'KeyF':
        return action('follow');
      case 'KeyH':
        return action('help');
      case 'KeyR':
        tools?.rotate();
        return;
      case 'Escape':
        return action(tools && tools.active >= 0 ? 'toolexit' : 'deselect');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    shell.updateMode();
    shell.refresh(selection, fps);
  });

  const hourParam = Number(params.get('hour'));
  if (params.has('hour') && hourParam >= 0 && hourParam < 24) {
    world.clock.seconds += (((hourParam - world.clock.hour + 24) % 24) / 24) * world.clock.dayLength;
  }
  session.applyParams?.(params);
  const selParam = params.get('select')?.split(':');
  if (selParam?.length === 2) {
    const ref = { kind: selParam[0], id: Number(selParam[1]) } as unknown as R;
    if (world.entities.has(ref.kind) && world.entities.pos(ref)) select(ref);
    if (params.get('follow') === '1') toggleFollow();
    else if (params.get('fly') === '1') flyToSelection();
  }
  for (const name of params.get('view')?.split(',') ?? []) {
    const v = shell.views.find((x) => (x.param ?? x.id) === name);
    if (v && !v.on()) v.toggle();
  }

  session.syncViews();
  document.getElementById('loading')?.remove();
  if (loadMsg) shell.toast(loadMsg);
  setTimeout(() => shell.hideHelp(), 25000);

  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let last = performance.now();
  /** 每帧主线程耗时（ms，指数平均）：模拟推进、视图同步、提交渲染 */
  const perf = { sim: 0, views: 0, render: 0 };
  let hudTimer = 0;
  let autosaveTimer = 0;
  let time = 0;
  const autosave = (dt: number) => {
    autosaveTimer += dt;
    if (autosaveTimer > ENGINE.save.autosaveSec) {
      autosaveTimer = 0;
      save(false);
    }
  };

  /** 后台接手时的模拟秒数，回到页面时据此提示离开期间过了多久 */
  let awayFrom = -1;
  const background = new BackgroundRunner((dt) => {
    if (awayFrom < 0) awayFrom = world.clock.seconds;
    const B = ENGINE.background;
    world.advance(dt, Math.min(B.maxBudgetMs, dt * 1000 * B.cpuShare), Infinity);
    autosave(dt);
  });
  shell.state.background = background.enabled;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const awayMin = (Date.now() - hiddenAt) / 60000;
    if (awayFrom >= 0 && world.clock.seconds - awayFrom > 30) shell.toast(t('toast.bgResumed', { from: world.clock.stampAt(awayFrom), to: world.clock.stamp() }));
    else if (BACKGROUND_LIMITED && !world.clock.paused && awayMin >= 1) shell.toast(t('toast.bgFrozen', { n: Math.round(awayMin) }));
    awayFrom = -1;
    shell.refresh(selection, fps);
  });

  const frame = (now: number) => {
    if (!quality.frame(now, world.clock.paused)) {
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

    const t0 = performance.now();
    world.advance(dt, ENGINE.loop.frameBudgetMs);
    const t1 = performance.now();
    controller.update(dt);
    shell.state.following = controller.mode === 'follow';

    const cp = camera.position;
    const followed = controller.mode === 'follow' && selection ? world.entities.pos(selection) : null;
    if (followed) focus.copy(followed);
    else {
      camera.getWorldDirection(fwd);
      const h = Math.max(4, cp.y - space.surfaceAt(cp.x, cp.z));
      focus.copy(cp).addScaledVector(fwd, Math.min(60, h * 1.6));
      focus.y = space.surfaceAt(focus.x, focus.z);
    }

    if (tools && tools.active >= 0) tools.hover(tools.pending ?? (mouse ? groundPoint(mouse.x, mouse.y, groundPt) : null));
    session.update(dt, { time, focus, selection, following: shell.state.following });

    shell.tick(dt);
    autosave(dt);
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      shell.refresh(selection, fps, perf);
    }

    const t2 = performance.now();
    renderer.render(scene, camera);
    const t3 = performance.now();
    perf.sim += (t1 - t0 - perf.sim) * 0.05;
    perf.views += (t2 - t1 - perf.views) * 0.05;
    perf.render += (t3 - t2 - perf.render) * 0.05;
    requestAnimationFrame(frame);
  };
  shell.refresh(selection, fps);
  requestAnimationFrame(frame);

  Object.assign(window, { world, camera, controller, hud: shell, quality, renderer });
}
