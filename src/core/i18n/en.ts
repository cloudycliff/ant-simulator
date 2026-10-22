import type { Entry } from '.';
import type { coreZh } from './zh';

export const coreEn: Record<keyof typeof coreZh, Entry> = {
  raw: '{s}',
  'time.stamp': 'Day {day} {time}',
  'save.quota': 'Browser storage is full',
  'save.denied': 'The browser blocked local storage',
};
