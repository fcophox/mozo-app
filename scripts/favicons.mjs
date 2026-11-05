// Genera los PNG de marca a partir de los SVG de brand/logo: favicons (para navegadores sin
// favicon SVG, como Safari), el icono del plugin en Figma Community y versiones ligeras del
// isotipo y el logo que el build incrusta en la página, el panel y el plugin (los SVG
// exportados de Figma llevan un PNG grande dentro y harían enorme el bookmarklet).
// Uso: node scripts/favicons.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const read = (file) => readFile(new URL(`../brand/logo/${file}`, import.meta.url), 'utf8');
const symbol = await read('mozo-symbol.svg');
const logo = await read('mozo-logo.svg');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [file, svg, width, height] of [
    ['logo/favicon-32.png', symbol, 32, 32],
    ['logo/apple-touch-icon-180.png', symbol, 180, 180],
    ['figma-community/icon-128.png', symbol, 128, 128],
    ['logo/mozo-symbol-64.png', symbol, 64, 64],
    ['logo/mozo-logo-144.png', logo, Math.round((2079 / 600) * 144), 144],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<body style="margin:0">${svg.replace(/<svg([^>]*)width="\d+" height="\d+"/, `<svg$1width="${width}" height="${height}"`)}</body>`);
    await page.locator('svg').first().screenshot({ path: new URL(`../brand/${file}`, import.meta.url).pathname, omitBackground: true });
    await page.close();
    console.log(`✓ brand/${file}`);
  }
} finally {
  await browser.close();
}
