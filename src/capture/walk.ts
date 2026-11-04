// Recorre el DOM renderizado y produce el árbol de nodos del esquema.
import type { CapturedNode, FrameNode, Paint, SvgNode, TextNode } from '../shared/schema';
import { backgroundPaints, borderOf, parseColor, radiiOf, shadowsOf, splitTopLevel } from './css';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE', 'BASE', 'SOURCE', 'TRACK', 'WBR',
]);
const MAX_NODES = 25000;

export interface WalkOptions {
  /** Omite elementos sin estilo visual y sube sus hijos al padre (árbol más limpio). */
  flatten: boolean;
  /** Nodos a ignorar (p. ej. el panel del propio capturador). */
  ignore?: Element[];
}

interface Ctx {
  options: WalkOptions;
  scrollX: number;
  scrollY: number;
  count: number;
}

function absRect(rect: DOMRect, ctx: Ctx) {
  return { x: rect.left + ctx.scrollX, y: rect.top + ctx.scrollY, width: rect.width, height: rect.height };
}

function nameFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) return `${tag}#${el.id}`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  return cls ? `${tag}.${cls}` : tag;
}

// --- Texto -----------------------------------------------------------------

function textStyle(style: CSSStyleDeclaration) {
  const lineHeight = style.lineHeight === 'normal' ? null : parseFloat(style.lineHeight) || null;
  const letterSpacing = style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) || 0;
  const transform = style.textTransform;
  const decoration = style.textDecorationLine || style.textDecoration;
  const align = style.textAlign;
  return {
    fontFamilies: splitTopLevel(style.fontFamily).map((f) => f.replace(/^["']|["']$/g, '').trim()),
    fontSize: parseFloat(style.fontSize) || 16,
    fontWeight: parseInt(style.fontWeight, 10) || 400,
    italic: style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique'),
    lineHeight,
    letterSpacing,
    // -webkit-text-fill-color gana sobre color, salvo cuando es transparente
    // (texto con background-clip: text), donde usamos color como aproximación.
    color: style.webkitTextFillColor && parseColor(style.webkitTextFillColor).a > 0
      ? parseColor(style.webkitTextFillColor)
      : parseColor(style.color),
    textAlign: (align === 'center' ? 'CENTER' : align === 'right' || align === 'end' ? 'RIGHT' : align === 'justify' ? 'JUSTIFIED' : 'LEFT') as TextNode['textAlign'],
    textCase: (transform === 'uppercase' ? 'UPPER' : transform === 'lowercase' ? 'LOWER' : transform === 'capitalize' ? 'TITLE' : 'ORIGINAL') as TextNode['textCase'],
    textDecoration: (decoration.includes('underline') ? 'UNDERLINE' : decoration.includes('line-through') ? 'STRIKETHROUGH' : 'NONE') as TextNode['textDecoration'],
  };
}

function normalizeWhitespace(text: string, whiteSpace: string): string {
  if (whiteSpace.startsWith('pre')) {
    // pre-line colapsa espacios pero respeta saltos de línea.
    return whiteSpace === 'pre-line' ? text.replace(/[ \t]+/g, ' ') : text;
  }
  return text.replace(/\s+/g, ' ');
}

/** Agrupa los rectángulos de un Range por línea visual. */
function lineRects(range: Range): DOMRect[] {
  const lines: DOMRect[] = [];
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width === 0 || rect.height === 0) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.top - rect.top) < rect.height / 2) {
      const left = Math.min(last.left, rect.left);
      const right = Math.max(last.right, rect.right);
      lines[lines.length - 1] = new DOMRect(left, Math.min(last.top, rect.top), right - left, Math.max(last.height, rect.height));
    } else {
      lines.push(rect);
    }
  }
  return lines;
}

function makeText(
  characters: string,
  rect: { x: number; y: number; width: number; height: number },
  lineCount: number,
  base: ReturnType<typeof textStyle>,
  wrap: boolean,
): TextNode {
  // El rectángulo del Range cubre la caja de contenido de la fuente; Figma
  // posiciona la caja de línea completa, así que centramos el line-height.
  const lineBox = base.lineHeight ?? rect.height / lineCount;
  const contentHeight = rect.height / lineCount;
  const y = rect.y - (lineBox - contentHeight) / 2;
  return {
    type: 'TEXT',
    name: characters.trim().slice(0, 40) || 'Texto',
    x: rect.x,
    y,
    width: wrap ? rect.width + 1 : rect.width,
    height: lineBox * lineCount,
    characters,
    wrap,
    ...base,
  };
}

