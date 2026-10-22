import { getLang, LANG_TAGS, LANGS, setLang, type Lang } from '../i18n';

const KEY = 'cyber-ant-lang';

function isLang(x: string | null): x is Lang {
  return LANGS.includes(x as Lang);
}

function applyLang(l: Lang): void {
  setLang(l);
  document.documentElement.lang = LANG_TAGS[l];
}

/** 语言的优先级：网址里的 ?lang=，玩家上次手动选的，浏览器的首选语言（中文以外都用英文） */
export function initLang(param: string | null): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    // 本地存储不可用时按浏览器语言
  }
  if (isLang(param)) applyLang(param);
  else if (isLang(stored)) applyLang(stored);
  else applyLang((navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
}

/** 切换到指定语言，并记住玩家的选择；返回语言是否有变化 */
export function chooseLang(l: Lang): boolean {
  if (l === getLang()) return false;
  applyLang(l);
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // 记不住也不影响本次切换
  }
  return true;
}
