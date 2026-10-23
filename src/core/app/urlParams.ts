import type { EntityRef } from '../sim/entities';
import type { App } from './app';

/** ?cam=x,y,z,tx,ty,tz 指定开局视角，便于分享观察位置；否则用存档时的视角 */
export function startPose(params: URLSearchParams, saved?: number[]): number[] | null {
  const p = params.get('cam')?.split(',').map(Number) ?? saved;
  return p?.length === 6 && p.every(Number.isFinite) ? p : null;
}

/**
 * 界面建好之后才能处理的网址参数：?hour= 开局时刻；游戏自己的参数（applyParams）；
 * ?select=类型:编号（&follow=1 跟随，&fly=1 飞过去）；?view= 打开的显示开关
 */
export function applyUrlParams<R extends EntityRef>(app: App<R>, params: URLSearchParams): void {
  const { world, shell } = app;
  const clock = world.clock;
  const hour = Number(params.get('hour'));
  if (params.has('hour') && hour >= 0 && hour < 24) clock.seconds += (((hour - clock.hour + 24) % 24) / 24) * clock.dayLength;
  app.session.applyParams?.(params);
  const sel = params.get('select')?.split(':');
  if (sel?.length === 2) {
    const ref = { kind: sel[0], id: Number(sel[1]) } as unknown as R;
    if (world.entities.has(ref.kind) && world.entities.pos(ref)) app.select(ref);
    if (params.get('follow') === '1') app.toggleFollow();
    else if (params.get('fly') === '1') app.flyToSelection();
  }
  for (const name of params.get('view')?.split(',') ?? []) {
    const v = shell.views.find((x) => (x.param ?? x.id) === name);
    if (v && !v.on()) v.toggle();
  }
}
