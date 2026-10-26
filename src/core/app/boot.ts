import * as THREE from 'three';
import { ENGINE } from '../config';
import { t, tr } from '../i18n';
import type { SaveMeta } from '../platform/saveSlot';
import type { EntityRef } from '../sim/entities';
import type { Simulation } from '../sim/simulation';
import type { GameModule, GameSave } from './game';

export function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = ENGINE.render.exposure;
  document.getElementById('app')!.appendChild(renderer.domElement);
  return renderer;
}

export interface OpenedWorld<W> {
  world: W;
  seed: number;
  /** 读档的结果（读到了、读失败、存档不能用），新开局时为空 */
  message: string;
  /** 存档时的相机位置和注视点 */
  camera?: number[];
}

/**
 * 有存档时接着上次继续，否则新开局。?new=1 忽略存档（之后的自动保存会覆盖它）；新开局每次随机生成地图，
 * ?seed=数字 指定地图，便于复现和截图；?skip=秒数 开局先在后台快进，便于直接观察扩建等慢过程
 */
export function openWorld<W extends Simulation<R>, R extends EntityRef, D extends GameSave, M extends SaveMeta>(
  game: GameModule<W, R, D, M>,
  params: URLSearchParams,
): OpenedWorld<W> {
  const forceNew = game.configure?.(params) ?? false;
  const seedParam = Number(params.get('seed'));
  const newSeed = seedParam > 0 ? seedParam >>> 0 : (Math.random() * 2 ** 31) >>> 0;
  const S = game.save;
  const saved = params.get('new') === '1' || forceNew ? null : S.slot.read();
  const problem = saved ? S.problem(saved) : null;
  let out: OpenedWorld<W>;
  if (saved && !problem) {
    try {
      const world = game.create(saved.seed, saved);
      S.read(world, saved);
      out = { world, seed: saved.seed, message: t('toast.loaded', { stamp: tr(world.clock.stamp()) }), camera: saved.camera };
    } catch (e) {
      console.error(e);
      out = { world: game.create(newSeed), seed: newSeed, message: t('toast.loadFailed') };
    }
  } else out = { world: game.create(newSeed), seed: newSeed, message: problem ? t('toast.problem', { problem }) : '' };

  const skip = Math.min(20000, Number(params.get('skip')) || 0);
  const chunk = ENGINE.loop.fixedStep * ENGINE.loop.maxStepsPerFrame;
  for (let s = 0; s < skip; s += chunk) out.world.advance(chunk);
  return out;
}
