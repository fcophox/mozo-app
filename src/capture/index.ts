// Punto de entrada del capturador. Se ejecuta en la página (bookmarklet o consola):
// captura el DOM, incrusta las imágenes y muestra un panel para copiar/descargar el JSON.
import { SCHEMA_VERSION, type Capture } from '../shared/schema';
import { resolveBackgroundBoxes } from './background';
import { inlineImages } from './images';
import { materializePseudoElements } from './pseudo';
import { setRealm, win } from './realm';
import { restoreSnapshotState, snapshotPage } from './snapshot';
import { capturePage } from './walk';

// Identidad de marca, inyectada por build.mjs desde brand/.
declare const MOZO_MARK: string;
declare const MOZO_PRIMARY: string;
declare const MOZO_ON_PRIMARY: string;

declare global {
  interface Window {
    __mozo?: { capture: typeof capture };
  }
}

export interface CaptureOptions {
  flatten?: boolean;
  inlineImages?: boolean;
  /** Pinta la página en un iframe de este tamaño y captura ese render. */
  viewport?: { width: number; height: number };
  /**
   * Con viewport: true (por defecto) copia la página tal como está ahora (menús abiertos,
   * pestañas, carruseles…); false la vuelve a cargar desde la URL, con sus scripts.
   */
  preserveState?: boolean;
}

export async function capture(options: CaptureOptions = {}): Promise<Capture> {
  if (!options.viewport) return captureWindow(window, options);
  // Con el panel abierto, el iframe se queda en él como vista previa; si no, se quita al terminar.
  const stage = panel?.isConnected ? panel.shadowRoot?.querySelector('.stage') ?? null : null;
  const frame = await loadFrame(options.viewport, stage, options.preserveState ?? true);
  try {
    return await captureWindow(frame.contentWindow as Window & typeof globalThis, options);
  } finally {
    if (!stage) frame.remove();
  }
}

async function captureWindow(target: Window & typeof globalThis, options: CaptureOptions): Promise<Capture> {
  setRealm(target);
  try {
    // Los pseudo-elementos se convierten temporalmente en elementos reales para medirlos.
    const restore = materializePseudoElements();
    let root;
    try {
      root = capturePage({ flatten: options.flatten ?? true, ignore: panel && target === window ? [panel] : [] });
    } finally {
      restore();
    }
    await resolveBackgroundBoxes(root);
    if (options.inlineImages ?? true) await inlineImages(root, (done, total) => setStatus(`Procesando imágenes ${done}/${total}…`));
    return {
      version: SCHEMA_VERSION,
      url: location.href,
      title: win.document.title,
      viewport: { width: win.innerWidth, height: win.innerHeight },
      capturedAt: new Date().toISOString(),
      root,
    };
  } finally {
    setRealm(window);
  }
}

// --- Captura a otro tamaño ----------------------------------------------------
// Un bookmarklet no puede cambiar el tamaño de la ventana, así que la página se pinta en un
// iframe del mismo origen con el ancho elegido: las media queries, los vw/vh y el layout
// responden a ese ancho. Por defecto el iframe recibe una copia del estado actual (snapshot.ts),
// sin scripts; si no, se recarga la URL. sandbox sin allow-top-navigation impide que un script
// "anti-iframe" saque al usuario de la página.

const FRAME_TIMEOUT_MS = 30000;

