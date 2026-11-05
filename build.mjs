// Compila el capturador (bundle IIFE + bookmarklet) y el plugin de Figma de Mozō,
// inyectando la identidad de marca de brand/.
import * as esbuild from 'esbuild';
import { zipSync } from 'fflate';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// --- Marca: brand/brand.json + PNG de brand/logo (opcionales) ---------------
// Los PNG se generan desde los SVG con scripts/favicons.mjs. Se usan en lugar de los SVG porque
// estos, exportados de Figma, llevan una imagen grande dentro que haría enorme el bookmarklet.
const brand = JSON.parse(await readFile('brand/brand.json', 'utf8'));
const readPng = (path) => readFile(path).then((b) => `data:image/png;base64,${b.toString('base64')}`).catch(() => {
  console.warn(`! ${path} no existe (node scripts/favicons.mjs): se usa el nombre en texto`);
  return '';
});
const faviconPng = await readPng('brand/logo/favicon-32.png');
const touchIconPng = await readPng('brand/logo/apple-touch-icon-180.png');
const symbolPng = await readPng('brand/logo/mozo-symbol-64.png');
const logoPng = await readPng('brand/logo/mozo-logo-144.png');
const symbolImg = symbolPng && `<img class="mozo-mark" src="${symbolPng}" alt="" />`;

/** Sustituye los marcadores __MOZO_*__ de las plantillas HTML. */
function applyBrand(html) {
  const favicon = [
    faviconPng && `<link rel="icon" type="image/png" sizes="32x32" href="${faviconPng}" />`,
    symbolPng && `<link rel="icon" type="image/png" sizes="64x64" href="${symbolPng}" />`,
    touchIconPng && `<link rel="apple-touch-icon" href="${touchIconPng}" />`,
  ].filter(Boolean).join('\n');
  return html
    .replace('__MOZO_LOGO__<span class="sr">Mozō</span>', logoPng ? `<img src="${logoPng}" alt="${brand.name}" />` : brand.name)
    .replaceAll('__MOZO_MARK__', symbolImg)
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
  // Capas del fondo con parallax de install.html (01-…, 02-…: de la más lejana a la más cercana),
  // en WebP generado con scripts/parallax.mjs.
  await mkdir('dist/parallax', { recursive: true });
  for (const file of (await readdir('brand/parallax/web')).filter((f) => /^\d+-.*\.webp$/.test(f))) {
    await copyFile(`brand/parallax/web/${file}`, `dist/parallax/${file}`);
  }
}

/** Escribe la UI del plugin y empaqueta el plugin en un .zip descargable desde install.html. */
async function writePlugin() {
  await writeFile('plugin/dist/ui.html', applyBrand(await readFile('src/plugin/ui.html', 'utf8')));
  const files = ['manifest.json', 'dist/code.js', 'dist/ui.html'];
  const entries = await Promise.all(files.map((f) => readFile(`plugin/${f}`)));
  const zip = zipSync(Object.fromEntries(files.map((f, i) => [`mozo-figma-plugin/${f}`, entries[i]])));
  await writeFile('dist/mozo-figma-plugin.zip', zip);
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
    charset: 'ascii', // el bookmarklet no debe llevar caracteres fuera de ASCII
    target: 'chrome100',
    define: {
      MOZO_MARK: JSON.stringify(symbolImg),
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
    plugins: [afterBuild('plugin', writePlugin)],
  }),
  esbuild.context({
    entryPoints: ['src/plugin/standalone.ts'],
    outfile: 'dist/figma-standalone.js',
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2017',
  }),
]);

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('Observando cambios…');
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
