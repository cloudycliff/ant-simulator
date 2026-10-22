import { getLang, LANG_TAGS, LANGS, setLang, t, type Lang } from '../i18n';

const KEY = 'cyber-ant-lang';

function isLang(x: string | null): x is Lang {
  return LANGS.includes(x as Lang);
}

function applyLang(l: Lang): void {
  setLang(l);
  document.documentElement.lang = LANG_TAGS[l];
  document.title = t('app.title');
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

/** 在中英文之间切换，并记住玩家的选择 */
export function toggleLang(): void {
  const l: Lang = getLang() === 'zh' ? 'en' : 'zh';
  applyLang(l);
  try {
    localStorage.setItem(KEY, l);
  } catch {
    // 记不住也不影响本次切换
  }
}
