/** 框架层的配置：主循环、后台运行、画质、自动保存。物种和玩法的数值放在各游戏自己的 config.ts */
export const ENGINE = {
  loop: {
    fixedStep: 1 / 30,
    maxStepsPerFrame: 24,
    /** 每帧模拟最多占用的主线程时间，超出就降低实际倍速以保住帧率 */
    frameBudgetMs: 10,
  },

  /** 页面隐藏时的后台运行 */
  background: {
    /** 后台节拍（ms） */
    tickMs: 100,
    /** 模拟最多占用的时间比例，以及单次节拍的耗时上限（ms） */
    cpuShare: 0.4,
    maxBudgetMs: 1000,
  },

  /** 画质与帧率 */
  render: {
    /** 画质档位，从高到低：像素比上限、阳光阴影贴图边长 */
    levels: [
      { pixelRatio: 2, shadowMap: 2048 },
      { pixelRatio: 1.5, shadowMap: 1024 },
      { pixelRatio: 1, shadowMap: 1024 },
    ],
    /** “自动”在手机和平板上从这一档开始 */
    mobileLevel: 1,
    /** 自动降档：连续 adaptWindows 个 adaptWindowSec 秒的平均帧率都低于 lowFps 就降一档 */
    lowFps: 40,
    adaptWindowSec: 3,
    adaptWindows: 2,
    /** 帧率上限；120 Hz 的屏幕也只画 60 帧 */
    maxFps: 60,
    saverFps: 30,
    /** 暂停后这么多秒没有操作，帧率降到 idleFps */
    idleAfterSec: 2,
    idleFps: 15,
  },

  save: {
    /** 自动保存间隔（现实秒数） */
    autosaveSec: 60,
  },
};
