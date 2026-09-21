import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { buildIcons } from './icons';
const out = 'dist/extension';
await buildIcons(out);
await build({
  entryPoints: { background: 'src/background.ts', offscreen: 'src/extension/offscreen.ts' },
  bundle: true,
  minify: true,
  format: 'esm',
  outdir: out,
  target: 'chrome120',
});
await fs.writeFile(
  `${out}/offscreen.html`,
  '<!doctype html><html><head><meta charset="utf-8"><title>Tabbit 文集</title></head><body><script type="module" src="./offscreen.js"></script></body></html>',
);
await fs.writeFile(
  `${out}/manifest.json`,
  JSON.stringify(
    {
      manifest_version: 3,
      name: 'Tabbit 文集',
      version: '0.3.46',
      minimum_chrome_version: '120',
      description: '将收藏夹中的文章整理为带文章封面与 AI 介绍的 HTML 文集。',
      permissions: ['bookmarks', 'storage', 'offscreen'],
      host_permissions: ['https://api.deepseek.com/*'],
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      options_ui: { page: 'index.html?settings=1', open_in_tab: true },
      icons: { 16: 'icon-16.png', 32: 'icon-32.png', 48: 'icon-48.png', 128: 'icon-128.png' },
      action: {
        default_title: '打开 Tabbit 文集',
        default_icon: { 16: 'icon-16.png', 32: 'icon-32.png' },
      },
      background: { service_worker: 'background.js', type: 'module' },
      content_security_policy: {
        extension_pages:
          "script-src 'self'; object-src 'none'; connect-src 'self' https: http:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; frame-src 'none';",
      },
    },
    null,
    2,
  ),
);
const files: Record<string, Uint8Array> = {};
async function collect(directory: string) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else
      files[path.relative(out, filename).split(path.sep).join('/')] = await fs.readFile(filename);
  }
}
await collect(out);
await fs.writeFile('dist/bookmark-press-extension.zip', zipSync(files, { level: 9 }));
console.log('Chrome extension ready: dist/extension · dist/bookmark-press-extension.zip');
