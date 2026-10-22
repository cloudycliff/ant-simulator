/** iPhone、iPad 上的浏览器。iPadOS 的 Safari 自称 Mac，用多点触控补上 */
export const IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 手机和平板的浏览器 */
export const MOBILE = IOS || /Android/i.test(navigator.userAgent);
