import { L, type Text } from '../i18n';
import type { SaveData } from '../../games/ant/world/save';

const KEY = 'cyber-ant-save';
/** 单独存一份很小的摘要，存档面板显示时不必解析整个存档 */
const META_KEY = 'cyber-ant-save-meta';

/** seconds 是保存时的模拟秒数；较早的摘要里只有拼好的中文时刻 stamp */
export interface SaveMeta {
  savedAt: number;
  seconds?: number;
  stamp?: string;
  ants: number;
}

/** 写入浏览器本地存储；失败时返回原因 */
export function writeSave(d: SaveData): Text | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    const meta: SaveMeta = { savedAt: d.savedAt, seconds: Math.round(d.clock.seconds), ants: d.colony.ants.length };
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return null;
  } catch (e) {
    return L(e instanceof DOMException && e.name === 'QuotaExceededError' ? 'save.quota' : 'save.denied');
  }
}

export function readSave(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as SaveData) : null;
  } catch {
    return null;
  }
}

export function readMeta(): SaveMeta | null {
  try {
    const s = localStorage.getItem(META_KEY);
    return s ? (JSON.parse(s) as SaveMeta) : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(META_KEY);
  } catch {
    // 本地存储不可用时没有可清除的内容
  }
}
