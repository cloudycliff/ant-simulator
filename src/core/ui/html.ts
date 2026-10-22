import { t, tr } from '../i18n';
import type { SimClock } from '../sim/clock';

/** 面板里的进度条，v 取 0–1 */
export function bar(v: number, color: string): string {
  const p = Math.round(Math.max(0, Math.min(1, v)) * 100);
  return `<span class="bar"><i style="width:${p}%;background:${color}"></i></span>`;
}

export function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

/** 英文词典里的名词是小写的，放在标题、行首时大写首字母 */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

/** 事件和日志的时刻：新记录是模拟秒数，旧存档里是拼好的中文 */
export function when(clock: SimClock, x: number | string): string {
  return typeof x === 'number' ? tr(clock.stampAt(x)) : x;
}

export function agoText(ms: number): string {
  const s = Math.max(0, ms / 1000);
  if (s < 10) return t('ago.now');
  if (s < 60) return t('ago.sec', { n: Math.floor(s / 10) * 10 });
  if (s < 3600) return t('ago.min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('ago.hour', { n: Math.floor(s / 3600) });
  return t('ago.day', { n: Math.floor(s / 86400) });
}

export const isTouch = () => matchMedia('(pointer: coarse)').matches;
