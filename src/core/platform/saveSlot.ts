import { L, type Text } from '../i18n';

/** 存档摘要。seconds 是保存时的模拟秒数；较早的摘要里只有拼好的中文时刻 stamp。游戏可以加自己的字段 */
export interface SaveMeta {
  savedAt: number;
  seconds?: number;
  stamp?: string;
}

/** 浏览器本地存储里的一个存档位：完整存档 + 一份很小的摘要，存档面板显示时不必解析整个存档 */
export class SaveSlot<D, M extends SaveMeta = SaveMeta> {
  private readonly metaKey: string;

  constructor(private readonly key: string) {
    this.metaKey = `${key}-meta`;
  }

  /** 失败时返回原因 */
  write(d: D, meta: M): Text | null {
    try {
      localStorage.setItem(this.key, JSON.stringify(d));
      localStorage.setItem(this.metaKey, JSON.stringify(meta));
      return null;
    } catch (e) {
      return L(e instanceof DOMException && e.name === 'QuotaExceededError' ? 'save.quota' : 'save.denied');
    }
  }

  read(): D | null {
    try {
      const s = localStorage.getItem(this.key);
      return s ? (JSON.parse(s) as D) : null;
    } catch {
      return null;
    }
  }

  readMeta(): M | null {
    try {
      const s = localStorage.getItem(this.metaKey);
      return s ? (JSON.parse(s) as M) : null;
    } catch {
      return null;
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
      localStorage.removeItem(this.metaKey);
    } catch {
      // 本地存储不可用时没有可清除的内容
    }
  }
}
