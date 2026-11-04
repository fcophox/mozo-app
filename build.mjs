// Compila el capturador (bundle IIFE + bookmarklet) y el plugin de Figma de Mozō,
// inyectando la identidad de marca de brand/.
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// --- Marca: brand/brand.json + SVG de brand/logo (opcionales) ---------------
const readOptional = (path) => readFile(path, 'utf8').catch(() => '');
const brand = JSON.parse(await readFile('brand/brand.json', 'utf8'));
const symbolSvg = (await readOptional('brand/logo/mozo-symbol.svg')).replace(/<\?xml[^>]*>\s*/, '').trim();
const logoSvg = (await readOptional('brand/logo/mozo-logo.svg')).replace(/<\?xml[^>]*>\s*/, '').trim();
for (const [file, svg] of [['mozo-symbol.svg', symbolSvg], ['mozo-logo.svg', logoSvg]]) {
  if (!svg) console.warn(`! brand/logo/${file} no existe: se usa el nombre en texto`);
}

/** Sustituye los marcadores __MOZO_*__ de las plantillas HTML. */
function applyBrand(html) {
  const favicon = symbolSvg
    ? `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(symbolSvg)}" />`
    : '';
  return html
    .replace('__MOZO_LOGO__<span class="sr">Mozō</span>', logoSvg ? `${logoSvg}<span class="sr">${brand.name}</span>` : brand.name)
    .replaceAll('__MOZO_MARK__', symbolSvg)
    .replaceAll('__MOZO_FAVICON__', favicon)
    .replaceAll('__MOZO_PRIMARY__', brand.colors.primary)
    .replaceAll('__MOZO_ON_PRIMARY__', brand.colors.onPrimary);
}

async function writeBookmarklet() {
  const code = await readFile('dist/capture.js', 'utf8');
  const bookmarklet = `javascript:${encodeURIComponent(code)}`;
  await writeFile('dist/bookmarklet.txt', bookmarklet);
  const page = applyBrand(await readFile('src/capture/install.html', 'utf8')).replace('__BOOKMARKLET__', bookmarklet.replace(/"/g, '&quot;'));
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
    define: {
      MOZO_MARK: JSON.stringify(symbolSvg),
      MOZO_PRIMARY: JSON.stringify(brand.colors.primary),
      MOZO_ON_PRIMARY: JSON.stringify(brand.colors.onPrimary),
    },
    plugins: [afterBuild('capturador', writeBookmarklet)],
  }),
  esbuild.context({
    entryPoints: ['src/plugin/code.ts'],
    outfile: 'plugin/dist/code.js',
    bundle: true,
    format: 'iife',
    target: 'es2017',
    plugins: [afterBuild('plugin', async () => writeFile('plugin/dist/ui.html', applyBrand(await readFile('src/plugin/ui.html', 'utf8'))))],
  }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Observando cambios…');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
