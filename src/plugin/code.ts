// Hilo principal del plugin: convierte una captura (JSON) en nodos de Figma.
import type { Box, Capture, CapturedNode, FrameNode as CapturedFrame, Paint as CapturedPaint, RGBA, TextNode as CapturedText } from '../shared/schema';
import { SCHEMA_VERSION } from '../shared/schema';
import { FontResolver } from './fonts';

figma.showUI(__html__, { width: 360, height: 440, themeColors: true });

type UiMessage = { type: 'import'; capture: Capture } | { type: 'cancel' };

const post = (msg: { type: 'progress' | 'done' | 'error'; text: string }) => figma.ui.postMessage(msg);

// --- Pinturas --------------------------------------------------------------

const rgb = (c: RGBA): RGB => ({ r: c.r, g: c.g, b: c.b });
const PLACEHOLDER: SolidPaint = { type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } };

const imageCache = new Map<string, Promise<Image | null>>();
let failedImages = 0;

function loadImage(src: string): Promise<Image | null> {
  let pending = imageCache.get(src);
  if (!pending) {
    pending = (async () => {
      try {
        const base64 = src.match(/^data:image\/[\w.+-]+;base64,(.*)$/);
        if (base64) return figma.createImage(figma.base64Decode(base64[1]));
        return await figma.createImageAsync(src);
      } catch {
        failedImages++;
        return null;
      }
    })();
    imageCache.set(src, pending);
  }
  return pending;
}

/** Matriz de Figma para un ángulo CSS (0deg = hacia arriba, sentido horario). */
function gradientTransform(angleDeg: number): Transform {
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const len = Math.abs(sin) + Math.abs(cos);
  return [
    [sin / len, -cos / len, 0.5 - (0.5 * (sin - cos)) / len],
    [cos / len, sin / len, 0.5 - (0.5 * (cos + sin)) / len],
  ];
}

/**
 * Matriz que lleva el espacio unitario de `node` al espacio unitario de `box`.
 * Sirve para pintar sobre una capa un degradado definido en otra caja (p. ej. el
 * texto de un elemento con `background-clip: text`, partido en varias líneas).
 */
function boxMapping(node: Box, box: Box): Transform {
  const w = box.width || 1;
  const h = box.height || 1;
  return [
    [node.width / w, 0, (node.x - box.x) / w],
    [0, node.height / h, (node.y - box.y) / h],
  ];
}

/** Composición afín a ∘ b (primero b, luego a). */
function compose(a: Transform, b: Transform): Transform {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1], a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1], a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2]],
  ];
}

async function toFigmaPaint(paint: CapturedPaint, mapping?: Transform): Promise<Paint> {
  switch (paint.type) {
    case 'SOLID':
      return { type: 'SOLID', color: rgb(paint.color), opacity: paint.color.a };
    case 'LINEAR_GRADIENT': {
      const transform = gradientTransform(paint.angle);
      return {
        type: 'GRADIENT_LINEAR',
        gradientTransform: mapping ? compose(transform, mapping) : transform,
        gradientStops: paint.stops.map((s) => ({ position: s.position, color: { ...rgb(s.color), a: s.color.a } })),
      };
    }
    case 'IMAGE': {
      const image = await loadImage(paint.src);
      return image ? { type: 'IMAGE', imageHash: image.hash, scaleMode: paint.scaleMode } : PLACEHOLDER;
    }
  }
}

// --- Nodos -----------------------------------------------------------------

interface Origin { x: number; y: number }

let created = 0;
let cancelled = false;

async function tick() {
  if (++created % 250 === 0) {
    post({ type: 'progress', text: `Creando capas… ${created}` });
    await new Promise((r) => setTimeout(r, 0));
  }
  if (cancelled) throw new Error('Importación cancelada');
}

async function buildFrame(data: CapturedFrame, origin: Origin, fonts: FontResolver): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = data.name;
  frame.x = data.x - origin.x;
  frame.y = data.y - origin.y;
  frame.resize(Math.max(data.width, 0.01), Math.max(data.height, 0.01));
  frame.fills = await Promise.all(data.fills.map((p) => toFigmaPaint(p)));
  frame.clipsContent = data.clip;
  if (data.opacity !== undefined) frame.opacity = data.opacity;

  if (data.radii) {
    frame.topLeftRadius = data.radii.topLeft;
    frame.topRightRadius = data.radii.topRight;
    frame.bottomRightRadius = data.radii.bottomRight;
    frame.bottomLeftRadius = data.radii.bottomLeft;
  }

  if (data.border) {
    const b = data.border;
    frame.strokes = [{ type: 'SOLID', color: rgb(b.color), opacity: b.color.a }];
    frame.strokeAlign = 'INSIDE'; // los bordes CSS ocupan el border-box
    if (b.top === b.right && b.right === b.bottom && b.bottom === b.left) {
      frame.strokeWeight = b.top;
    } else {
      frame.strokeTopWeight = b.top;
      frame.strokeRightWeight = b.right;
      frame.strokeBottomWeight = b.bottom;
      frame.strokeLeftWeight = b.left;
    }
  }

  if (data.shadows) {
    // CSS pinta la primera sombra encima; Figma apila en orden inverso.
    frame.effects = [...data.shadows].reverse().map((s): Effect => ({
      type: s.inset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      color: { ...rgb(s.color), a: s.color.a },
      offset: { x: s.x, y: s.y },
      radius: s.blur,
      spread: s.spread,
      visible: true,
      blendMode: 'NORMAL',
    }) as Effect);
  }

  for (const child of data.children) {
    const node = await buildNode(child, data, fonts);
    if (node) frame.appendChild(node);
  }
  return frame;
}