function loadFrame(size: { width: number; height: number }, stage: Element | null, preserveState: boolean): Promise<HTMLIFrameElement> {
  stage?.querySelector('iframe')?.remove();
  const frame = document.createElement('iframe');
  // La copia no lleva scripts: sin allow-scripts tampoco se ejecutan los atributos on*.
  frame.setAttribute('sandbox', preserveState ? 'allow-same-origin' : 'allow-scripts allow-same-origin allow-forms');
  frame.width = String(size.width);
  frame.height = String(size.height);
  frame.style.cssText = `width:${size.width}px;height:${size.height}px;border:0;background:#fff;`
    + (stage ? '' : 'position:fixed;left:-100000px;top:0;visibility:hidden;');

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('La página tardó demasiado en cargar a ese tamaño.')), FRAME_TIMEOUT_MS);
    frame.addEventListener('load', async () => {
      clearTimeout(timer);
      let doc: Document | null = null;
      try {
        doc = frame.contentDocument;
      } catch {
        // acceso bloqueado
      }
      if (!doc || doc.URL === 'about:blank') {
        frame.remove();
        reject(new Error('Esta web no permite cargarse en un iframe. Cambia el ancho de la ventana (o usa el modo dispositivo de DevTools) y elige «Actual».'));
        return;
      }
      // Sin barras de desplazamiento: el frame mide exactamente el ancho elegido.
      const style = doc.createElement('style');
      style.textContent = 'html{scrollbar-width:none}::-webkit-scrollbar{display:none}';
      doc.head?.appendChild(style);
      await doc.fonts?.ready.catch(() => undefined);
      // Margen para animaciones de entrada e imágenes que se cargan al aparecer.
      await new Promise((r) => setTimeout(r, 800));
      // Desplazamientos y diálogos de la copia, ya con las imágenes y fuentes en su sitio.
      if (preserveState) restoreSnapshotState(doc);
      // Las animaciones de entrada (fade/blur-in) se adelantan a su estado final; las infinitas se dejan.
      for (const animation of doc.getAnimations?.() ?? []) {
        try {
          if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
        } catch {
          // animaciones que no se pueden terminar
        }
      }
      resolve(frame);
    }, { once: true });
    if (preserveState) frame.srcdoc = snapshotPage();
    else frame.src = location.href;
    (stage ?? document.documentElement).appendChild(frame);
    if (stage) fitStage(stage as HTMLElement, size);
  });
}

/** Escala la vista previa del iframe para que quepa en la pantalla. */
function fitStage(stage: HTMLElement, size: { width: number; height: number }) {
  const scale = Math.max(0.1, Math.min(1, (window.innerWidth - 344) / size.width, (window.innerHeight - 32) / size.height));
  stage.style.width = `${size.width * scale}px`;
  stage.style.height = `${size.height * scale}px`;
  const frame = stage.querySelector('iframe');
  if (frame) frame.style.transform = `scale(${scale})`;
  stage.hidden = false;
}

// --- Panel -----------------------------------------------------------------

let panel: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;

function setStatus(text: string) {
  if (statusEl) statusEl.textContent = text;
}

function countNodes(capture: Capture): number {
  let n = 0;
  const visit = (node: Capture['root'] | Capture['root']['children'][number]) => {
    n++;
    if (node.type === 'FRAME') node.children.forEach(visit);
  };
  visit(capture.root);
  return n;
}

/** Tamaños de captura. `null` = la ventana tal como está. */
const SIZES: { id: string; label: string; detail: string; viewport: { width: number; height: number } | null }[] = [
  { id: 'actual', label: 'Actual', detail: '', viewport: null },
  { id: 'desktop', label: 'Desktop', detail: '1440 × 900', viewport: { width: 1440, height: 900 } },
  { id: 'iphone13', label: 'iPhone 13', detail: '390 × 844', viewport: { width: 390, height: 844 } },
  { id: 'ipad129', label: 'iPad Pro 12,9″', detail: '1024 × 1366', viewport: { width: 1024, height: 1366 } },
];

