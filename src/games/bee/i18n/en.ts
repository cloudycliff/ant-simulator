import type { Entry } from '../../../core/i18n';
import type { zh } from './zh';

export const en: Record<keyof typeof zh, Entry> = {
  'app.title': 'Cyber Beekeeping',
  'app.subtitle': 'Asian honey bee Apis cerana · in development',
  'app.loading': 'Laying out the garden and the observation hive…',

  'ui.status': 'Summer',
  'ui.statusNight': 'Summer night',
  'ui.glass': 'Glass',
  'dock.colony': 'Colony',

  'colony.title': 'Colony',
  'colony.fold': 'Click to fold',
  'colony.unfold': 'Click to unfold',
  'colony.todo': 'Still under construction: comb, bees and flowers are coming next.',
  'colony.season': 'Season',
  'colony.summer': 'summer',

  'info.hint': 'Click the observation hive for details',
  'info.hive': 'Observation hive',
  'info.hiveDesc': 'A hive with glass on both sides and two frames of comb stacked one above the other. The clear tube on the left is the entrance. Get close to the glass to see every cell.',
  'info.size': 'Comb',
  'info.sizeValue': 'two frames, {w} × {h} cm each',

  'help.click': 'Left click: select · double-click: fly to it',
  'help.touchTap': 'Tap: select · double-tap: fly to it',
  'help.views': '<kbd>1</kbd>–<kbd>5</kbd> speed · <kbd>G</kbd> glass · <kbd>M</kbd> music · <kbd>Esc</kbd> deselect · <kbd>Space</kbd> pause/resume',

  'save.what': 'no bees yet',
  'save.incompatible': 'This save is from an incompatible older version',
  'save.seedMismatch': 'The world number does not match the save',
};
