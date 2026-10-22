import { t } from '../i18n';

export interface Series {
  label: string;
  color: string;
  values: number[];
  dash?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** 简单折线图：横轴为游戏日，纵轴自动取整 */
export function drawChart(cv: HTMLCanvasElement, title: string, days: number[], series: Series[]): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) {
    cv.width = W * dpr;
    cv.height = H * dpr;
  }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const X0 = 38;
  const R = 8;
  const T = 30;
  const B = 18;
  g.font = '11px "Microsoft YaHei", sans-serif';
  g.fillStyle = '#c9a06a';
  g.fillText(title, 2, 12);
  let lx = 2;
  for (const s of series) {
    g.fillStyle = s.color;
    g.fillRect(lx, 18, 10, 3);
    g.fillStyle = '#b8ae9c';
    g.fillText(s.label, lx + 13, 23);
    lx += 18 + g.measureText(s.label).width + 8;
  }
  if (days.length < 2) {
    g.fillStyle = '#8f877a';
    g.fillText(t('chart.wait'), X0 + 10, T + 30);
    return;
  }
  let max = 0;
  for (const s of series) for (const v of s.values) max = Math.max(max, v);
  const ymax = niceMax(max * 1.05);
  const d0 = days[0];
  const d1 = days[days.length - 1];
  const px = (d: number) => X0 + ((d - d0) / Math.max(1e-6, d1 - d0)) * (W - X0 - R);
  const py = (v: number) => H - B - (v / ymax) * (H - T - B);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.fillStyle = '#8f877a';
  g.lineWidth = 1;
  g.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const v = (ymax * i) / 4;
    const y = Math.round(py(v)) + 0.5;
    g.beginPath();
    g.moveTo(X0, y);
    g.lineTo(W - R, y);
    g.stroke();
    g.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), X0 - 4, y + 4);
  }
  g.textAlign = 'center';
  const span = d1 - d0;
  const stepD = span > 12 ? 4 : span > 5 ? 2 : span > 1.5 ? 1 : 0.25;
  for (let d = Math.ceil(d0 / stepD) * stepD; d <= d1; d += stepD) {
    const label = stepD < 1 ? t('chart.hour', { h: Math.round((d % 1) * 24) }) : t('chart.day', { d: Math.floor(d) + 1 });
    g.fillText(label, px(d), H - 4);
  }
  g.textAlign = 'left';
  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 1.6;
    g.setLineDash(s.dash ? [4, 3] : []);
    g.beginPath();
    s.values.forEach((v, i) => {
      const x = px(days[i]);
      const y = py(v);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  g.setLineDash([]);
}
