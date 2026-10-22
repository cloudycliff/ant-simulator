import type { CoreKey, Entry, Lang } from '../../../core/i18n';

/** 框架文字里换成鱼缸说法的几条 */
export const overrides: Record<Lang, Partial<Record<CoreKey, Entry>>> = {
  zh: {
    'toast.selectFollowable': '先选中一条鱼',
    'tool.clickGround': '请点在鱼缸里',
    'help.touchTools': '工具：点鱼缸里选好位置，再点“放在这里”',
  },
  en: {
    'toast.selectFollowable': 'Select a fish first',
    'tool.clickGround': 'Pick a spot inside the tank',
    'help.touchTools': 'Tools: tap inside the tank to choose a spot, then tap “Place here”',
  },
};
