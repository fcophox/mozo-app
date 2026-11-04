// Pseudo-elementos (::before / ::after). No tienen nodo en el DOM ni getBoundingClientRect,
// así que durante la captura los sustituimos por elementos reales con su mismo estilo
// calculado: el navegador los coloca exactamente donde estaba el pseudo-elemento y el
// recorrido normal los captura. Al terminar se deshace todo.

const HIDE_STYLE = '.mozo-hide-before::before{content:none!important}.mozo-hide-after::after{content:none!important}';
const NO_CHILDREN = new Set(['IMG', 'INPUT', 'TEXTAREA', 'SELECT', 'BR', 'HR', 'IFRAME', 'VIDEO', 'CANVAS', 'OBJECT', 'EMBED']);
export const PSEUDO_TAG = 'mozo-pseudo';

/** Texto de la propiedad `content` (solo cadenas; attr()/counter() se ignoran). */
function contentText(content: string): string | null {
  if (!content || content === 'none' || content === 'normal') return null;
  const strings = [...content.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  if (strings.length) return strings.join('');
  return content.startsWith('url(') ? '' : null;
}

interface Job {
  el: Element;
  which: 'before' | 'after';
  text: string;
  props: [string, string][];
}

export function materializePseudoElements(): () => void {
  const jobs: Job[] = [];
  for (const el of Array.from(document.body?.querySelectorAll('*') ?? [])) {
    if (!(el instanceof HTMLElement) || NO_CHILDREN.has(el.tagName)) continue;
    for (const which of ['before', 'after'] as const) {
      const style = getComputedStyle(el, `::${which}`);
      const text = contentText(style.content);
      if (text === null || style.display === 'none') continue;
      // Copiamos ya los valores: al ocultar el pseudo-elemento su estilo calculado cambia.
      const props: [string, string][] = [];
      for (let i = 0; i < style.length; i++) props.push([style[i], style.getPropertyValue(style[i])]);
      jobs.push({ el, which, text, props });
    }
  }

  const sheet = document.createElement('style');
  sheet.textContent = HIDE_STYLE;
  document.head.appendChild(sheet);
  const created: HTMLElement[] = [];
  for (const { el, which, text, props } of jobs) {
    const node = document.createElement(PSEUDO_TAG);
    for (const [prop, value] of props) node.style.setProperty(prop, value);
    node.dataset.pseudo = which;
    node.textContent = text;
    if (which === 'before') el.prepend(node);
    else el.append(node);
    el.classList.add(`mozo-hide-${which}`);
    created.push(node);
  }

  return () => {
    for (const node of created) node.remove();
    for (const { el, which } of jobs) el.classList.remove(`mozo-hide-${which}`);
    sheet.remove();
  };
}

// --- Fuentes de iconos ---------------------------------------------------------
// Los iconos hechos con fuentes (Font Awesome, Material Icons, fuentes propias) no
// existen en Figma: se rasterizan a imagen con la fuente ya cargada en la página.

const ICON_FONT_RE = /icon|awesome|material|glyph|symbol|fontello|ionic|feather|remix/i;
// Construida desde texto para no dejar caracteres de uso privado literales en el bundle.
const PRIVATE_USE_RE = new RegExp('^[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\s]+$', 'u');

export function isIconText(text: string, style: CSSStyleDeclaration): boolean {
  const first = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  return text.trim().length > 0 && (ICON_FONT_RE.test(first) || PRIVATE_USE_RE.test(text.trim()));
}

/** Dibuja el texto con su fuente en un canvas a 2x y devuelve un PNG. */
export function rasterizeText(text: string, style: CSSStyleDeclaration, width: number, height: number): string | null {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  ctx.fillStyle = style.color;
  const metrics = ctx.measureText(text);
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
  ctx.fillText(text, (width - metrics.width) / 2, (height - (ascent + descent)) / 2 + ascent);
  return canvas.toDataURL('image/png');
}
