// Conversión de valores CSS calculados (getComputedStyle) a valores del esquema.
import type { Border, GradientStop, LinearGradientPaint, Paint, Radii, RGBA, Shadow } from '../shared/schema';

// --- Colores ---------------------------------------------------------------
// Dejamos que el propio navegador resuelva cualquier sintaxis (rgb, hsl, oklch,
// color(), color-mix...) pintando un píxel en un canvas y leyéndolo.

const colorCache = new Map<string, RGBA>();
let colorCtx: CanvasRenderingContext2D | null = null;

export function parseColor(value: string): RGBA {
  const cached = colorCache.get(value);
  if (cached) return cached;

  let rgba: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  if (value && value !== 'transparent') {
    if (!colorCtx) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      colorCtx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (colorCtx) {
      colorCtx.clearRect(0, 0, 1, 1);
      colorCtx.fillStyle = '#000';
      colorCtx.fillStyle = value;
      colorCtx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
      rgba = { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
    }
  }
  colorCache.set(value, rgba);
  return rgba;
}

const COLOR_RE =
  /(rgba?\([^)]*\)|hsla?\([^)]*\)|hwb\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b|transparent)/i;

/** Separa por comas de primer nivel (ignora las que están dentro de paréntesis). */
export function splitTopLevel(value: string, sep = ','): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === sep && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

// --- Fondos ----------------------------------------------------------------

const SIDE_KEYWORDS: Record<string, number> = {
  'to top': 0,
  'to top right': 45,
  'to right top': 45,
  'to right': 90,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom': 180,
  'to bottom left': 225,
  'to left bottom': 225,
  'to left': 270,
  'to top left': 315,
  'to left top': 315,
};

function parseAngle(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t in SIDE_KEYWORDS) return SIDE_KEYWORDS[t];
  const m = t.match(/^(-?[\d.]+)(deg|rad|turn|grad)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'rad': return (n * 180) / Math.PI;
    case 'turn': return n * 360;
    case 'grad': return n * 0.9;
    default: return n;
  }
}

function parseLinearGradient(fn: string): LinearGradientPaint | null {
  const m = fn.match(/^(?:repeating-)?linear-gradient\((.*)\)$/i);
  if (!m) return null;
  const args = splitTopLevel(m[1]);
  let angle = 180;
  const first = parseAngle(args[0]);
  if (first !== null) {
    angle = first;
    args.shift();
  }

  const raw: { color: RGBA; position: number | null }[] = [];
  for (const arg of args) {
    const colorMatch = arg.match(COLOR_RE);
    if (!colorMatch) continue;
    const rest = arg.replace(colorMatch[0], '').trim();
    const positions = rest.split(/\s+/).filter(Boolean);
    const color = parseColor(colorMatch[0]);
    if (positions.length === 0) {
      raw.push({ color, position: null });
    } else {
      // "red 10% 20%" crea dos paradas con el mismo color.
      for (const p of positions) raw.push({ color, position: p.endsWith('%') ? parseFloat(p) / 100 : null });
    }
  }
  if (raw.length < 2) return null;

  // Rellenar posiciones ausentes repartiéndolas uniformemente (como hace CSS).
  if (raw[0].position === null) raw[0].position = 0;
  if (raw[raw.length - 1].position === null) raw[raw.length - 1].position = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].position !== null) continue;
    let j = i;
    while (raw[j].position === null) j++;
    const start = raw[i - 1].position as number;
    const end = raw[j].position as number;
    const steps = j - i + 1;
    for (let k = i; k < j; k++) raw[k].position = start + ((end - start) * (k - i + 1)) / steps;
  }

  const stops: GradientStop[] = raw.map((s) => ({
    color: s.color,
    position: Math.min(1, Math.max(0, s.position as number)),
  }));
  return { type: 'LINEAR_GRADIENT', angle, stops };
}

function firstColorOf(fn: string): RGBA | null {
  const m = fn.match(COLOR_RE);
  return m ? parseColor(m[0]) : null;
}

function scaleModeFor(size: string, repeat: string): 'FILL' | 'FIT' | 'TILE' {
  if (size.startsWith('contain')) return 'FIT';
  if (size.startsWith('cover')) return 'FILL';
  if (!repeat.startsWith('no-repeat') && size === 'auto') return 'TILE';
  return 'FILL';
}

