// Coloca las imágenes de fondo donde las dibuja el navegador. Figma solo sabe llenar
// (FILL), ajustar centrado (FIT) o repetir (TILE) la caja entera; un fondo con
// `background-size`/`background-position` (p. ej. `contain` alineado a la derecha)
// necesita su propio rectángulo, que el plugin recorta a la caja del elemento.
import type { Box, CapturedNode, ImagePaint } from '../shared/schema';

const naturalSizes = new Map<string, Promise<{ width: number; height: number } | null>>();

function naturalSize(src: string) {
  let pending = naturalSizes.get(src);
  if (!pending) {
    pending = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    naturalSizes.set(src, pending);
  }
  return pending;
}

const KEYWORDS: Record<string, string> = { left: '0%', top: '0%', center: '50%', right: '100%', bottom: '100%' };

function length(token: string, reference: number): number | null {
  if (token === 'auto') return null;
  if (token.endsWith('%')) return (parseFloat(token) / 100) * reference;
  const n = parseFloat(token);
  return Number.isFinite(n) ? n : null;
}

/** Tamaño dibujado según background-size. */
function drawnSize(size: string, el: Box, img: { width: number; height: number }) {
  if (size === 'cover' || size === 'contain') {
    const ratio = size === 'cover' ? Math.max(el.width / img.width, el.height / img.height) : Math.min(el.width / img.width, el.height / img.height);
    return { width: img.width * ratio, height: img.height * ratio };
  }
  const [wToken = 'auto', hToken = 'auto'] = size.split(/\s+/);
  const w = length(wToken, el.width);
  const h = length(hToken, el.height);
  if (w !== null && h !== null) return { width: w, height: h };
  if (w !== null) return { width: w, height: (w * img.height) / img.width };
  if (h !== null) return { width: (h * img.width) / img.height, height: h };
  return img;
}

function offset(token: string, free: number): number {
  const t = KEYWORDS[token] ?? token;
  return t.endsWith('%') ? (parseFloat(t) / 100) * free : parseFloat(t) || 0;
}

async function place(paint: ImagePaint, el: Box) {
  const css = paint.css;
  delete paint.css;
  if (!css || css.repeat !== 'no-repeat') return;
  const img = await naturalSize(paint.src);
  if (!img) return;
  const size = drawnSize(css.size, el, img);
  const [px = '0%', py = '0%'] = css.position.split(/\s+/);
  const box = {
    x: el.x + offset(px, el.width - size.width),
    y: el.y + offset(py, el.height - size.height),
    width: size.width,
    height: size.height,
  };
  const fillsElement = Math.abs(box.x - el.x) < 0.5 && Math.abs(box.y - el.y) < 0.5 &&
    Math.abs(box.width - el.width) < 0.5 && Math.abs(box.height - el.height) < 0.5;
  if (!fillsElement) {
    paint.box = box;
    paint.scaleMode = 'FILL';
  }
}

export async function resolveBackgroundBoxes(root: CapturedNode) {
  const jobs: Promise<void>[] = [];
  const visit = (node: CapturedNode) => {
    if (node.type !== 'FRAME') return;
    for (const paint of node.fills) if (paint.type === 'IMAGE') jobs.push(place(paint, node));
    node.children.forEach(visit);
  };
  visit(root);
  await Promise.all(jobs);
}