function captureTextNode(textNode: Text, parentStyle: CSSStyleDeclaration, ctx: Ctx): TextNode[] {
  const raw = textNode.textContent ?? '';
  if (!raw.trim()) return [];

  const range = document.createRange();
  range.selectNodeContents(textNode);
  const lines = lineRects(range);
  if (lines.length === 0) return [];

  const base = textStyle(parentStyle);
  const whiteSpace = parentStyle.whiteSpace;
  const text = normalizeWhitespace(raw, whiteSpace).trim();

  if (lines.length === 1) {
    return [makeText(text, absRect(lines[0], ctx), 1, base, false)];
  }

  // Párrafo "limpio": todas las líneas empiezan en el mismo x (o están centradas
  // en el mismo eje). Lo mantenemos como una sola capa editable con ancho fijo.
  const bounds = range.getBoundingClientRect();
  const sameLeft = lines.every((l) => Math.abs(l.left - lines[0].left) < 2);
  const center = (l: DOMRect) => l.left + l.width / 2;
  const sameCenter = base.textAlign === 'CENTER' && lines.every((l) => Math.abs(center(l) - center(lines[0])) < 2);
  if (sameLeft || sameCenter || whiteSpace.startsWith('pre')) {
    return [makeText(text, absRect(bounds, ctx), lines.length, base, true)];
  }

  // Texto en línea que empieza a mitad de renglón (p. ej. un <a> dentro de un
  // <p>): una capa por línea, midiendo palabra por palabra.
  const result: TextNode[] = [];
  const wordRe = /\S+\s*/g;
  let lineText = '';
  let lineTop: number | null = null;
  let lineRect: DOMRect | null = null;
  const flush = () => {
    if (lineRect && lineText.trim()) {
      result.push(makeText(normalizeWhitespace(lineText, whiteSpace).trim(), absRect(lineRect, ctx), 1, base, false));
    }
  };
  let match: RegExpExecArray | null;
  while ((match = wordRe.exec(raw))) {
    const wordRange = document.createRange();
    wordRange.setStart(textNode, match.index);
    wordRange.setEnd(textNode, match.index + match[0].trimEnd().length);
    const rect = wordRange.getBoundingClientRect();
    if (rect.width === 0) {
      lineText += match[0];
      continue;
    }
    if (lineTop === null || Math.abs(rect.top - lineTop) >= rect.height / 2) {
      flush();
      lineText = '';
      lineTop = rect.top;
      lineRect = rect;
    } else if (lineRect) {
      const left = Math.min(lineRect.left, rect.left);
      const right = Math.max(lineRect.right, rect.right);
      lineRect = new DOMRect(left, Math.min(lineRect.top, rect.top), right - left, Math.max(lineRect.height, rect.height));
    }
    lineText += match[0];
  }
  flush();
  return result;
}

// --- SVG en línea ----------------------------------------------------------

const SVG_PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'fill-opacity', 'stroke-opacity', 'stop-color', 'stop-opacity'];

function serializeSvg(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Los estilos de la página no viajan a Figma: fijamos los valores calculados.
  const originals = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const clones = [clone, ...Array.from(clone.querySelectorAll('*'))];
  originals.forEach((orig, i) => {
    const target = clones[i];
    if (!target) return;
    const style = getComputedStyle(orig);
    for (const prop of SVG_PAINT_PROPS) {
      const value = style.getPropertyValue(prop);
      if (value && !(prop.startsWith('stop') && orig.tagName !== 'stop')) target.setAttribute(prop, value);
    }
  });

  // <use href="#icono"> que apunta a un sprite externo: copiamos el símbolo.
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  for (const use of Array.from(clone.querySelectorAll('use'))) {
    const href = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
    if (!href.startsWith('#') || clone.querySelector(href)) continue;
    const referenced = document.querySelector(href);
    if (referenced) defs.appendChild(referenced.cloneNode(true));
  }
  if (defs.childNodes.length) clone.insertBefore(defs, clone.firstChild);

  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new XMLSerializer().serializeToString(clone);
}

// --- Elementos -------------------------------------------------------------

function replacedContentPaints(el: Element, style: CSSStyleDeclaration): Paint[] {
  const fit = style.objectFit === 'contain' || style.objectFit === 'scale-down' ? 'FIT' : 'FILL';
  if (el instanceof HTMLImageElement) {
    const src = el.currentSrc || el.src;
    return src ? [{ type: 'IMAGE', src, scaleMode: fit }] : [];
  }
  if (el instanceof HTMLCanvasElement) {
    try {
      return [{ type: 'IMAGE', src: el.toDataURL('image/png'), scaleMode: 'FILL' }];
    } catch {
      return []; // canvas "contaminado" por contenido de otro origen
    }
  }
  if (el instanceof HTMLVideoElement && el.poster) {
    return [{ type: 'IMAGE', src: el.poster, scaleMode: fit }];
  }
  if (el instanceof HTMLIFrameElement || el instanceof HTMLVideoElement) {
    return [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85, a: 1 } }];
  }
  return [];
}

