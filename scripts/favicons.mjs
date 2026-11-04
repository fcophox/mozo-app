// Genera los iconos PNG a partir de brand/logo/mozo-symbol.svg: favicons (para navegadores
// sin favicon SVG, como Safari) y el icono del plugin en Figma Community.
// Uso: node scripts/favicons.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const svg = await readFile(new URL('../brand/logo/mozo-symbol.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [file, size] of [
    ['logo/favicon-32.png', 32],
    ['logo/apple-touch-icon-180.png', 180],
    ['figma-community/icon-128.png', 128],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg.replace(/<svg([^>]*)width="\d+" height="\d+"/, `<svg$1width="${size}" height="${size}"`)}</body>`);
    await page.locator('svg').first().screenshot({ path: new URL(`../brand/${file}`, import.meta.url).pathname, omitBackground: true });
    await page.close();
    console.log(`✓ brand/${file}`);
  }
} finally {
  await browser.close();
}
