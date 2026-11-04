// Ejecuta en orden los bloques de scripts/figma-chunks.mjs contra el `figma` simulado,
// como lo haría use_figma, y comprueba la estructura resultante.
// Uso: node test/chunks-mock.mjs <carpeta-de-bloques>
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { createFigmaMock } from './figma-mock.mjs';

const dir = process.argv[2];
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
const { figma, page } = createFigmaMock();
const context = vm.createContext({ figma, setTimeout, console });
context.globalThis = context;

const targets = [];
for (const { file } of manifest.chunks) {
  const code = await readFile(join(dir, file), 'utf8');
  const result = await vm.runInContext(`(async () => {\n${code}\n})()`, context);
  targets.push(...result.assets);
  console.log(`${file}: ${result.created} capas, ${result.assets.length} imágenes pendientes${result.finalize ? `, ${result.finalize.untagged} claves retiradas` : ''}`);
}

const root = page.findChild((n) => n.name === manifest.rootName);
const all = root.findAll(() => true);
const tagged = all.filter((n) => /⟦/.test(n.name));
const missing = Object.keys(manifest.assets).filter((k) => !targets.some((t) => t.key === k));
console.log(`total: ${all.length} capas, ${targets.length} destinos de imagen, claves sin retirar: ${tagged.length}, imágenes sin destino: ${missing.length}`);
if (tagged.length || missing.length) process.exit(1);
