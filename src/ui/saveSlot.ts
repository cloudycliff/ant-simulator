import type { SaveData } from '../world/save';

const KEY = 'cyber-ant-save';
/** 单独存一份很小的摘要，存档面板显示时不必解析整个存档 */
const META_KEY = 'cyber-ant-save-meta';

export interface SaveMeta {
  savedAt: number;
  stamp: string;
  ants: number;
}

/** 写入浏览器本地存储；失败时返回原因 */
export function writeSave(d: SaveData): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    const meta: SaveMeta = { savedAt: d.savedAt, stamp: d.stamp, ants: d.colony.ants.length };
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return null;
  } catch (e) {
    return e instanceof DOMException && e.name === 'QuotaExceededError' ? '浏览器存储空间不足' : '浏览器禁止了本地存储';
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
