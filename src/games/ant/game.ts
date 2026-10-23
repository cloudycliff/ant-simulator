import type * as THREE from 'three';
import { CONFIG, setInitialWorkers } from './config';
import { ENGINE } from '../../core/config';
import { t, tr } from '../../core/i18n';
import type { GameContext, GameModule, GameSession, ViewToggle } from '../../core/app/game';
import type { ToolResult } from '../../core/ui/tools';
import { Environment } from '../../core/render/environment';
import { RainView } from '../../core/render/rain';
import { NestView } from './nest/nestView';
import { AntView } from './render/antView';
import { ItemView } from './render/itemView';
import { createSpace } from './space';
import { ICON, antUi } from './ui/panels';
import { Picker } from './ui/picking';
import { createTools } from './ui/tools';
import type { GameRef } from './world/entities';
import { loadWorld, saveMeta, saveProblem, saveSlot, saveWorld, type AntSaveMeta, type SaveData } from './world/save';
import { World } from './world/world';

export const antGame: GameModule<World, GameRef, SaveData, AntSaveMeta> = {
  title: () => t('app.title'),
  subtitle: () => t('app.subtitle'),
  loading: () => t('app.loading'),
  repoUrl: 'https://github.com/cloudycliff/ant-simulator',
  installable: true,
  camera: { fov: 55, near: 0.05, far: 2500, pose: [16, 13, 22, 0, 0, 1] },
  // ?ants=工蚁数：新开局时的初始工蚁数（性能测试用），这时不读存档
  configure(params) {
    const n = Number(params.get('ants'));
    if (!(n > 0)) return false;
    setInitialWorkers(Math.min(5000, n));
    return true;
  },
  create: (seed, saved) => {
    if (saved?.workers) setInitialWorkers(saved.workers);
    return new World(seed);
  },
  save: {
    slot: saveSlot,
    write: saveWorld,
    read: loadWorld,
    problem: saveProblem,
    meta: saveMeta,
    describe: (m) => t('save.what', { n: m.ants }),
  },
  space: createSpace,
  mount,
};

function mount(ctx: GameContext<World, GameRef>): GameSession<GameRef> {
  const { world, scene, camera } = ctx;
  scene.add(world.terrain.mesh, world.veg.group, world.food.group, world.aphids.group, world.ladybugs.group, world.water.group, world.predators.group, world.alarm.group);

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

  const picker = new Picker(world, camera, ctx.dom, antView, {
    chambers: nestView.chamberMeshes,
    surface: [world.food.group, nestView.surfaceGroup, world.veg.placedGroup, world.water.group, world.predators.group, world.ladybugs.group, ...world.veg.group.children.filter((o) => o.userData.pick)],
    terrain: world.terrain.mesh,
  });
  const tools = createTools(world);

  const view = { xray: false, forcedXray: false, pheromone: false, roleColors: false, grass: true };
  const xrayOn = () => view.xray || view.forcedXray;
  let xrayApplied: boolean | null = null;
  const syncViews = () => {
    const on = xrayOn();
    if (on !== xrayApplied) {
      xrayApplied = on;
      world.terrain.setXray(on);
      nestView.setXray(on);
      antView.xray = on;
      itemView.xray = on;
    }
    world.veg.setGrassVisible(view.grass && !on);
    world.veg.setLeavesVisible(!on);
    world.pheromone.overlay.visible = view.pheromone;
    antView.roleColors = view.roleColors;
  };

  const views: ViewToggle[] = [
    {
      id: 'xray',
      label: () => t('ui.xray'),
      key: 'X',
      dock: { icon: ICON.xray, label: () => t('dock.xray') },
      on: xrayOn,
      toggle: () => {
        view.xray = !view.xray;
        if (!view.xray && view.forcedXray) ctx.toast(t('toast.underground'));
      },
    },
    {
      id: 'pheromone',
      label: () => t('ui.pheromone'),
      key: 'P',
      on: () => view.pheromone,
      toggle: () => {
        view.pheromone = !view.pheromone;
        if (view.pheromone) world.pheromone.refreshTexture();
      },
    },
    { id: 'roleColors', label: () => t('ui.roleColors'), key: 'C', param: 'roles', on: () => view.roleColors, toggle: () => (view.roleColors = !view.roleColors) },
    { id: 'grass', label: () => t('ui.grass'), key: 'G', on: () => view.grass, toggle: () => (view.grass = !view.grass) },
  ];

  const removed = (r: ToolResult) => {
    if (r.msg) ctx.toast(tr(r.msg));
    if (r.ok) ctx.select(null);
  };

  let pherTimer = 0;
  return {
    shadowLight: env.sun,
    views,
    tools,
    pick: (x, y, tolerance) => picker.pick(x, y, xrayOn(), tolerance),
    onSelect: (sel) => {
      antView.selectedId = sel?.kind === 'ant' ? sel.id : -1;
      nestView.highlightChamber(sel?.kind === 'chamber' ? sel.id : null);
    },
    onToolApplied: () => {
      if (view.pheromone) world.pheromone.refreshTexture();
    },
    action: (a, v) => {
      if (a === 'removePlaced') removed(world.removePlacedById(v ?? -1));
      else if (a === 'removePredator') removed(world.removePredatorById(v ?? -1));
      else return false;
      return true;
    },
    // ?rain=秒数 开局招来一场雨并快进这么多秒
    applyParams: (params) => {
      if (!params.has('rain')) return;
      world.callRain();
      const secs = Math.min(2000, Number(params.get('rain')) || 0);
      const chunk = ENGINE.loop.fixedStep * ENGINE.loop.maxStepsPerFrame;
      for (let s = 0; s < secs; s += chunk) world.advance(chunk);
    },
    syncViews,
    update: (dt, f) => {
      const cp = camera.position;
      // 相机在地下，或跟随的蚂蚁在巢里时强制透视
      const below = cp.y < world.terrain.heightAt(cp.x, cp.z) - 0.2;
      const followUnder = f.following && f.selection?.kind === 'ant' && world.colony.antById(f.selection.id)?.domain === 'nest';
      const forced = below || followUnder;
      if (forced !== view.forcedXray) {
        view.forcedXray = forced;
        syncViews();
      }
      world.veg.update(dt, world.weather.rain);
      world.aphids.sync();
      world.predators.sync(f.time);
      world.ladybugs.sync(f.time);
      world.alarm.sync(view.pheromone);
      nestView.sync();
      antView.update(f.time, camera.position);
      itemView.update();
      env.update(world.clock, camera, f.focus, xrayOn(), world.weather.cloud);
      rain.sync(dt, camera, f.focus, world.weather.rain, (x, z) => ctx.space.surfaceAt(x, z));
      terrainMat.color.setScalar(1 - 0.28 * world.weather.wetness);
      terrainMat.roughness = 0.97 - 0.3 * world.weather.wetness;
      pherTimer += dt;
      if (view.pheromone && pherTimer > 0.4) {
        pherTimer = 0;
        world.pheromone.refreshTexture();
      }
    },
    ui: antUi(world, { following: ctx.following, pheromone: () => view.pheromone }),
  };
}
