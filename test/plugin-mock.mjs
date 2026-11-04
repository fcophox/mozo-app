// Ejecuta plugin/dist/code.js contra un `figma` simulado para detectar errores
// de ejecución sin abrir Figma. Uso: node test/plugin-mock.mjs [captura.json]
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createFigmaMock } from './figma-mock.mjs';

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
        children: [
          text({ x: 30, y: 30 }),
          text({ wrap: true, textAlign: 'LEFT', fontFamilies: ['Nope Font'], italic: true, lineHeight: null }),
          // Párrafo con estilos mixtos: "Hola " normal + "mundo" en itálica azul subrayada.
          text({
            name: 'mixto', characters: 'Hola mundo', wrap: true,
            runs: [{ start: 5, end: 10, fontFamilies: ['Helvetica Neue'], fontSize: 16, fontWeight: 400, italic: true, letterSpacing: 0,
              color: { r: 0, g: 0, b: 1, a: 1 }, textCase: 'ORIGINAL', textDecoration: 'UNDERLINE' }],
          }),
          // background-clip: text — degradado definido sobre una caja más ancha que el texto.
          text({
            name: 'grad', x: 120, y: 100, textAlign: 'LEFT', characters: 'Degradado',
            fills: [{ type: 'LINEAR_GRADIENT', angle: 90, stops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] }],
            fillBox: { x: 20, y: 100, width: 400, height: 40 },
          }),
        ],
      },
      { type: 'SVG', name: 'icon', x: 400, y: 20, width: 24, height: 24, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
      { type: 'SVG', name: 'bad', x: 400, y: 60, width: 24, height: 24, svg: '<<roto' },
    ],
  },
};

// --- figma simulado ---------------------------------------------------------
const { figma, created, messages, getOnMessage } = createFigmaMock();

const code = await readFile(new URL('../plugin/dist/code.js', import.meta.url), 'utf8');
vm.runInNewContext(code, { figma, __html__: '', setTimeout, console });

const input = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : sample;
await getOnMessage()({ type: 'import', capture: input });

const last = messages.at(-1);
console.log(messages.map((m) => `${m.type}: ${m.text}`).join('\n'));
const texts = created.filter((n) => n.type === 'TEXT');
console.log('fuentes usadas:', [...new Set(texts.map((t) => `${t.fontName.family} ${t.fontName.style}`))].join(', '));
if (last?.type !== 'done') process.exit(1);

const mixed = texts.find((t) => t.name === 'mixto');
console.log('tramos aplicados:', mixed.ranges.map(([m, a, b]) => `${m}[${a},${b})`).join(' '));
if (mixed.ranges.length !== 6) process.exit(1);

// El borde izquierdo del texto (x=120) cae al 25 % de la caja (20..420): t debe ser 0.25.
if (!process.argv[2]) {
  const grad = texts.find((t) => t.name === 'grad');
  const [[a, b, c]] = grad.fills[0].gradientTransform;
  const tAt = (px, py) => a * px + b * py + c;
  const expectLeft = (120 - 20) / 400;
  const expectRight = (120 + grad.width - 20) / 400;
  const ok = Math.abs(tAt(0, 0.5) - expectLeft) < 1e-9 && Math.abs(tAt(1, 0.5) - expectRight) < 1e-9;
  console.log(`degradado en texto: t=${tAt(0, 0.5).toFixed(3)}..${tAt(1, 0.5).toFixed(3)} (esperado ${expectLeft.toFixed(3)}..${expectRight.toFixed(3)})`);
  if (!ok) process.exit(1);
}
