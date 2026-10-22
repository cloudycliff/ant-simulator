/** 手机和平板的浏览器。iPadOS 的 Safari 自称 Mac，用多点触控补上 */
export const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
