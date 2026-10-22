import './style.css';
import * as THREE from 'three';
import { ENGINE } from './core/config';
import { CONFIG } from './games/ant/config';
import { LANGS, t, tr } from './core/i18n';
import { World } from './games/ant/world/world';
import { NestView } from './games/ant/nest/nestView';
import { RainView } from './core/render/rain';
import { AntView } from './games/ant/render/antView';
import { ItemView } from './games/ant/render/itemView';
import { Environment } from './core/render/environment';
import { CameraController } from './core/ui/camera';
import { Picker, type Selection } from './games/ant/ui/picking';
import { Hud, type HudAction } from './games/ant/ui/hud';
import { ToolController } from './games/ant/ui/tools';
import { chooseLang, initLang } from './core/platform/lang';
import { BACKGROUND_LIMITED, BackgroundRunner } from './core/platform/background';
import { MOBILE } from './core/platform/device';
import { Installer, registerServiceWorker } from './core/platform/install';
import { QUALITY_LEVELS, QUALITY_MODES, Quality } from './core/render/quality';
import { loadWorld, saveMeta, saveProblem, saveSlot, saveWorld } from './games/ant/world/save';
import { createSpace } from './games/ant/space';

const SPEED_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 5, Digit4: 10, Digit5: 20 };

async function boot(): Promise<void> {
  // ?lang=zh 或 ?lang=en 指定界面语言（截图用），不会被记住
  initLang(new URLSearchParams(location.search).get('lang'));
  document.title = t('app.title');
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = t('app.loading');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 2500);

  const params = new URLSearchParams(location.search);
  // ?ants=工蚁数：新开局时的初始工蚁数（性能测试用）
  const antsParam = Number(params.get('ants'));
  if (antsParam > 0) {
    CONFIG.colony.initialWorkers = Math.min(5000, antsParam);
    CONFIG.colony.maxPopulation = Math.max(CONFIG.colony.maxPopulation, CONFIG.colony.initialWorkers + 200);
  }
  // 有存档时接着上次继续；?new=1 忽略存档（之后的自动保存会覆盖它）
  // 新开局每次随机生成地图；?seed=数字 指定地图，便于复现和截图
  const seedParam = Number(params.get('seed'));
  const newSeed = seedParam > 0 ? seedParam >>> 0 : (Math.random() * 2 ** 31) >>> 0;
  let world: World;
  let loadMsg = '';
  let savedCamera: number[] | undefined;
  const saved = params.get('new') === '1' || antsParam > 0 ? null : saveSlot.read();
  const problem = saved ? saveProblem(saved) : null;
  if (saved && !problem) {
    try {
      world = new World(saved.seed);
      loadWorld(world, saved);
      loadMsg = t('toast.loaded', { stamp: tr(world.clock.stamp()) });
      savedCamera = saved.camera;
    } catch (e) {
      console.error(e);
      world = new World(newSeed);
      loadMsg = t('toast.loadFailed');
    }
  } else {
    world = new World(newSeed);
    if (problem) loadMsg = t('toast.problem', { problem });
  }
  // ?skip=秒数：开局先在后台快进模拟，便于直接观察扩建等慢过程
  const skip = Math.min(20000, Number(params.get('skip')) || 0);
  const chunk = ENGINE.loop.fixedStep * ENGINE.loop.maxStepsPerFrame;
  for (let t = 0; t < skip; t += chunk) world.advance(chunk);
  scene.add(world.terrain.mesh, world.veg.group, world.food.group, world.aphids.group, world.water.group, world.predators.group, world.alarm.group);

  const nestView = new NestView(world.nest, world.terrain);
  nestView.build();
  scene.add(nestView.group, nestView.surfaceGroup);
  const rain = new RainView();
  scene.add(rain.lines, rain.splashes);
  const terrainMat = world.terrain.mesh.material as THREE.MeshStandardMaterial;

  scene.add(world.pheromone.buildOverlay());

  const antView = new AntView(world);
  scene.add(antView.workers, antView.workersLow, antView.queens, antView.marker);
  const itemView = new ItemView(world);
  scene.add(itemView.group);
  const env = new Environment(scene, CONFIG.light);
  const quality = new Quality(renderer, env.sun, MOBILE);

  const space = createSpace(world);
  const controller = new CameraController(camera, renderer.domElement, space);
  controller.setPose(new THREE.Vector3(16, 13, 22), new THREE.Vector3(0, 0, 1));
  // 支持 ?cam=x,y,z,tx,ty,tz 指定初始视角，便于分享观察位置；否则恢复存档时的视角
  const camParam = params.get('cam')?.split(',').map(Number) ?? savedCamera;
  if (camParam?.length === 6 && camParam.every(Number.isFinite)) {
    controller.setPose(new THREE.Vector3(camParam[0], camParam[1], camParam[2]), new THREE.Vector3(camParam[3], camParam[4], camParam[5]));
  }

  const picker = new Picker(world, space, camera, renderer.domElement, antView, {
    chambers: nestView.chamberMeshes,
    surface: [world.food.group, nestView.surfaceGroup, world.veg.placedGroup, world.water.group, world.predators.group, ...world.veg.group.children.filter((o) => o.userData.pick)],
    terrain: world.terrain.mesh,
  });
  const hud = new Hud(world);
  hud.quality = quality;
  const installer = new Installer();
  hud.installer = installer;
  installer.onChange = () => hud.refresh(selection, fps);
  registerServiceWorker();
  quality.onDrop = () => hud.toast(t('toast.qualityDrop', { q: t(`quality.${QUALITY_LEVELS[quality.level]}`) }));
  hud.saveMeta = saveSlot.readMeta();
  const tools = new ToolController(world);
  hud.tools = tools;
  scene.add(tools.preview);
  let mouse: { x: number; y: number } | null = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') mouse = { x: e.clientX, y: e.clientY };
  });
  // iOS Safari 不认 touch-action 时仍会整页缩放
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  renderer.domElement.addEventListener('pointerleave', () => (mouse = null));
  const groundPt = new THREE.Vector3();

  let selection: Selection | null = null;
  let xrayApplied: boolean | null = null;

  const xrayOn = () => hud.state.xray || hud.state.forcedXray;
  const applyView = () => {
    const on = xrayOn();
    if (on !== xrayApplied) {
      xrayApplied = on;
      world.terrain.setXray(on);
      nestView.setXray(on);
      antView.xray = on;
      itemView.xray = on;
    }
    world.veg.setGrassVisible(hud.state.grass && !on);
    world.veg.setLeavesVisible(!on);
    world.pheromone.overlay.visible = hud.state.pheromone;
    antView.roleColors = hud.state.roleColors;
  };

  const selectionPos = (sel: Selection | null): THREE.Vector3 | null => {
    if (!sel) return null;
    switch (sel.kind) {
      case 'ant':
        return world.colony.antById(sel.id)?.pos.clone() ?? null;
      case 'chamber':
        return world.nest.chambers[sel.id].floor.clone();
      case 'food': {
        const f = world.food.byId(sel.id);
        return f ? new THREE.Vector3(f.x, f.y, f.z) : null;
      }
      case 'entrance': {
        const e = world.nest.entrances[sel.id];
        return new THREE.Vector3(e.x, world.terrain.heightAt(e.x, e.z), e.z);
      }
      case 'midden': {
        const m = world.colony.midden;
        return new THREE.Vector3(m.x, world.terrain.heightAt(m.x, m.z), m.z);
      }
      case 'plant': {
        const p = world.veg.plants[sel.id];
        const ac = world.aphids.byPlant(sel.id);
        return p ? new THREE.Vector3(p.x, ac ? ac.bandLo : p.baseY + 4, p.z) : null;
      }
      case 'predator': {
        const p = world.predators.byId(sel.id);
        return p ? new THREE.Vector3(p.x, world.terrain.heightAt(p.x, p.z) + 1, p.z) : null;
      }
      default:
        return null;
    }
  };

  const select = (sel: Selection | null) => {
    selection = sel;
    antView.selectedId = sel?.kind === 'ant' ? sel.id : -1;
    nestView.highlightChamber(sel?.kind === 'chamber' ? sel.id : null);
    if (controller.mode === 'follow' && sel?.kind !== 'ant') controller.stopFollow();
    if (sel && hud.compact) hud.hideHelp();
  };

  const flyToSelection = () => {
    const p = selectionPos(selection);
    if (!p || !selection) return;
    const dist = selection.kind === 'ant' ? 6 : selection.kind === 'chamber' ? 26 : 14;
    controller.flyTo(p, dist);
  };

  const toggleFollow = () => {
    if (controller.mode === 'follow') {
      controller.stopFollow();
      return;
    }
    if (selection?.kind !== 'ant') {
      hud.toast(t('toast.selectAntFirst'));
      return;
    }
    const id = selection.id;
    controller.follow(() => world.colony.antById(id)?.pos ?? null);
    hud.toast(t('toast.following'));
  };

  // 读档和重新开始都通过重新载入页面完成；载入前不再自动保存，以免覆盖
  let saveBlocked = false;
  let autosaveWarned = false;
  const camDir = new THREE.Vector3();
  const save = (manual: boolean) => {
    if (saveBlocked) return;
    const d = saveWorld(world, Date.now());
    camera.getWorldDirection(camDir);
    const target = camera.position.clone().addScaledVector(camDir, 10);
    d.camera = [...camera.position.toArray(), ...target.toArray()].map((n) => Math.round(n * 100) / 100);
    const err = saveSlot.write(d, saveMeta(d));
    hud.saveMeta = saveSlot.readMeta();
    if (manual) hud.toast(err ? t('toast.saveFailed', { err }) : t('toast.saved', { stamp: tr(world.clock.stamp()) }));
    else if (err && !autosaveWarned) {
      autosaveWarned = true;
      hud.toast(t('toast.autosaveFailed', { err }));
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

  const action = (a: HudAction, v?: number) => {
    const c = world.clock;
    switch (a) {
      case 'pause':
        c.paused = !c.paused;
        break;
      case 'speed':
        c.speed = v ?? 1;
        c.paused = false;
        break;
      case 'xray':
        hud.state.xray = !hud.state.xray;
        if (!hud.state.xray && hud.state.forcedXray) hud.toast(t('toast.underground'));
        break;
      case 'pheromone':
        hud.state.pheromone = !hud.state.pheromone;
        if (hud.state.pheromone) world.pheromone.refreshTexture();
        break;
      case 'roleColors':
        hud.state.roleColors = !hud.state.roleColors;
        break;
      case 'grass':
        hud.state.grass = !hud.state.grass;
        break;
      case 'stats':
        hud.toggleStats();
        hud.refresh(selection, 60);
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
        hud.toggleHelp();
        break;
      case 'tool':
        tools.select(v ?? 0);
        hud.hideHelp();
        hud.setSheet(null);
        break;
      case 'toolopt':
        tools.setOption(v ?? 0);
        break;
      case 'toolexit':
        tools.exit();
        break;
      case 'toolPlace':
        if (tools.pending && applyTool(tools.pending)) tools.pending = null;
        break;
      case 'toolRotate':
        tools.rotate();
        break;
      case 'removePlaced': {
        const r = world.removePlacedById(v ?? -1);
        if (r.msg) hud.toast(tr(r.msg));
        if (r.ok) select(null);
        break;
      }
      case 'removePredator': {
        const r = world.removePredatorById(v ?? -1);
        if (r.msg) hud.toast(tr(r.msg));
        if (r.ok) select(null);
        break;
      }
      case 'savePanel':
        hud.toggleSave();
        hud.saveMeta = saveSlot.readMeta();
        break;
      case 'saveNow':
        save(true);
        break;
      case 'loadSave':
        if (saveSlot.readMeta()) reloadClean();
        break;
      case 'newGame':
        if (!confirm(t('toast.confirmNew'))) break;
        saveSlot.clear();
        reloadClean();
        break;
      case 'background':
        if (BACKGROUND_LIMITED) {
          hud.toast(t('toast.bgLimited'));
          break;
        }
        background.setEnabled(!background.enabled);
        hud.state.background = background.enabled;
        hud.toast(t(background.enabled ? 'toast.bgOn' : 'toast.bgOff'));
        break;
      case 'quality': {
        const mode = QUALITY_MODES[v ?? (QUALITY_MODES.indexOf(quality.mode) + 1) % QUALITY_MODES.length];
        quality.setMode(mode);
        hud.toast(t('toast.quality', { q: hud.qualityLabel() }));
        hud.refresh(selection, fps);
        break;
      }
      case 'install':
        if (installer.kind === 'ios') hud.toast(t('toast.installIos'));
        else void installer.install().then((ok) => ok && hud.toast(t('toast.installed')));
        break;
      case 'langMenu':
        hud.toggleLangMenu();
        break;
      case 'lang':
        hud.setLangMenu(false);
        if (!chooseLang(LANGS[v ?? 0] ?? 'zh')) break;
        document.title = t('app.title');
        hud.relocalize();
        hud.refresh(selection, fps);
        hud.toast(t('toast.lang'));
        break;
    }
    hud.renderTool();
    hud.renderSave();
    applyView();
  };
  hud.onAction = action;
  hud.onEvent = (e) => {
    const sel: Selection | undefined = e.ref;
    if (sel && selectionPos(sel)) {
      select(sel);
      flyToSelection();
    } else if (e.at) {
      select(null);
      controller.flyTo(new THREE.Vector3(...e.at), 14);
      if (sel) hud.toast(t('toast.eventGone'));
    }
    hud.refresh(selection, fps);
  };

  const applyTool = (p: THREE.Vector3 | null): boolean => {
    tools.hover(p);
    const r = tools.apply();
    if (r.msg) hud.toast(tr(r.msg));
    if (r.ok) {
      hud.refresh(selection, fps);
      if (hud.state.pheromone) world.pheromone.refreshTexture();
    }
    return r.ok;
  };
  const TOUCH_PICK_PX = 32;

  controller.onClick = (x, y, touch) => {
    // 手机布局里点画面先收起打开的抽屉，和地图应用一样
    if (hud.sheet) {
      hud.setSheet(null);
      return;
    }
    if (tools.active >= 0) {
      if (!touch) return void applyTool(picker.groundPoint(x, y, groundPt));
      tools.pending = picker.groundPoint(x, y)?.clone() ?? null;
      if (!tools.pending) hud.toast(t('tool.clickGround'));
      hud.renderTool();
      return;
    }
    select(picker.pick(x, y, xrayOn(), touch ? TOUCH_PICK_PX : undefined));
  };
  controller.onDoubleClick = (x, y, touch) => {
    if (tools.active >= 0) return;
    const s = picker.pick(x, y, xrayOn(), touch ? TOUCH_PICK_PX : undefined);
    if (s) {
      select(s);
      flyToSelection();
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
      e.preventDefault();
      return action('saveNow');
    }
    if (e.code in SPEED_KEYS) return action('speed', SPEED_KEYS[e.code]);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        return action('pause');
      case 'KeyX':
        return action('xray');
      case 'KeyP':
        return action('pheromone');
      case 'KeyC':
        return action('roleColors');
      case 'KeyG':
        return action('grass');
      case 'KeyT':
        return action('stats');
      case 'KeyF':
        return action('follow');
      case 'KeyH':
        return action('help');
      case 'Digit6':
        return action('tool', 0);
      case 'Digit7':
        return action('tool', 1);
      case 'Digit8':
        return action('tool', 2);
      case 'Digit9':
        return action('tool', 3);
      case 'KeyR':
        tools.rotate();
        return;
      case 'Escape':
        return action(tools.active >= 0 ? 'toolexit' : 'deselect');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    hud.updateMode();
    hud.refresh(selection, fps);
  });

  // 支持 ?select=ant:1 / chamber:4 / plant:0 直接选中对象，&follow=1 跟随；?hour=21 从指定时刻开始
  const hourParam = Number(params.get('hour'));
  if (params.has('hour') && hourParam >= 0 && hourParam < 24) {
    world.clock.seconds += (((hourParam - world.clock.hour + 24) % 24) / 24) * CONFIG.time.dayLength;
  }
  // ?rain=秒数 开局招来一场雨并快进这么多秒
  if (params.has('rain')) {
    world.callRain();
    const secs = Math.min(2000, Number(params.get('rain')) || 0);
    for (let t = 0; t < secs; t += chunk) world.advance(chunk);
  }
  const selParam = params.get('select')?.split(':');
  if (selParam?.length === 2) {
    const id = Number(selParam[1]);
    if (selParam[0] === 'ant' && world.colony.antById(id)) select({ kind: 'ant', id });
    if (selParam[0] === 'chamber' && world.nest.chambers[id]) select({ kind: 'chamber', id });
    if (selParam[0] === 'plant' && world.veg.plants[id]) select({ kind: 'plant', id });
    if (params.get('follow') === '1') toggleFollow();
    else if (params.get('fly') === '1') flyToSelection();
  }
  // ?view=xray,pheromone,stats,roles 开局打开对应的显示开关
  for (const v of params.get('view')?.split(',') ?? []) {
    if (v === 'xray') hud.state.xray = true;
    if (v === 'pheromone') hud.state.pheromone = true;
    if (v === 'roles') hud.state.roleColors = true;
    if (v === 'stats' && !hud.state.stats) hud.toggleStats();
  }
  if (hud.state.pheromone) world.pheromone.refreshTexture();

  applyView();
  document.getElementById('loading')?.remove();
  if (loadMsg) hud.toast(loadMsg);
  setTimeout(() => hud.hideHelp(), 25000);

  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let last = performance.now();
  let fps = 60;
  /** 每帧主线程耗时（ms，指数平均）：模拟推进、视图同步、提交渲染 */
  const perf = { sim: 0, views: 0, render: 0 };
  let hudTimer = 0;
  let pherTimer = 0;
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
  hud.state.background = background.enabled;
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const awayMin = (Date.now() - hiddenAt) / 60000;
    if (awayFrom >= 0 && world.clock.seconds - awayFrom > 30) hud.toast(t('toast.bgResumed', { from: world.clock.stampAt(awayFrom), to: world.clock.stamp() }));
    else if (BACKGROUND_LIMITED && !world.clock.paused && awayMin >= 1) hud.toast(t('toast.bgFrozen', { n: Math.round(awayMin) }));
    awayFrom = -1;
    hud.refresh(selection, fps);
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

    const cp = camera.position;
    const below = cp.y < world.terrain.heightAt(cp.x, cp.z) - 0.2;
    let followUnder = false;
    if (controller.mode === 'follow' && selection?.kind === 'ant') {
      followUnder = world.colony.antById(selection.id)?.domain === 'nest';
    }
    const forced = below || followUnder;
    if (forced !== hud.state.forcedXray) {
      hud.state.forcedXray = forced;
      applyView();
    }
    hud.state.following = controller.mode === 'follow';

    if (controller.mode === 'follow' && selection?.kind === 'ant') {
      const a = world.colony.antById(selection.id);
      if (a) focus.copy(a.pos);
    } else {
      camera.getWorldDirection(fwd);
      const h = Math.max(4, cp.y - space.surfaceAt(cp.x, cp.z));
      focus.copy(cp).addScaledVector(fwd, Math.min(60, h * 1.6));
      focus.y = space.surfaceAt(focus.x, focus.z);
    }

    if (tools.active >= 0) tools.hover(tools.pending ?? (mouse ? picker.groundPoint(mouse.x, mouse.y, groundPt) : null));
    world.veg.update(dt, world.weather.rain);
    world.aphids.sync();
    world.predators.sync(time);
    world.alarm.sync(hud.state.pheromone);
    nestView.sync();
    antView.update(time, camera.position);
    itemView.update();
    env.update(world.clock, camera, focus, xrayOn(), world.weather.cloud);
    rain.sync(dt, camera, focus, world.weather.rain, (x, z) => space.surfaceAt(x, z));
    terrainMat.color.setScalar(1 - 0.28 * world.weather.wetness);
    terrainMat.roughness = 0.97 - 0.3 * world.weather.wetness;

    pherTimer += dt;
    if (hud.state.pheromone && pherTimer > 0.4) {
      pherTimer = 0;
      world.pheromone.refreshTexture();
    }
    hud.tick(dt);
    autosave(dt);
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      hud.refresh(selection, fps, perf);
    }

    const t2 = performance.now();
    renderer.render(scene, camera);
    const t3 = performance.now();
    perf.sim += (t1 - t0 - perf.sim) * 0.05;
    perf.views += (t2 - t1 - perf.views) * 0.05;
    perf.render += (t3 - t2 - perf.render) * 0.05;
    requestAnimationFrame(frame);
  };
  hud.refresh(selection, fps);
  requestAnimationFrame(frame);

  Object.assign(window, { world, camera, controller, hud, quality, renderer });
}

boot();
