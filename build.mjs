// Compila el capturador (bundle IIFE + bookmarklet) y el plugin de Figma.
import * as esbuild from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

async function writeBookmarklet() {
  const code = await readFile('dist/capture.js', 'utf8');
  const bookmarklet = `javascript:${encodeURIComponent(code)}`;
  await writeFile('dist/bookmarklet.txt', bookmarklet);
  const page = (await readFile('src/capture/install.html', 'utf8')).replace('__BOOKMARKLET__', bookmarklet.replace(/"/g, '&quot;'));
  await writeFile('dist/install.html', page);
}

const afterBuild = (name, fn) => ({
  name,
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      await fn();
      console.log(`✓ ${name}`);
    });
  },
});

await mkdir('dist', { recursive: true });
await mkdir('plugin/dist', { recursive: true });

const contexts = await Promise.all([
  esbuild.context({
    entryPoints: ['src/capture/index.ts'],
    outfile: 'dist/capture.js',
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'chrome100',
    plugins: [afterBuild('capturador', writeBookmarklet)],
  }),
  esbuild.context({
    entryPoints: ['src/plugin/code.ts'],
    outfile: 'plugin/dist/code.js',
    bundle: true,
    format: 'iife',
    target: 'es2017',
    plugins: [afterBuild('plugin', () => copyFile('src/plugin/ui.html', 'plugin/dist/ui.html'))],
  }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Observando cambios…');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
