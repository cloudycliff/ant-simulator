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
    /** 色调映射的曝光；玩家的亮度设置是乘在它上面的倍数 */
    exposure: 1.05,
    /** 亮度滑块的范围和步长（倍数，1 是默认） */
    brightness: { min: 0.5, max: 2.5, step: 0.05 },
  },

  save: {
    /** 自动保存间隔（现实秒数） */
    autosaveSec: 60,
  },

  /** 程序生成的背景音乐 */
  music: {
    /** 没有记住过开关时是否开着；浏览器不让自动出声，第一次点击或按键后才开始 */
    defaultOn: true,
    volume: 0.5,
    bpm: 66,
    /** 主音的 MIDI 音高，每次开始播放时随机选一个调 */
    keys: [55, 57, 60, 62],
    /** 旋律的音域：相对主音的半音数 */
    melodyRange: [7, 26] as [number, number],
    /** 每段（四个和弦）随机选一档旋律疏密：每个八分音符位置出音的概率，0 是这一段只有和弦 */
    density: [0, 0.22, 0.35, 0.5],
    /** 混响尾音长度、开关时的淡入淡出（秒） */
    reverbSec: 3.2,
    fadeSec: 1.5,
  },
};
