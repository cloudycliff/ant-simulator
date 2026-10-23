import { CONFIG } from '../config';
import { L } from '../../../core/i18n';
import { ToolController, type ToolDef, type ToolRunner } from '../../../core/ui/tools';
import { PLACEABLE_FOOD, SOURCE_INFO } from '../world/food';
import { PREDATOR_INFO, type PredatorKind } from '../world/predators';
import { OBSTACLE_INFO, type PlaceableObstacle } from '../world/vegetation';
import type { World } from '../world/world';

export type ToolKind = 'food' | 'obstacle' | 'water' | 'predator';

const OBSTACLES: (PlaceableObstacle | 'remove')[] = ['pebble', 'rock', 'twig', 'remove'];
const PREDATORS: (PredatorKind | 'ladybug' | 'remove')[] = ['spider', 'antlion', 'ladybug', 'remove'];

export const TOOLS: ToolDef<ToolKind>[] = [
  {
    kind: 'food',
    name: L('tool.food'),
    key: '6',
    hint: L('tool.foodHint'),
    options: PLACEABLE_FOOD.map((t) => ({ label: SOURCE_INFO[t].name, radius: SOURCE_INFO[t].radius })),
  },
  {
    kind: 'obstacle',
    name: L('tool.obstacle'),
    key: '7',
    hint: L('tool.obstacleHint'),
    options: OBSTACLES.map((k) =>
      k === 'remove' ? { label: L('tool.remove'), radius: 2.5 } : { label: OBSTACLE_INFO[k].name, radius: OBSTACLE_INFO[k].r, len: OBSTACLE_INFO[k].len },
    ),
  },
  {
    kind: 'water',
    name: L('tool.water'),
    key: '8',
    hint: L('tool.waterHint'),
    options: [...CONFIG.intervention.waterRadius.map((r, i) => ({ label: L(i === 0 ? 'tool.waterSmall' : 'tool.waterBig'), radius: r })), { label: L('tool.rain'), radius: 5 }],
  },
  {
    kind: 'predator',
    name: L('tool.predator'),
    key: '9',
    hint: L('tool.predatorHint'),
    options: PREDATORS.map((k) =>
      k === 'remove'
        ? { label: L('tool.dismiss'), radius: CONFIG.predators.pitRadius + 1 }
        : k === 'ladybug'
          ? { label: L('ladybug.name'), radius: 1.2 }
          : { label: PREDATOR_INFO[k].name, radius: k === 'spider' ? 1.5 : CONFIG.predators.pitRadius },
    ),
  },
];

/** 实际改动全部通过 World 的干预方法完成 */
export function createTools(w: World): ToolController<ToolKind> {
  const run: ToolRunner<ToolKind>['run'] = (d, i, p, yaw, dry) => {
    if (d.kind === 'food') return w.dropFood(PLACEABLE_FOOD[i], p.x, p.z, dry);
    if (d.kind === 'water') return i === 2 ? w.callRain(dry) : w.pourWater(p.x, p.z, i === 1, dry);
    if (d.kind === 'predator') {
      const k = PREDATORS[i];
      if (k === 'ladybug') return w.placeLadybug(p.x, p.z, dry);
      return k === 'remove' ? w.removePredator(p.x, p.z, dry) : w.placePredator(k, p.x, p.z, dry);
    }
    const k = OBSTACLES[i];
    return k === 'remove' ? w.removeObstacle(p.x, p.z, dry) : w.placeObstacle(k, p.x, p.z, yaw, dry);
  };
  return new ToolController(TOOLS, { run });
}