/** Devuelve los rellenos en orden de Figma (el último se pinta encima). */
export function backgroundPaints(style: CSSStyleDeclaration): Paint[] {
  const paints: Paint[] = [];

  const bg = parseColor(style.backgroundColor);
  if (bg.a > 0) paints.push({ type: 'SOLID', color: bg });

  const image = style.backgroundImage;
  if (image && image !== 'none') {
    const layers = splitTopLevel(image);
    const sizes = splitTopLevel(style.backgroundSize);
    const repeats = splitTopLevel(style.backgroundRepeat);
    const positions = splitTopLevel(style.backgroundPosition);
    // En CSS la primera capa queda arriba; en Figma es la última.
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      const url = layer.match(/^url\(["']?(.*?)["']?\)$/);
      if (url) {
        const size = sizes[i] ?? sizes[0] ?? 'auto';
        const repeat = repeats[i] ?? repeats[0] ?? 'repeat';
        paints.push({
          type: 'IMAGE',
          src: url[1],
          scaleMode: scaleModeFor(size, repeat),
          css: { size, position: positions[i] ?? positions[0] ?? '0% 0%', repeat },
        });
        continue;
      }
      const linear = parseLinearGradient(layer);
      if (linear) {
        paints.push(linear);
        continue;
      }
      // Gradientes radiales/cónicos: aproximamos con el primer color.
      const fallback = firstColorOf(layer);
      if (fallback && fallback.a > 0) paints.push({ type: 'SOLID', color: fallback });
    }
  }
  return paints;
}

// --- Bordes, radios y sombras ----------------------------------------------

export function borderOf(style: CSSStyleDeclaration): Border | undefined {
  const side = (name: 'Top' | 'Right' | 'Bottom' | 'Left') => {
    const s = style.getPropertyValue(`border-${name.toLowerCase()}-style`);
    if (s === 'none' || s === 'hidden') return 0;
    return px(style.getPropertyValue(`border-${name.toLowerCase()}-width`));
  };
  const border = { top: side('Top'), right: side('Right'), bottom: side('Bottom'), left: side('Left') };
  if (!border.top && !border.right && !border.bottom && !border.left) return undefined;

  // Figma solo admite un color de trazo: usamos el del primer lado visible.
  const visible = (['top', 'right', 'bottom', 'left'] as const).find((k) => border[k] > 0)!;
  const color = parseColor(style.getPropertyValue(`border-${visible}-color`));
  if (color.a === 0) return undefined;
  return { ...border, color };
}

export function radiiOf(style: CSSStyleDeclaration, width: number, height: number): Radii | undefined {
  const corner = (prop: string) => {
    const first = style.getPropertyValue(prop).split(/\s+/)[0] ?? '0';
    const value = first.endsWith('%') ? (parseFloat(first) / 100) * Math.min(width, height) : px(first);
    return Math.min(value, Math.min(width, height) / 2);
  };
  const radii = {
    topLeft: corner('border-top-left-radius'),
    topRight: corner('border-top-right-radius'),
    bottomRight: corner('border-bottom-right-radius'),
    bottomLeft: corner('border-bottom-left-radius'),
  };
  if (!radii.topLeft && !radii.topRight && !radii.bottomRight && !radii.bottomLeft) return undefined;
  return radii;
}

export function shadowsOf(style: CSSStyleDeclaration): Shadow[] | undefined {
  const value = style.boxShadow;
  if (!value || value === 'none') return undefined;
  const shadows: Shadow[] = [];
  for (const part of splitTopLevel(value)) {
    const colorMatch = part.match(COLOR_RE);
    const color = colorMatch ? parseColor(colorMatch[0]) : parseColor(style.color);
    const rest = colorMatch ? part.replace(colorMatch[0], '') : part;
    const inset = /\binset\b/.test(rest);
    const [x = 0, y = 0, blur = 0, spread = 0] = (rest.match(/-?[\d.]+px/g) ?? []).map(px);
    if (color.a === 0) continue;
    shadows.push({ inset, x, y, blur, spread, color });
  }
  return shadows.length ? shadows : undefined;
}
