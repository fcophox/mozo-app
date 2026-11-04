// Convierte las imágenes referenciadas a data: URLs en PNG/JPEG/GIF (los formatos
// que Figma acepta) para que el plugin no dependa de CORS ni de la red.
import type { CapturedNode, Paint } from '../shared/schema';

const DIRECT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif']);
const MAX_RASTER_SIDE = 4096;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    img.src = src;
  });
}

/** Rasteriza a PNG cualquier imagen que el navegador sepa decodificar (webp, avif, svg...). */
async function rasterize(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    // Los SVG sin tamaño intrínseco se rasterizan a 2x para que se vean nítidos.
    const isSvg = blob.type.includes('svg');
    let width = (img.naturalWidth || 300) * (isSvg ? 2 : 1);
    let height = (img.naturalHeight || 150) * (isSvg ? 2 : 1);
    const scale = Math.min(1, MAX_RASTER_SIDE / Math.max(width, height));
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function inlineOne(src: string): Promise<string> {
  if (src.startsWith('data:image/png') || src.startsWith('data:image/jpeg') || src.startsWith('data:image/gif')) {
    return src;
  }
  // Sin credenciales primero: los CDN que responden con "Access-Control-Allow-Origin: *"
  // rechazan las peticiones con cookies. Si falla, reintentamos con ellas (imágenes privadas).
  let response: Response;
  try {
    response = await fetch(src, { credentials: 'omit', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    response = await fetch(src, { credentials: 'include', mode: 'cors' });
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return DIRECT_TYPES.has(blob.type) ? blobToDataUrl(blob) : rasterize(blob);
}

function collectImagePaints(node: CapturedNode, out: Paint[]) {
  if (node.type === 'TEXT') for (const fill of node.fills ?? []) if (fill.type === 'IMAGE') out.push(fill);
  if (node.type !== 'FRAME') return;
  for (const fill of node.fills) if (fill.type === 'IMAGE') out.push(fill);
  for (const child of node.children) collectImagePaints(child, out);
}

/**
 * Sustituye in situ cada `src` por su data: URL. Las que fallen (p. ej. por CORS)
 * se quedan con la URL original y el plugin intentará descargarlas.
 */
export async function inlineImages(root: CapturedNode, onProgress?: (done: number, total: number) => void) {
  const paints: Paint[] = [];
  collectImagePaints(root, paints);
  const imagePaints = paints.filter((p): p is Extract<Paint, { type: 'IMAGE' }> => p.type === 'IMAGE');

  const unique = [...new Set(imagePaints.map((p) => p.src))];
  const resolved = new Map<string, string>();
  let done = 0;
  const CONCURRENCY = 6;
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const src = unique[cursor++];
      try {
        resolved.set(src, await inlineOne(src));
      } catch {
        resolved.set(src, src);
      }
      onProgress?.(++done, unique.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  for (const paint of imagePaints) paint.src = resolved.get(paint.src) ?? paint.src;
  return { total: unique.length, inlined: [...resolved.values()].filter((v) => v.startsWith('data:')).length };
}
