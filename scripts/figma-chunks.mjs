// Prepara una captura para importarla en Figma por bloques, a través de un entorno
// que limita el tamaño de cada ejecución (p. ej. el conector use_figma: 50 000 caracteres).
//
//  - Extrae las imágenes a archivos (se suben aparte y se asignan a su nodo).
//  - Rasteriza los SVG demasiado grandes para caber en un bloque.
//  - Reparte el árbol en bloques comprimidos (JSON → deflate → base64), cada uno un
//    script autocontenido que usa dist/figma-standalone.js.
//
// Uso: node scripts/figma-chunks.mjs <captura.json> <carpeta-salida> [--budget=30000]
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const args = process.argv.slice(2);
const [input, outDir] = args.filter((a) => !a.startsWith('--'));
const BUDGET = Number(args.find((a) => a.startsWith('--budget='))?.split('=')[1] ?? 30000); // base64 por bloque
const SVG_MAX = 12000; // un SVG mayor se rasteriza
if (!input || !outDir) {
  console.error('Uso: node scripts/figma-chunks.mjs <captura.json> <carpeta-salida> [--budget=30000]');
  process.exit(1);
}

const capture = JSON.parse(await readFile(input, 'utf8'));
const bundle = await readFile(new URL('../dist/figma-standalone.js', import.meta.url), 'utf8');
await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'assets'), { recursive: true });

// --- Imágenes ----------------------------------------------------------------
const assets = {}; // clave → { file, mime }
const byHash = new Map();
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

async function saveAsset(bytes, mime) {
  const hash = createHash('sha1').update(bytes).digest('hex');
  if (byHash.has(hash)) return byHash.get(hash);
  const key = `a${byHash.size}`;
  const file = join('assets', `${key}.${EXT[mime] ?? 'png'}`);
  await writeFile(join(outDir, file), bytes);
  assets[key] = { file, mime };
  byHash.set(hash, key);
  return key;
}

const bigSvgs = [];
let remote = 0;
async function extract(node) {
  if (node.type === 'SVG' && node.svg.length > SVG_MAX) bigSvgs.push(node);
  if (node.type !== 'FRAME') return;
  for (const paint of node.fills) {
    if (paint.type !== 'IMAGE') continue;
    const m = paint.src.match(/^data:(image\/[\w.+-]+);base64,(.*)$/);
    if (!m) {
      remote++;
      continue;
    }
    paint.src = `mozo-asset:${await saveAsset(Buffer.from(m[2], 'base64'), m[1])}`;
  }
  for (const child of node.children) await extract(child);
}
await extract(capture.root);

if (bigSvgs.length) {
  // Se rasterizan a 2x con el Chrome instalado y pasan a ser frames con imagen.
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  for (const node of bigSvgs) {
    await page.setContent(`<body style="margin:0;background:transparent">${node.svg}</body>`);
    const png = await page.locator('svg').first().screenshot({ omitBackground: true });
    const key = await saveAsset(png, 'image/png');
    Object.assign(node, { type: 'FRAME', fills: [{ type: 'IMAGE', src: `mozo-asset:${key}`, scaleMode: 'FILL' }], clip: false, children: [] });
    delete node.svg;
  }
  await browser.close();
}

// --- Bloques -----------------------------------------------------------------
const pack = (value) => deflateRawSync(JSON.stringify(value), { level: 9 }).toString('base64');
const chunks = []; // { parentKey, origin, items }
let keyCount = 0;
let oversize = 0;

function emit(node, parentKey, origin) {
  const last = chunks[chunks.length - 1];
  if (last && last.parentKey === parentKey && pack([...last.items, { node }]).length <= BUDGET) {
    last.items.push({ node });
    return;
  }
  if (pack([{ node }]).length <= BUDGET) {
    chunks.push({ parentKey, origin, items: [{ node }] });
    return;
  }
  if (node.type !== 'FRAME') {
    oversize++;
    chunks.push({ parentKey, origin, items: [{ node }] });
    return;
  }
  // Frame demasiado grande: se crea vacío con una clave y sus hijos van en bloques propios.
  const shellKey = `k${keyCount++}`;
  const shell = { node: { ...node, children: [] }, shellKey };
  if (last && last.parentKey === parentKey && pack([...last.items, shell]).length <= BUDGET) last.items.push(shell);
  else chunks.push({ parentKey, origin, items: [shell] });
  for (const child of node.children) emit(child, shellKey, { x: node.x, y: node.y });
}

const rootName = `${capture.title || capture.url} — ${capture.root.width}px · ${new Date().toISOString().slice(0, 16)}`;
for (const child of capture.root.children) emit(child, null, { x: 0, y: 0 });

const files = [];
for (const [i, chunk] of chunks.entries()) {
  const lines = [bundle, 'const m = globalThis.__mozo;'];
  if (i === 0) lines.push(`await m.createChunkRoot(${JSON.stringify(rootName)}, m.unpack(${JSON.stringify(pack({ ...capture.root, children: [] }))}));`);
  lines.push(`const r = await m.importChunk(${JSON.stringify(rootName)}, ${JSON.stringify(chunk.parentKey)}, ${JSON.stringify(chunk.origin)}, m.unpack(${JSON.stringify(pack(chunk.items))}));`);
  if (i === chunks.length - 1) lines.push('r.finalize = m.finalizeChunks(' + JSON.stringify(rootName) + ');');
  lines.push(`return { chunk: ${i}, ...r };`);
  const file = `chunk-${String(i).padStart(2, '0')}.js`;
  const code = lines.join('\n');
  await writeFile(join(outDir, file), code);
  files.push({ file, size: code.length });
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify({ rootName, chunks: files, assets }, null, 2));
console.log(`✓ ${files.length} bloques (máx. ${Math.max(...files.map((f) => f.size))} caracteres), ${Object.keys(assets).length} imágenes, ${bigSvgs.length} SVG rasterizados`);
if (remote) console.warn(`! ${remote} imágenes remotas sin incrustar: quedarán en gris`);
if (oversize) console.warn(`! ${oversize} nodos superan el tamaño de bloque por sí solos`);
