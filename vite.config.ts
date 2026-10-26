import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import type { OutputAsset, OutputChunk } from 'rollup';

/** 双击即可运行的发布文件，构建时写到项目根目录，随仓库提交 */
const RELEASE_FILE = 'cyber-ant-farm.html';

/** 把打包出的 JS 和 CSS 内联进 index.html：浏览器不允许从 file:// 加载外部模块脚本，内联后双击即可运行 */
function singleFile(page: string, release: string | null): Plugin {
  let root = process.cwd();
  return {
    name: 'single-file',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    writeBundle(_, bundle) {
      const html = bundle[page] as OutputAsset | undefined;
      if (html && release) writeFileSync(resolve(root, release), html.source);
    },
    generateBundle(_, bundle) {
      const html = bundle[page] as OutputAsset | undefined;
      if (!html) return;
      let src = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && name.endsWith('.js')) {
          const re = new RegExp(`<script type="module"[^>]*src="[^"]*${escapeRe(name)}"[^>]*></script>`);
          const code = (file as OutputChunk).code.replace(/<\/script/gi, '<\\/script');
          src = src.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (file.type === 'asset' && name.endsWith('.css')) {
          const re = new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${escapeRe(name)}"[^>]*>`);
          src = src.replace(re, () => `<style>${String(file.source)}</style>`);
          delete bundle[name];
        } else if (file.type === 'asset' && name.endsWith('.svg')) {
          const data = `data:image/svg+xml;base64,${Buffer.from(file.source).toString('base64')}`;
          src = src.replace(new RegExp(`"[^"]*${escapeRe(name)}"`, 'g'), () => `"${data}"`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 每个游戏一个页面，各自构建成一个文件：vite build 是蚂蚁（index.html），--mode aquarium 是鱼缸示例，--mode bee 是蜜蜂 */
const PAGES: Record<string, { page: string; release: string | null }> = {
  production: { page: 'index.html', release: RELEASE_FILE },
  aquarium: { page: 'aquarium.html', release: null },
  bee: { page: 'bee.html', release: null },
};

export default defineConfig(({ mode }) => {
  const { page, release } = PAGES[mode] ?? PAGES.production;
  const first = page === 'index.html';
  return {
    base: './',
    server: { port: 5173, open: false },
    plugins: [singleFile(page, release)],
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 1500,
      modulePreload: false,
      cssCodeSplit: false,
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      // 后构建的页面不能清空先构建的页面的产物
      emptyOutDir: first,
      rollupOptions: { input: resolve(process.cwd(), page), output: { inlineDynamicImports: true } },
    },
  };
});
