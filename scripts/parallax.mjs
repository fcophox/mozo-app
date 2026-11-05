// Convierte las capas PNG de brand/parallax (01-…, 02-…) a WebP en brand/parallax/web, que es lo
// que el build copia a dist/ para install.html. Necesita cwebp (brew install webp).
// Uso: node scripts/parallax.mjs
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';

const dir = new URL('../brand/parallax/', import.meta.url).pathname;
await mkdir(`${dir}web`, { recursive: true });
for (const file of (await readdir(dir)).filter((f) => /^\d+-.*\.png$/.test(f))) {
  const out = `${dir}web/${file.replace(/\.png$/, '.webp')}`;
  execFileSync('cwebp', ['-quiet', '-q', '82', '-alpha_q', '90', '-m', '6', `${dir}${file}`, '-o', out]);
  console.log(`✓ brand/parallax/web/${file.replace(/\.png$/, '.webp')} (${Math.round((await stat(out)).size / 1024)} KB)`);
}