async function buildText(data: CapturedText, origin: Origin, fonts: FontResolver): Promise<TextNode | null> {
  if (!data.characters) return null;
  const text = figma.createText();
  text.fontName = fonts.resolve(data);
  text.characters = data.characters;
  text.name = data.name;
  text.fontSize = Math.max(1, data.fontSize);
  text.lineHeight = data.lineHeight ? { value: data.lineHeight, unit: 'PIXELS' } : { unit: 'AUTO' };
  text.letterSpacing = { value: data.letterSpacing, unit: 'PIXELS' };
  text.textCase = data.textCase;
  text.textDecoration = data.textDecoration;
  if (data.opacity !== undefined) text.opacity = data.opacity;

  const x = data.x - origin.x;
  text.y = data.y - origin.y;
  if (data.wrap) {
    text.textAlignHorizontal = data.textAlign;
    text.textAutoResize = 'HEIGHT';
    text.resize(Math.max(data.width, 1), text.height);
    text.x = x;
  } else {
    // Una sola línea: ajustamos al contenido y conservamos el anclaje visual,
    // por si la fuente sustituta es más ancha o estrecha que la original.
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
    if (data.textAlign === 'CENTER') text.x = x + (data.width - text.width) / 2;
    else if (data.textAlign === 'RIGHT') text.x = x + data.width - text.width;
    else text.x = x;
  }

  if (data.fills?.length && data.fillBox) {
    // Texto con degradado/imagen: la pintura se define sobre la caja del elemento
    // que declara el fondo, así que la reproyectamos sobre la caja final del texto.
    const box = data.fillBox;
    const bounds = { x: text.x + origin.x, y: text.y + origin.y, width: text.width, height: text.height };
    text.fills = await Promise.all(data.fills.map((p) => toFigmaPaint(p, boxMapping(bounds, box))));
  } else {
    text.fills = [{ type: 'SOLID', color: rgb(data.color), opacity: data.color.a }];
  }
  return text;
}

function buildSvg(data: Extract<CapturedNode, { type: 'SVG' }>, origin: Origin): SceneNode {
  let node: FrameNode | RectangleNode;
  try {
    node = figma.createNodeFromSvg(data.svg);
  } catch {
    node = figma.createRectangle();
    node.fills = [PLACEHOLDER];
  }
  node.name = data.name;
  node.x = data.x - origin.x;
  node.y = data.y - origin.y;
  node.resize(Math.max(data.width, 0.01), Math.max(data.height, 0.01));
  if (data.opacity !== undefined) node.opacity = data.opacity;
  return node;
}

async function buildNode(data: CapturedNode, origin: Origin, fonts: FontResolver): Promise<SceneNode | null> {
  await tick();
  switch (data.type) {
    case 'FRAME': return buildFrame(data, origin, fonts);
    case 'TEXT': return buildText(data, origin, fonts);
    case 'SVG': return buildSvg(data, origin);
  }
}

function collectTexts(node: CapturedNode, out: CapturedText[]) {
  if (node.type === 'TEXT') out.push(node);
  else if (node.type === 'FRAME') for (const child of node.children) collectTexts(child, out);
}

// --- Importación -----------------------------------------------------------

async function importCapture(capture: Capture) {
  if (capture?.version !== SCHEMA_VERSION || !capture.root) {
    throw new Error('El JSON no es una captura válida de Mozō (o es de otra versión).');
  }
  created = 0;
  failedImages = 0;
  cancelled = false;
  imageCache.clear();

  post({ type: 'progress', text: 'Cargando fuentes…' });
  const fonts = new FontResolver();
  await fonts.init();
  const texts: CapturedText[] = [];
  collectTexts(capture.root, texts);
  const substituted = await fonts.loadAll(texts);

  post({ type: 'progress', text: 'Creando capas…' });
  const before = new Set(figma.currentPage.children.map((n) => n.id));
  let root: FrameNode;
  try {
    root = await buildFrame(capture.root, { x: 0, y: 0 }, fonts);
  } catch (error) {
    // No dejar una importación a medias en el lienzo.
    for (const node of figma.currentPage.children) if (!before.has(node.id)) node.remove();
    throw error;
  }
  root.name = `${capture.title || capture.url} — ${capture.root.width}px`;
  root.setPluginData('sourceUrl', capture.url);

  const center = figma.viewport.center;
  root.x = Math.round(center.x - root.width / 2);
  root.y = Math.round(center.y - Math.min(root.height, capture.viewport.height) / 2);
  figma.currentPage.appendChild(root);
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);

  const notes = [`${created} capas creadas.`];
  if (failedImages) notes.push(`${failedImages} imágenes no se pudieron cargar (marcadas en gris).`);
  if (substituted.length) notes.push(`Fuentes sustituidas: ${substituted.join(', ')}.`);
  post({ type: 'done', text: notes.join(' ') });
  figma.notify(`Página importada: ${capture.title || capture.url}`);
}

figma.ui.onmessage = async (msg: UiMessage) => {
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  try {
    await importCapture(msg.capture);
  } catch (error) {
    post({ type: 'error', text: (error as Error).message });
  }
};
