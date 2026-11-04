// Punto de entrada del capturador. Se ejecuta en la página (bookmarklet o consola):
// captura el DOM, incrusta las imágenes y muestra un panel para copiar/descargar el JSON.
import { SCHEMA_VERSION, type Capture } from '../shared/schema';
import { inlineImages } from './images';
import { capturePage } from './walk';

declare global {
  interface Window {
    __htmlToFigma?: { capture: typeof capture };
  }
}

export async function capture(options: { flatten?: boolean; inlineImages?: boolean } = {}): Promise<Capture> {
  const root = capturePage({ flatten: options.flatten ?? true, ignore: panel ? [panel] : [] });
  if (options.inlineImages ?? true) await inlineImages(root, (done, total) => setStatus(`Procesando imágenes ${done}/${total}…`));
  return {
    version: SCHEMA_VERSION,
    url: location.href,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    capturedAt: new Date().toISOString(),
    root,
  };
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

function showPanel() {
  panel?.remove();
  panel = document.createElement('div');
  panel.setAttribute('data-html-to-figma', '');
  const shadow = panel.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .box { position: fixed; z-index: 2147483647; top: 16px; right: 16px; width: 280px;
        font: 13px/1.4 system-ui, -apple-system, sans-serif; color: #1e1e1e; background: #fff;
        border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.24); padding: 14px; }
      h1 { font-size: 14px; margin: 0 0 6px; }
      p { margin: 0 0 10px; color: #555; }
      .row { display: flex; gap: 8px; }
      button { flex: 1; font: inherit; border: 0; border-radius: 8px; padding: 8px; cursor: pointer;
        background: #0d99ff; color: #fff; }
      button.secondary { background: #eee; color: #1e1e1e; flex: 0 0 auto; }
      button:disabled { opacity: .5; cursor: default; }
    </style>
    <div class="box" role="dialog" aria-label="HTML a Figma">
      <h1>HTML → Figma</h1>
      <p class="status">Capturando…</p>
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

async function run() {
  const shadow = showPanel();
  // Esperar un frame para que el panel se pinte antes del recorrido (que bloquea).
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    const result = await capture();
    const json = JSON.stringify(result);
    const sizeMb = (json.length / 1024 / 1024).toFixed(1);
    setStatus(`${countNodes(result)} capas · ${sizeMb} MB. Pégalo en el plugin de Figma.`);

    const copyBtn = shadow.querySelector<HTMLButtonElement>('.copy')!;
    const downloadBtn = shadow.querySelector<HTMLButtonElement>('.download')!;
    copyBtn.disabled = downloadBtn.disabled = false;

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
      a.download = `${(location.hostname || 'pagina').replace(/\W+/g, '-')}.figma.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  } catch (error) {
    setStatus(`Error: ${(error as Error).message}`);
    console.error('[html-to-figma]', error);
  }
}

window.__htmlToFigma = { capture };
if (!(document.currentScript as HTMLScriptElement | null)?.dataset.noAutorun) void run();