function formControlText(el: Element, style: CSSStyleDeclaration, frame: FrameNode): TextNode | null {
  let value = '';
  let placeholder = false;
  if (el instanceof HTMLInputElement) {
    if (['checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(el.type)) return null;
    value = el.type === 'password' ? '•'.repeat(el.value.length) : el.value;
    if (!value && el.placeholder) { value = el.placeholder; placeholder = true; }
  } else if (el instanceof HTMLTextAreaElement) {
    value = el.value || el.placeholder;
    placeholder = !el.value;
  } else if (el instanceof HTMLSelectElement) {
    value = el.selectedOptions[0]?.textContent ?? '';
  }
  if (!value.trim()) return null;

  const base = textStyle(style);
  if (placeholder) base.color = { ...base.color, a: base.color.a * 0.55 };
  const padLeft = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  const lineBox = base.lineHeight ?? base.fontSize * 1.2;
  return {
    type: 'TEXT',
    name: value.slice(0, 40),
    x: frame.x + padLeft,
    y: el instanceof HTMLTextAreaElement
      ? frame.y + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)
      : frame.y + (frame.height - lineBox) / 2,
    width: frame.width - padLeft * 2,
    height: lineBox,
    characters: value,
    wrap: el instanceof HTMLTextAreaElement,
    ...base,
  };
}

function childNodesOf(el: Element): Node[] {
  const source: ParentNode = el.shadowRoot ?? el;
  const nodes: Node[] = [];
  for (const child of Array.from(source.childNodes)) {
    if (child instanceof HTMLSlotElement) nodes.push(...child.assignedNodes({ flatten: true }));
    else nodes.push(child);
  }
  return nodes;
}

function walkElement(el: Element, ctx: Ctx, isRoot = false): CapturedNode[] {
  if (SKIP_TAGS.has(el.tagName) || ctx.options.ignore?.includes(el)) return [];
  if (++ctx.count > MAX_NODES) return [];

  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return [];
  const opacity = parseFloat(style.opacity);
  if (opacity === 0) return [];

  const rect = absRect(el.getBoundingClientRect(), ctx);

  if (el instanceof SVGSVGElement) {
    if (rect.width === 0 || rect.height === 0) return [];
    const node: SvgNode = { type: 'SVG', name: nameFor(el), ...rect, svg: serializeSvg(el, rect.width, rect.height) };
    if (opacity < 1) node.opacity = opacity;
    return [node];
  }
  if (el instanceof SVGElement) return []; // SVG suelto fuera de <svg>

  const fills = isRoot ? [] : [...backgroundPaints(style), ...replacedContentPaints(el, style)];
  const border = borderOf(style);
  const shadows = shadowsOf(style);
  const clip = !isRoot && [style.overflowX, style.overflowY].some((o) => o !== 'visible');

  const frame: FrameNode = {
    type: 'FRAME',
    name: nameFor(el),
    ...rect,
    fills,
    clip,
    children: [],
  };
  if (border) frame.border = border;
  if (shadows) frame.shadows = shadows;
  const radii = radiiOf(style, rect.width, rect.height);
  if (radii) frame.radii = radii;
  if (opacity < 1) frame.opacity = opacity;

  if (clip && (rect.width === 0 || rect.height === 0)) return [];

  const control = formControlText(el, style, frame);
  if (control) frame.children.push(control);

  if (!(el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    for (const child of childNodesOf(el)) {
      if (child.nodeType === Node.TEXT_NODE) {
        frame.children.push(...captureTextNode(child as Text, style, ctx));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        frame.children.push(...walkElement(child as Element, ctx));
      }
    }
  }

  const hasVisual = fills.length > 0 || !!border || !!shadows || clip || opacity < 1 || !!control;
  if (!isRoot && ctx.options.flatten && !hasVisual) return frame.children;
  if (!hasVisual && frame.children.length === 0) return [];
  return [frame];
}

export function capturePage(options: WalkOptions): FrameNode {
  const ctx: Ctx = { options, scrollX: window.scrollX, scrollY: window.scrollY, count: 0 };
  const doc = document.documentElement;

  // El fondo de la página se propaga desde <html> o <body> al lienzo.
  const htmlBg = backgroundPaints(getComputedStyle(doc));
  const bodyBg = document.body ? backgroundPaints(getComputedStyle(document.body)) : [];
  const canvasFills = htmlBg.length ? htmlBg : bodyBg.length ? bodyBg : [{ type: 'SOLID' as const, color: { r: 1, g: 1, b: 1, a: 1 } }];

  const root: FrameNode = {
    type: 'FRAME',
    name: document.title || location.hostname,
    x: 0,
    y: 0,
    width: doc.clientWidth,
    height: Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0),
    fills: canvasFills,
    clip: true,
    children: [],
  };

  for (const child of childNodesOf(doc)) {
    if (!(child instanceof Element)) continue;
    // <body> sin su fondo (ya está en el lienzo), pero con sus bordes/sombras.
    const isBody = child === document.body;
    for (const node of walkElement(child, ctx, isBody)) {
      if (node.type === 'FRAME' && isBody) root.children.push(...node.children);
      else root.children.push(node);
    }
  }
  return root;
}