function showPanel() {
  panel?.remove();
  panel = document.createElement('div');
  panel.setAttribute('data-mozo', '');
  const shadow = panel.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 280px;
        font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #1e1e1e; background: #fff;
        border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.24); padding: 14px; }
      h1 { display: flex; align-items: center; gap: 8px; font-size: 14px; margin: 0 0 6px; }
      h1 .mozo-mark { width: 20px; height: 20px; flex: none; border-radius: 5px; }
      p { margin: 0 0 10px; color: #555; }
      .label { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: #1e1e1e; }
      .sizes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
      .sizes button { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left;
        background: #f2f2f2; color: #1e1e1e; box-shadow: inset 0 0 0 1px transparent; }
      .sizes button small { font-size: 11px; color: #777; }
      .sizes button[aria-pressed="true"] { background: #fff; box-shadow: inset 0 0 0 2px ${MOZO_PRIMARY}; }
      .keep { display: flex; align-items: flex-start; gap: 6px; margin: -4px 0 12px; font-size: 12px; color: #555; cursor: pointer; }
      .keep input { margin: 2px 0 0; accent-color: ${MOZO_PRIMARY}; }
      .row { display: flex; gap: 8px; }
      button { flex: 1; font: inherit; border: 0; border-radius: 8px; padding: 8px; cursor: pointer;
        background: ${MOZO_PRIMARY}; color: ${MOZO_ON_PRIMARY}; }
      button.secondary { background: #eee; color: #1e1e1e; flex: 0 0 auto; }
      button:disabled { opacity: .5; cursor: default; }
      .stage { position: fixed; z-index: 2147483646; top: 16px; left: 16px; overflow: hidden;
        border-radius: 8px; background: #fff; box-shadow: 0 0 0 100vmax rgba(0,0,0,.55), 0 8px 32px rgba(0,0,0,.4); }
      .stage[hidden] { display: none; }
      .stage iframe { display: block; transform-origin: 0 0; pointer-events: none; }
    </style>
    <div class="stage" hidden></div>
    <div class="box" role="dialog" aria-label="Mozō">
      <h1>${MOZO_MARK}Mozō</h1>
      <p class="label">Tamaño del frame</p>
      <div class="sizes">
        ${SIZES.map((s) => `<button type="button" data-size="${s.id}" aria-pressed="false"><span>${s.label}</span><small>${
          s.viewport ? s.detail : `${window.innerWidth} × ${window.innerHeight}`
        }</small></button>`).join('')}
      </div>
      <label class="keep"><input type="checkbox" class="preserve" checked />
        <span>Conservar el estado actual (menús, pestañas, carruseles…)</span></label>
      <p class="status">Elige un tamaño para capturar la página.</p>
      <div class="row">
        <button class="copy" disabled>Copiar JSON</button>
        <button class="download" disabled>Descargar</button>
        <button class="close secondary" aria-label="Cerrar">✕</button>
      </div>
    </div>`;
  document.documentElement.appendChild(panel);
  statusEl = shadow.querySelector('.status');
  shadow.querySelector('.close')!.addEventListener('click', () => panel?.remove());
  return shadow;
}

function run() {
  const shadow = showPanel();
  const copyBtn = shadow.querySelector<HTMLButtonElement>('.copy')!;
  const downloadBtn = shadow.querySelector<HTMLButtonElement>('.download')!;
  const sizeBtns = Array.from(shadow.querySelectorAll<HTMLButtonElement>('[data-size]'));
  const stage = shadow.querySelector<HTMLElement>('.stage')!;
  const preserve = shadow.querySelector<HTMLInputElement>('.preserve')!;
  let json = '';
  let busy = false;

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(json);
      copyBtn.textContent = '¡Copiado!';
    } catch {
      setStatus('No se pudo copiar (permiso del portapapeles). Usa Descargar.');
    }
  });
  downloadBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `${(location.hostname || 'pagina').replace(/\W+/g, '-')}.mozo.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  for (const btn of sizeBtns) {
    btn.addEventListener('click', async () => {
      if (busy) return;
      const size = SIZES.find((s) => s.id === btn.dataset.size)!;
      busy = true;
      json = '';
      copyBtn.disabled = downloadBtn.disabled = true;
      copyBtn.textContent = 'Copiar JSON';
      for (const b of sizeBtns) {
        b.setAttribute('aria-pressed', String(b === btn));
        b.disabled = true;
      }
      if (!size.viewport) {
        stage.hidden = true;
        stage.replaceChildren();
      }
      setStatus(size.viewport ? `Pintando la página a ${size.viewport.width} px…` : 'Capturando…');
      // Esperar un frame para que el panel se pinte antes del recorrido (que bloquea).
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      try {
        const result = await capture({ viewport: size.viewport ?? undefined, preserveState: preserve.checked });
        json = JSON.stringify(result);
        const sizeMb = (json.length / 1024 / 1024).toFixed(1);
        setStatus(`${result.root.width} px · ${countNodes(result)} capas · ${sizeMb} MB. Pégalo en el plugin de Figma.`);
        copyBtn.disabled = downloadBtn.disabled = false;
      } catch (error) {
        stage.hidden = true;
        stage.replaceChildren();
        setStatus(`Error: ${(error as Error).message}`);
        console.error('[mozo]', error);
      } finally {
        busy = false;
        for (const b of sizeBtns) b.disabled = false;
      }
    });
  }
}

window.__mozo = { capture };
if (!(document.currentScript as HTMLScriptElement | null)?.dataset.noAutorun) run();
