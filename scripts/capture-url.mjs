// Captura una URL con el Chrome instalado (sin interfaz) y guarda el JSON de Mozō.
// Uso: node scripts/capture-url.mjs <url> [salida.json] [--width=1280]
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const out = args.filter((a) => !a.startsWith('--'))[1] ?? 'capture.mozo.json';
const width = Number(args.find((a) => a.startsWith('--width='))?.split('=')[1] ?? 1280);
if (!url) {
  console.error('Uso: node scripts/capture-url.mjs <url> [salida.json] [--width=1280]');
  process.exit(1);
}

const code = await readFile(new URL('../dist/capture.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {
    console.warn('! La red no quedó inactiva en 60 s; se captura igualmente.');
  });

  // capture() recorre la página antes de capturar (animaciones de entrada, imágenes perezosas).
  await page.addScriptTag({ content: code.replace('document.currentScript?.dataset.noAutorun||', 'true||') });
  const capture = await page.evaluate(() => window.__mozo.capture());
  await page.screenshot({ path: out.replace(/\.json$/, '') + '.png', fullPage: true });
  await writeFile(out, JSON.stringify(capture));
  console.log(`✓ ${out} (${(JSON.stringify(capture).length / 1024).toFixed(0)} KB, ${capture.root.width}×${capture.root.height})`);
} finally {
  await browser.close();
}
