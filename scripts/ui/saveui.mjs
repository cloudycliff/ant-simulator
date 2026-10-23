// 页面里的存档往返：Ctrl+S 保存 → 不带 new 重新打开 → 世界从存档恢复；页面标题随语言变化
// 用法：node scripts/ui/saveui.mjs [网址，默认 http://localhost:5173/]
import { BASE, launch, sleep } from './cdp.mjs';

const ROOT = process.argv[2] ?? BASE;

let failed = 0;
const check = (name, ok, info) => {
  if (!ok) failed++;
  console.log(`${ok ? '通过' : '失败'}  ${name}`, info ?? '');
};

const browser = await launch(9346);
try {
  const g = await browser.page();
  await g.viewport(1280, 800, false);
  await g.open(`${ROOT}?new=1&seed=4242&skip=300&lang=zh`);
  check('中文页面标题', (await g.ev('document.title')) === '赛博养蚂蚁', await g.ev('document.title'));
  for (const type of ['keyDown', 'keyUp']) await g.send('Input.dispatchKeyEvent', { type, modifiers: 2, code: 'KeyS', key: 's', windowsVirtualKeyCode: 83 });
  await sleep(500);
  const before = await g.ev(`({ seed: world.seed, sec: world.clock.seconds, ants: world.colony.ants.length, chambers: world.nest.chambers.length, toast: document.getElementById('toast').textContent })`);
  const meta = await g.ev(`JSON.parse(localStorage.getItem('cyber-ant-save-meta'))`);
  check('Ctrl+S 写入存档和摘要', !!meta && meta.ants === before.ants && Math.abs(meta.seconds - before.sec) < 5 && !!(await g.ev(`localStorage.getItem('cyber-ant-save')`)), meta);
  check('保存后提示', before.toast.includes('已保存'), before.toast);

  await g.open(`${ROOT}?lang=en`);
  const after = await g.ev(`({ seed: world.seed, sec: world.clock.seconds, ants: world.colony.ants.length, chambers: world.nest.chambers.length, toast: document.getElementById('toast').textContent })`);
  check('重新打开后从存档恢复：种子、蚂蚁数、房间数', after.seed === 4242 && after.ants === before.ants && after.chambers === before.chambers, { before, after });
  check('时间接着保存时继续', after.sec >= before.sec - 1 && after.sec < before.sec + 60, { saved: before.sec, now: after.sec });
  check('读档提示', /loaded|Loaded/i.test(after.toast), after.toast);
  check('英文页面标题', (await g.ev('document.title')) === 'Cyber Ant Farm', await g.ev('document.title'));
} finally {
  browser.close();
}
console.log(failed ? `${failed} 项失败` : '全部通过');
process.exit(failed ? 1 : 0);
