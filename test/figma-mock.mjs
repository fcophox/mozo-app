// `figma` simulado: lo justo de la Plugin API para ejecutar el importador en Node.
export function createFigmaMock() {
  const created = [];
  const messages = [];
  let onmessage;

  class Node {
    constructor(type) {
      Object.assign(this, { type, children: [], x: 0, y: 0, width: 100, height: 100, name: '', id: `0:${created.length}` });
      created.push(this);
    }
    resize(w, h) {
      if (!(w > 0 && h > 0)) throw new Error(`resize inválido ${w}x${h}`);
      this.width = w;
      this.height = h;
    }
    appendChild(n) {
      if (n.parent) n.parent.children = n.parent.children.filter((c) => c !== n);
      this.children.push(n);
      n.parent = this;
    }
    remove() {
      this.removed = true;
      if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    }
    findChild(fn) { return this.children.find(fn) ?? null; }
    findAll(fn) { return this.children.flatMap((c) => [...(fn(c) ? [c] : []), ...c.findAll(fn)]); }
    findOne(fn) { return this.findAll(fn)[0] ?? null; }
    setPluginData() {}
  }
  class Text extends Node {
    set characters(v) {
      if (!this.fontName) throw new Error('fuente no asignada antes de characters');
      this._c = v;
      this.width = v.length * 8;
      this.height = 20;
    }
    get characters() { return this._c; }
  }
  for (const method of ['setRangeFontName', 'setRangeFontSize', 'setRangeLetterSpacing', 'setRangeTextCase', 'setRangeTextDecoration', 'setRangeFills']) {
    Text.prototype[method] = function (start, end, value) {
      if (!(start >= 0 && end <= this._c.length && start < end)) throw new Error(`${method}: rango inválido ${start}-${end}`);
      (this.ranges ??= []).push([method, start, end, value]);
    };
  }

  const page = new Node('PAGE');
  Object.defineProperty(page, 'selection', { set() {}, get: () => [] });
  const figma = {
    showUI() {},
    ui: { postMessage: (m) => messages.push(m), set onmessage(fn) { onmessage = fn; } },
    createFrame: () => { const n = new Node('FRAME'); page.appendChild(n); return n; },
    createText: () => { const n = new Text('TEXT'); page.appendChild(n); return n; },
    createRectangle: () => { const n = new Node('RECTANGLE'); page.appendChild(n); return n; },
    createNodeFromSvg: (svg) => {
      if (!svg.startsWith('<svg')) throw new Error('svg inválido');
      const n = new Node('FRAME');
      page.appendChild(n);
      return n;
    },
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
  return { figma, page, created, messages, getOnMessage: () => onmessage };
}
