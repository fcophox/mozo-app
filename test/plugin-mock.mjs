// Ejecuta plugin/dist/code.js contra un `figma` simulado para detectar errores
// de ejecución sin abrir Figma. Uso: node test/plugin-mock.mjs [captura.json]
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const text = (over) => ({
  type: 'TEXT', name: 't', x: 10, y: 10, width: 100, height: 20, characters: 'Hola', wrap: false,
  fontFamilies: ['Helvetica Neue', 'sans-serif'], fontSize: 16, fontWeight: 700, italic: false, lineHeight: 24,
  letterSpacing: 0, color: { r: 0, g: 0, b: 0, a: 1 }, textAlign: 'CENTER', textCase: 'UPPER', textDecoration: 'UNDERLINE', ...over,
});
const sample = {
  version: 1, url: 'http://localhost/test', title: 'Prueba', viewport: { width: 800, height: 600 }, capturedAt: '',
  root: {
    type: 'FRAME', name: 'root', x: 0, y: 0, width: 800, height: 600, clip: true,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    children: [
      {
        type: 'FRAME', name: 'card', x: 20, y: 20, width: 300, height: 200, clip: true, opacity: 0.8,
        fills: [
          { type: 'LINEAR_GRADIENT', angle: 135, stops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 0.5 } }] },
          { type: 'IMAGE', src: PIXEL_PNG, scaleMode: 'FILL' },
          { type: 'IMAGE', src: 'https://example.invalid/x.png', scaleMode: 'FIT' },
        ],
        border: { top: 1, right: 2, bottom: 1, left: 2, color: { r: 0, g: 0, b: 0, a: 1 } },
        radii: { topLeft: 8, topRight: 8, bottomRight: 0, bottomLeft: 0 },
        shadows: [{ inset: false, x: 0, y: 4, blur: 12, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.1 } }],
        children: [text({ x: 30, y: 30 }), text({ wrap: true, textAlign: 'LEFT', fontFamilies: ['Nope Font'], italic: true, lineHeight: null })],
      },
      { type: 'SVG', name: 'icon', x: 400, y: 20, width: 24, height: 24, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      { type: 'SVG', name: 'bad', x: 400, y: 60, width: 24, height: 24, svg: '<<roto' },
    ],
  },
};

// --- figma simulado ---------------------------------------------------------
const created = [];
class Node {
  constructor(type) { Object.assign(this, { type, children: [], x: 0, y: 0, width: 100, height: 100, id: String(created.length) }); created.push(this); }
  resize(w, h) { if (!(w > 0 && h > 0)) throw new Error(`resize inválido ${w}x${h}`); this.width = w; this.height = h; }
  appendChild(n) { this.children.push(n); n.parent = this; }
  remove() { this.removed = true; }
  setPluginData() {}
}
class Text extends Node {
  set characters(v) { if (!this.fontName) throw new Error('fuente no asignada antes de characters'); this._c = v; this.width = v.length * 8; this.height = 20; }
  get characters() { return this._c; }
}
const page = new Node('PAGE');
const messages = [];
let onmessage;
const figma = {
  showUI() {},
  ui: { postMessage: (m) => messages.push(m), set onmessage(fn) { onmessage = fn; } },
  createFrame: () => { const n = new Node('FRAME'); page.appendChild(n); return n; },
  createText: () => new Text('TEXT'),
  createRectangle: () => new Node('RECTANGLE'),
  createNodeFromSvg: (svg) => { if (!svg.startsWith('<svg')) throw new Error('svg inválido'); return new Node('FRAME'); },
  createImage: (bytes) => { if (!(bytes instanceof Uint8Array)) throw new Error('bytes'); return { hash: 'h1' }; },
  createImageAsync: async () => { throw new Error('red'); },
  base64Decode: (s) => new Uint8Array(Buffer.from(s, 'base64')),
  listAvailableFontsAsync: async () => ['Regular', 'Bold', 'Italic', 'Bold Italic'].flatMap((style) =>
    ['Inter', 'Helvetica Neue'].map((family) => ({ fontName: { family, style } }))),
  loadFontAsync: async () => {},
  notify: () => {},
  viewport: { center: { x: 0, y: 0 }, scrollAndZoomIntoView() {} },
  currentPage: page,
};
Object.defineProperty(page, 'selection', { set() {}, get: () => [] });

const code = await readFile(new URL('../plugin/dist/code.js', import.meta.url), 'utf8');
vm.runInNewContext(code, { figma, __html__: '', setTimeout, console });

const input = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : sample;
await onmessage({ type: 'import', capture: input });

const last = messages.at(-1);
console.log(messages.map((m) => `${m.type}: ${m.text}`).join('\n'));
const texts = created.filter((n) => n.type === 'TEXT');
console.log('fuentes usadas:', [...new Set(texts.map((t) => `${t.fontName.family} ${t.fontName.style}`))].join(', '));
if (last?.type !== 'done') process.exit(1);
