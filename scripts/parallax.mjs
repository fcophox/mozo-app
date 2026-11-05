// Convierte a WebP las imágenes de las páginas públicas, que es lo que el build copia a dist/:
// - las capas PNG de brand/parallax (01-…, 02-…) → brand/parallax/web
// - la foto de El Creador, brand/creator/elforjador.png → brand/creator/web/foto.webp
// Necesita cwebp (brew install webp).
// Uso: node scripts/parallax.mjs
import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, stat } from 'node:fs/promises';

const brand = new URL('../brand/', import.meta.url).pathname;

async function webp(src, out, args = []) {
  execFileSync('cwebp', ['-quiet', '-q', '82', '-alpha_q', '90', '-m', '6', ...args, src, '-o', out]);
  console.log(`✓ ${out.replace(brand, 'brand/')} (${Math.round((await stat(out)).size / 1024)} KB)`);
}

await mkdir(`${brand}parallax/web`, { recursive: true });
for (const file of (await readdir(`${brand}parallax`)).filter((f) => /^\d+-.*\.png$/.test(f))) {
  await webp(`${brand}parallax/${file}`, `${brand}parallax/web/${file.replace(/\.png$/, '.webp')}`);
}

const photo = `${brand}creator/elforjador.png`;
if (await access(photo).then(() => true, () => false)) {
  await mkdir(`${brand}creator/web`, { recursive: true });
  // Se muestra a 220–260 px de ancho: 640 px basta para pantallas 2x.
  await webp(photo, `${brand}creator/web/foto.webp`, ['-resize', '640', '0']);
}
