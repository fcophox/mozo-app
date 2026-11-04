// Convierte una captura (JSON) en nodos de Figma. No depende de la UI del plugin,
// así que también puede ejecutarse fuera de él (p. ej. desde pruebas).
import type { Box, Capture, CapturedNode, FrameNode as CapturedFrame, ImagePaint, Paint as CapturedPaint, RGBA, TextNode as CapturedText, TextStyle } from '../shared/schema';
import { SCHEMA_VERSION } from '../shared/schema';
import { FontResolver } from './fonts';

export interface ImportResult {
  root: FrameNode;
  layers: number;
  failedImages: number;
  substitutedFonts: string[];
}

let onProgress: (text: string) => void = () => {};

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

// --- Imágenes diferidas ------------------------------------------------------
// En importaciones por bloques (scripts externos con límite de tamaño) las imágenes
// llegan como `mozo-asset:<clave>` y se suben después sobre el nodo indicado.

export interface AssetTarget {
  key: string;
  nodeId: string;
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP';
}

const ASSET_PREFIX = 'mozo-asset:';
let assetTargets: AssetTarget[] = [];
const isDeferredImage = (p: CapturedPaint): p is Extract<CapturedPaint, { type: 'IMAGE' }> =>
  p.type === 'IMAGE' && p.src.startsWith(ASSET_PREFIX);

async function tick() {
  if (++created % 250 === 0) {
    onProgress(`Creando capas… ${created}`);
    await new Promise((r) => setTimeout(r, 0));
  }
  if (cancelled) throw new Error('Importación cancelada');
}

/**
 * Imagen de fondo con posición/tamaño propios: un rectángulo en su sitio, dentro de
 * un frame que la recorta a la caja del elemento cuando se sale de ella.
 */
async function buildBoxedImage(paint: ImagePaint, owner: CapturedFrame): Promise<SceneNode> {
  const box = paint.box as Box;
  const rect = figma.createRectangle();
  rect.name = 'Imagen de fondo';
  rect.resize(Math.max(box.width, 0.01), Math.max(box.height, 0.01));
  if (paint.src.startsWith(ASSET_PREFIX)) {
    rect.fills = [PLACEHOLDER];
    assetTargets.push({ key: paint.src.slice(ASSET_PREFIX.length), nodeId: rect.id, scaleMode: 'FILL' });
  } else {
    rect.fills = [await toFigmaPaint({ type: 'IMAGE', src: paint.src, scaleMode: 'FILL' })];
  }
  const inside = box.x >= owner.x && box.y >= owner.y &&
    box.x + box.width <= owner.x + owner.width && box.y + box.height <= owner.y + owner.height;
  if (inside || owner.clip) {
    rect.x = box.x - owner.x;
    rect.y = box.y - owner.y;
    return rect;
  }
  const clipper = figma.createFrame();
  clipper.name = 'Fondo';
  clipper.fills = [];
  clipper.clipsContent = true;
  clipper.resize(Math.max(owner.width, 0.01), Math.max(owner.height, 0.01));
  if (owner.radii) {
    clipper.topLeftRadius = owner.radii.topLeft;
    clipper.topRightRadius = owner.radii.topRight;
    clipper.bottomRightRadius = owner.radii.bottomRight;
    clipper.bottomLeftRadius = owner.radii.bottomLeft;
  }
  clipper.appendChild(rect);
  rect.x = box.x - owner.x;
  rect.y = box.y - owner.y;
  return clipper;
}

async function buildFrame(data: CapturedFrame, origin: Origin, fonts: FontResolver): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = data.name;
  frame.x = data.x - origin.x;
  frame.y = data.y - origin.y;
  frame.resize(Math.max(data.width, 0.01), Math.max(data.height, 0.01));
  const boxed: ImagePaint[] = [];
  const deferred: ImagePaint[] = [];
  const regular: CapturedPaint[] = [];
  for (const p of data.fills) {
    if (p.type === 'IMAGE' && p.box) boxed.push(p);
    else if (isDeferredImage(p)) deferred.push(p);
    else regular.push(p);
  }
  frame.fills = await Promise.all(regular.map((p) => toFigmaPaint(p)));
  for (const paint of boxed) frame.appendChild(await buildBoxedImage(paint, data));
  if (deferred.length) {
    if (regular.length === 0 && data.children.length === 0 && deferred.length === 1) {
      // Un <img> típico: la imagen irá directamente en el frame.
      frame.fills = [PLACEHOLDER];
      assetTargets.push({ key: deferred[0].src.slice(ASSET_PREFIX.length), nodeId: frame.id, scaleMode: deferred[0].scaleMode });
    } else {
      // Fondo con más capas o con hijos: la imagen va en un rectángulo bajo los hijos.
      for (const paint of deferred) {
        const rect = figma.createRectangle();
        rect.name = 'Imagen';
        rect.resize(Math.max(data.width, 0.01), Math.max(data.height, 0.01));
        rect.fills = [PLACEHOLDER];
        if (data.radii) {
          rect.topLeftRadius = data.radii.topLeft;
          rect.topRightRadius = data.radii.topRight;
          rect.bottomRightRadius = data.radii.bottomRight;
          rect.bottomLeftRadius = data.radii.bottomLeft;
        }
        frame.appendChild(rect);
        assetTargets.push({ key: paint.src.slice(ASSET_PREFIX.length), nodeId: rect.id, scaleMode: paint.scaleMode });
      }
    }
  }
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

  // Las pinturas de texto con degradado/imagen están definidas sobre la caja del
  // elemento que declara el fondo: las reproyectamos sobre la caja final del texto.
  const bounds = { x: text.x + origin.x, y: text.y + origin.y, width: text.width, height: text.height };
  text.fills = await textPaints(data, bounds);

  for (const run of data.runs ?? []) {
    const { start, end } = run;
    text.setRangeFontName(start, end, fonts.resolve(run));
    text.setRangeFontSize(start, end, Math.max(1, run.fontSize));
    text.setRangeLetterSpacing(start, end, { value: run.letterSpacing, unit: 'PIXELS' });
    text.setRangeTextCase(start, end, run.textCase);
    text.setRangeTextDecoration(start, end, run.textDecoration);
    text.setRangeFills(start, end, await textPaints(run, bounds));
  }
  return text;
}

