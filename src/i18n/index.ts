import { zh } from './zh';
import { en } from './en';

export type Lang = 'zh' | 'en';
export const LANGS: Lang[] = ['zh', 'en'];
export const LANG_TAGS: Record<Lang, string> = { zh: 'zh-CN', en: 'en' };
/** 语言菜单里用各自语言的写法，看不懂当前界面的人也能找到自己的语言 */
export const LANG_NAMES: Record<Lang, string> = { zh: '中文', en: 'English' };

export type MsgKey = keyof typeof zh;
export type Param = string | number | Text;

/**
 * 延迟翻译的文本：模拟层只记录键和参数，界面显示时才按当前语言翻译，
 * 所以切换语言后，已经产生的事件、日志和蚂蚁的当前行为也跟着变。参数里可以再嵌套 Text
 */
export interface Text {
  readonly k: MsgKey;
  readonly p?: Readonly<Record<string, Param>>;
}

/** 字符串里的 {name} 换成参数；需要按数量变形（英文单复数）时写成函数 */
export type Entry = string | ((p: Record<string, string | number>) => string);

const DICTS: Record<Lang, Record<MsgKey, Entry>> = { zh, en };
let current: Lang = 'zh';

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
}

export function L(k: MsgKey, p?: Record<string, Param>): Text {
  return p ? { k, p } : { k };
}

export function t(k: MsgKey, p?: Readonly<Record<string, Param>>): string {
  const e = DICTS[current][k] ?? zh[k] ?? k;
  let r: Record<string, string | number> | undefined;
  if (p) {
    r = {};
    for (const name in p) {
      const v = p[name];
      r[name] = typeof v === 'object' ? tr(v) : v;
    }
  }
  if (typeof e === 'function') return e(r ?? {});
  if (!r) return e;
  const vals = r;
  return e.replace(/\{(\w+)\}/g, (m, name: string) => (name in vals ? String(vals[name]) : m));
}

export function tr(x: Text): string {
  return t(x.k, x.p);
}

/** 旧存档里已经拼好的文字，原样显示 */
export function asText(x: Text | string): Text {
  return typeof x === 'string' ? L('raw', { s: x }) : x;
}
