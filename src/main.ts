import './style.css';
import * as THREE from 'three';
import { CONFIG } from './config';
import { World } from './world/world';
import { NestView } from './nest/nestView';
import { AntView } from './render/antView';
import { ItemView } from './render/itemView';
import { Environment } from './render/environment';
import { CameraController } from './ui/camera';
import { Picker, type Selection } from './ui/picking';
import { Hud, type HudAction } from './ui/hud';

const SPEED_KEYS: Record<string, number> = { Digit1: 1, Digit2: 2, Digit3: 5, Digit4: 10, Digit5: 20 };

async function boot(): Promise<void> {
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('app')!.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 2500);

  const world = new World();
  const params = new URLSearchParams(location.search);
  // ?skip=秒数：开局先在后台快进模拟，便于直接观察扩建等慢过程
  const skip = Math.min(20000, Number(params.get('skip')) || 0);
  for (let t = 0; t < skip; t += CONFIG.time.fixedStep * CONFIG.time.maxStepsPerFrame) world.advance(CONFIG.time.fixedStep * CONFIG.time.maxStepsPerFrame);
  scene.add(world.terrain.mesh, world.veg.group, world.food.group, world.aphids.group);

  const nestView = new NestView(world.nest, world.terrain);
  nestView.build();
  scene.add(nestView.group, nestView.surfaceGroup);

  scene.add(world.pheromone.buildOverlay());

  const antView = new AntView(world);
  scene.add(antView.workers, antView.queens, antView.marker);
  const itemView = new ItemView(world);
  scene.add(itemView.group);
  const env = new Environment(scene);

  const controller = new CameraController(camera, renderer.domElement, (x, z) => world.terrain.heightAt(x, z));
  controller.setPose(new THREE.Vector3(16, 13, 22), new THREE.Vector3(0, 0, 1));
  // 支持 ?cam=x,y,z,tx,ty,tz 指定初始视角，便于分享观察位置
  const camParam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
  if (camParam?.length === 6 && camParam.every(Number.isFinite)) {
    controller.setPose(new THREE.Vector3(camParam[0], camParam[1], camParam[2]), new THREE.Vector3(camParam[3], camParam[4], camParam[5]));
  }

  const picker = new Picker(world, camera, renderer.domElement, antView, {
    chambers: nestView.chamberMeshes,
    surface: [world.food.group, nestView.surfaceGroup, ...world.veg.group.children.filter((o) => o.userData.pick)],
    terrain: world.terrain.mesh,
  });
  const hud = new Hud(world);

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
      default:
        return null;
    }
  };

  const select = (sel: Selection | null) => {
    selection = sel;
    antView.selectedId = sel?.kind === 'ant' ? sel.id : -1;
    nestView.highlightChamber(sel?.kind === 'chamber' ? sel.id : null);
    if (controller.mode === 'follow' && sel?.kind !== 'ant') controller.stopFollow();
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
      hud.toast('先单击选中一只蚂蚁');
      return;
    }
    const id = selection.id;
    controller.follow(() => world.colony.antById(id)?.pos ?? null);
    hud.toast('跟随中：左键拖拽环绕，滚轮缩放，WASD 退出');
  };

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
        if (!hud.state.xray && hud.state.forcedXray) hud.toast('相机位于地下，保持透视');
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
      case 'stats': {
        hud.state.stats = !hud.state.stats;
        hud.invalidateStats();
        const help = document.getElementById('help')!;
        if (hud.state.stats && !help.classList.contains('hidden')) hud.toggleHelp();
        hud.refresh(selection, 60);
        break;
      }
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
    }
    applyView();
  };
  hud.onAction = action;

  controller.onClick = (x, y) => select(picker.pick(x, y, xrayOn()));
  controller.onDoubleClick = (x, y) => {
    const s = picker.pick(x, y, xrayOn());
    if (s) {
      select(s);
      flyToSelection();
    }
  };

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
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
      case 'Escape':
        return action('deselect');
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 支持 ?select=ant:1 / chamber:4 / plant:0 直接选中对象，&follow=1 跟随；?hour=21 从指定时刻开始
  const hourParam = Number(params.get('hour'));
  if (params.has('hour') && hourParam >= 0 && hourParam < 24) {
    world.clock.seconds += (((hourParam - world.clock.hour + 24) % 24) / 24) * CONFIG.time.dayLength;
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
    if (v === 'stats') hud.state.stats = true;
  }
  if (hud.state.pheromone) world.pheromone.refreshTexture();

  applyView();
  document.getElementById('loading')?.remove();
  setTimeout(() => {
    const help = document.getElementById('help')!;
    if (!help.classList.contains('hidden')) hud.toggleHelp();
  }, 25000);

  const focus = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let last = performance.now();
  let fps = 60;
  let hudTimer = 0;
  let pherTimer = 0;
  let time = 0;

  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

    world.advance(dt);
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
      const h = Math.max(4, cp.y - world.terrain.heightAt(cp.x, cp.z));
      focus.copy(cp).addScaledVector(fwd, Math.min(60, h * 1.6));
      focus.y = world.terrain.heightAt(focus.x, focus.z);
    }

    world.veg.update(time);
    world.aphids.sync();
    nestView.sync();
    antView.update(time);
    itemView.update();
    env.update(world.clock, camera, focus, xrayOn());

    pherTimer += dt;
    if (hud.state.pheromone && pherTimer > 0.4) {
      pherTimer = 0;
      world.pheromone.refreshTexture();
    }
    hud.tick(dt);
    hudTimer += dt;
    if (hudTimer > 0.25) {
      hudTimer = 0;
      hud.refresh(selection, fps);
    }

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  hud.refresh(selection, fps);
  requestAnimationFrame(frame);

  (window as unknown as { world: World }).world = world;
}

boot();