async function textPaints(style: Pick<TextStyle, 'color' | 'fills' | 'fillBox'>, bounds: Box): Promise<Paint[]> {
  if (style.fills?.length && style.fillBox) {
    const mapping = boxMapping(bounds, style.fillBox);
    return Promise.all(style.fills.map((p) => toFigmaPaint(p, mapping)));
  }
  return [{ type: 'SOLID', color: rgb(style.color), opacity: style.color.a }];
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

function collectTexts(node: CapturedNode, out: Pick<TextStyle, 'fontFamilies' | 'fontWeight' | 'italic'>[]) {
  if (node.type === 'TEXT') out.push(node, ...(node.runs ?? []));
  else if (node.type === 'FRAME') for (const child of node.children) collectTexts(child, out);
}

// --- Importación -----------------------------------------------------------

export function cancelImport() {
  cancelled = true;
}

export async function importCapture(capture: Capture, progress: (text: string) => void = () => {}): Promise<ImportResult> {
  onProgress = progress;
  if (capture?.version !== SCHEMA_VERSION || !capture.root) {
    throw new Error('El JSON no es una captura válida de Mozō (o es de otra versión).');
  }
  created = 0;
  failedImages = 0;
  cancelled = false;
  imageCache.clear();

  onProgress('Cargando fuentes…');
  const fonts = new FontResolver();
  await fonts.init();
  const texts: Pick<TextStyle, 'fontFamilies' | 'fontWeight' | 'italic'>[] = [];
  collectTexts(capture.root, texts);
  const substituted = await fonts.loadAll(texts);

  onProgress('Creando capas…');
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
  try {
    root.setPluginData('sourceUrl', capture.url);
  } catch {
    // No disponible en algunos entornos de ejecución (p. ej. scripts remotos).
  }

  const center = figma.viewport.center;
  root.x = Math.round(center.x - root.width / 2);
  root.y = Math.round(center.y - Math.min(root.height, capture.viewport.height) / 2);
  figma.currentPage.appendChild(root);
  figma.currentPage.selection = [root];
  figma.viewport.scrollAndZoomIntoView([root]);

  return { root, layers: created, failedImages, substitutedFonts: substituted };
}

// --- Importación por bloques -------------------------------------------------
// Para entornos que limitan el tamaño de cada ejecución: se crea primero el frame
// raíz y luego cada bloque añade nodos a un frame ya existente, localizado por su
// clave temporal ⟦k⟧ en el nombre. `finalizeChunks` quita esas claves al final.

const keyTag = (key: string) => ` ⟦${key}⟧`;

function findByKey(rootName: string, key: string | null): FrameNode {
  const root = figma.currentPage.findChild((n) => n.type === 'FRAME' && n.name === rootName) as FrameNode | null;
  if (!root) throw new Error(`No encuentro el frame raíz "${rootName}"`);
  if (!key) return root;
  const node = root.findOne((n) => n.type === 'FRAME' && n.name.endsWith(keyTag(key))) as FrameNode | null;
  if (!node) throw new Error(`No encuentro el frame con clave ${key}`);
  return node;
}

export async function createChunkRoot(rootName: string, root: CapturedFrame): Promise<string> {
  const fonts = new FontResolver();
  await fonts.init();
  const frame = await buildFrame({ ...root, children: [] }, { x: 0, y: 0 }, fonts);
  frame.name = rootName;
  // A la derecha de lo que ya hay en la página.
  const right = Math.max(0, ...figma.currentPage.children.filter((n) => n !== frame).map((n) => n.x + n.width));
  frame.x = right + 200;
  frame.y = 0;
  return frame.id;
}

export interface ChunkItem {
  node: CapturedNode;
  /** Si se indica, el frame se crea sin hijos y se etiqueta con esta clave. */
  shellKey?: string;
}

export async function importChunk(rootName: string, parentKey: string | null, origin: Origin, items: ChunkItem[]) {
  created = 0;
  cancelled = false;
  assetTargets = [];
  imageCache.clear();
  const parent = findByKey(rootName, parentKey);

  const fonts = new FontResolver();
  await fonts.init();
  const texts: Pick<TextStyle, 'fontFamilies' | 'fontWeight' | 'italic'>[] = [];
  for (const item of items) collectTexts(item.node, texts);
  await fonts.loadAll(texts);

  for (const item of items) {
    const data = item.shellKey && item.node.type === 'FRAME' ? { ...item.node, children: [] } : item.node;
    const node = await buildNode(data, origin, fonts);
    if (!node) continue;
    if (item.shellKey) node.name += keyTag(item.shellKey);
    parent.appendChild(node);
  }
  return { created, assets: assetTargets };
}

export function finalizeChunks(rootName: string) {
  const root = findByKey(rootName, null);
  const tagged = root.findAll((n) => / ⟦[^⟧]+⟧$/.test(n.name));
  for (const node of tagged) node.name = node.name.replace(/ ⟦[^⟧]+⟧$/, '');
  return { untagged: tagged.length };
}
