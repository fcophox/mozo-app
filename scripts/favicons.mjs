// Genera los favicon PNG a partir de brand/logo/mozo-symbol.svg (para navegadores que
// no aceptan favicon SVG, como Safari). Uso: node scripts/favicons.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const svg = await readFile(new URL('../brand/logo/mozo-symbol.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon-180.png', 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0">${svg.replace(/<svg([^>]*)width="\d+" height="\d+"/, `<svg$1width="${size}" height="${size}"`)}</body>`);
    await page.locator('svg').first().screenshot({ path: new URL(`../brand/logo/${file}`, import.meta.url).pathname, omitBackground: true });
    await page.close();
    console.log(`✓ brand/logo/${file}`);
  }
} finally {
  await browser.close();
}
