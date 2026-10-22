import type { CoreKey, Entry, Lang } from '../../../core/i18n';

/** 框架文字里换成蚂蚁游戏说法的几条 */
export const overrides: Record<Lang, Partial<Record<CoreKey, Entry>>> = {
  zh: {
    'toast.loadFailed': '存档无法读取，已开始新的蚁群',
    'toast.problem': '{problem}，已开始新的蚁群',
    'toast.selectFollowable': '先选中一只蚂蚁',
    'toast.confirmNew': '重新开始会删除当前存档，用一个新的蚁群从头开始。确定吗？',
    'toast.bgOn': '后台运行已开启：离开页面后蚁群继续生活',
    'toast.bgResumed': '你不在的时候，蚁群从 {from} 生活到了 {to}',
    'toast.bgLimited': '手机和平板的浏览器切到后台会冻结页面，离开时蚁群会暂停，回来后接着生活；想让它一直过日子，就让页面停在前台',
    'toast.bgFrozen': '页面在后台被浏览器冻结了约 {n} 分钟，这段时间蚁群暂停了',
    'ui.backgroundTitle': '开启时，最小化浏览器或切到其他标签页后蚁群继续生活；关闭时离开页面就暂停',
    'ui.backgroundLimitedTitle': '手机和平板的浏览器切到后台会冻结页面，离开时蚁群会暂停',
  },
  en: {
    'toast.loadFailed': "Couldn't read the save; started a new colony",
    'toast.problem': '{problem}; started a new colony',
    'toast.selectFollowable': 'Select an ant first',
    'toast.confirmNew': 'Starting over deletes the current save and begins a new colony from scratch. Continue?',
    'toast.bgOn': 'Background running on: the colony keeps living when you leave the page',
    'toast.bgResumed': 'While you were away the colony lived on from {from} to {to}',
    'toast.bgLimited': 'Phone and tablet browsers freeze pages in the background, so the colony pauses while you are away and carries on when you return. Keep the page open to let it live',
    'toast.bgFrozen': 'The browser froze the page for about {n} min; the colony was paused meanwhile',
    'ui.backgroundTitle': 'When on, the colony keeps living while the browser is minimized or another tab is open; when off, the game pauses as you leave the page',
    'ui.backgroundLimitedTitle': 'Phone and tablet browsers freeze pages in the background, so the colony pauses while you are away',
  },
};
