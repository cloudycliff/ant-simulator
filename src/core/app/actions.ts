import { LANGS, t } from '../i18n';
import { BACKGROUND_LIMITED } from '../platform/background';
import { chooseLang } from '../platform/lang';
import { QUALITY_MODES } from '../render/quality';
import type { EntityRef } from '../sim/entities';
import type { App } from './app';

/** 按钮、按键和面板里的动作：显示开关的 id、外壳的动作（ShellAction），其余交给游戏的 session.action */
export function runAction<R extends EntityRef>(app: App<R>, a: string, v?: number): void {
  const { world, shell, tools, session, quality, installer } = app;
  const c = world.clock;
  const slot = app.game.save.slot;
  const view = shell.views.find((x) => x.id === a);
  if (view) {
    view.toggle();
    if (view.id === 'stats') shell.refresh(app.selection, 60);
  } else
    switch (a) {
      case 'pause':
        c.paused = !c.paused;
        break;
      case 'speed':
        c.speed = v ?? 1;
        c.paused = false;
        break;
      case 'follow':
        app.toggleFollow();
        break;
      case 'flyto':
        app.flyToSelection();
        break;
      case 'deselect':
        app.select(null);
        break;
      case 'help':
        shell.toggleHelp();
        break;
      case 'tool':
        tools?.select(v ?? 0);
        shell.hideHelp();
        shell.setSheet(null);
        break;
      case 'toolopt':
        tools?.setOption(v ?? 0);
        break;
      case 'toolexit':
        tools?.exit();
        break;
      case 'toolPlace':
        if (tools?.pending && app.applyTool(tools.pending)) tools.pending = null;
        break;
      case 'toolRotate':
        tools?.rotate();
        break;
      case 'savePanel':
        shell.toggleSave();
        shell.saveMeta = slot.readMeta();
        break;
      case 'saveNow':
        app.saving.save(true);
        break;
      case 'loadSave':
        if (slot.readMeta()) app.saving.reload();
        break;
      case 'newGame':
        if (!confirm(t('toast.confirmNew'))) break;
        slot.clear();
        app.saving.reload();
        break;
      case 'background': {
        if (BACKGROUND_LIMITED) {
          shell.toast(t('toast.bgLimited'));
          break;
        }
        const bg = app.background;
        bg.setEnabled(!bg.enabled);
        shell.state.background = bg.enabled;
        shell.toast(t(bg.enabled ? 'toast.bgOn' : 'toast.bgOff'));
        break;
      }
      case 'quality': {
        const mode = QUALITY_MODES[v ?? (QUALITY_MODES.indexOf(quality.mode) + 1) % QUALITY_MODES.length];
        quality.setMode(mode);
        shell.toast(t('toast.quality', { q: shell.qualityLabel() }));
        app.refresh();
        break;
      }
      case 'music':
        shell.toast(t(app.music.toggle() ? 'toast.musicOn' : 'toast.musicOff'));
        app.refresh();
        break;
      case 'install':
        if (installer?.kind === 'ios') shell.toast(t('toast.installIos'));
        else void installer?.install().then((ok) => ok && shell.toast(t('toast.installed')));
        break;
      case 'langMenu':
        shell.toggleLangMenu();
        break;
      case 'brightMenu':
        shell.toggleBrightMenu();
        break;
      case 'brightReset':
        app.brightness.reset();
        shell.syncBrightness();
        break;
      case 'lang':
        shell.setLangMenu(false);
        if (!chooseLang(LANGS[v ?? 0] ?? 'zh')) break;
        document.title = app.game.title();
        shell.relocalize();
        app.refresh();
        shell.toast(t('toast.lang'));
        break;
      default:
        session.action?.(a, v);
    }
  shell.renderTool();
  shell.renderSave();
  session.syncViews();
}
