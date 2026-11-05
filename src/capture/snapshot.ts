// Copia de la página tal como está ahora (menús abiertos, pestañas elegidas, carruseles movidos,
// valores de formularios…) para volver a pintarla a otro ancho sin recargarla. Recargar la URL
// reinicia los scripts y pierde ese estado; la copia lo conserva porque guarda el DOM actual.
//
// Lo que el HTML no guarda por sí solo se pasa a atributos: valores de formularios, estilos
// insertados por CSS-in-JS (CSSOM), hojas adoptadas, Shadow DOM abierto, el contenido de los
// <canvas>, el desplazamiento de los contenedores y los <dialog>/popover abiertos.
// Los scripts no se copian: la copia es una foto fija.

const SKIP = 'script, noscript, [data-mozo]';
const NO_VALUE_INPUTS = new Set(['password', 'file']);

function sheetText(sheet: CSSStyleSheet | null | undefined): string | null {
  try {
    return sheet ? Array.from(sheet.cssRules, (r) => r.cssText).join('\n') : null;
  } catch {
    return null; // hoja de otro origen: se queda el texto original
  }
}

function adoptedStyle(root: Document | ShadowRoot, doc: Document): HTMLStyleElement | null {
  const text = (root.adoptedStyleSheets ?? []).map(sheetText).filter(Boolean).join('\n');
  if (!text) return null;
  const style = doc.createElement('style');
  style.textContent = text;
  return style;
}

/** Recorre a la vez los elementos originales y su copia (mismo orden) y guarda su estado. */
function transfer(originals: Element[], copies: Element[]) {
  originals.forEach((orig, i) => {
    const copy = copies[i];
    if (!copy) return;
    const tag = orig.tagName;

    if (tag === 'INPUT') {
      const input = orig as HTMLInputElement;
      if (input.type === 'checkbox' || input.type === 'radio') copy.toggleAttribute('checked', input.checked);
      else if (!NO_VALUE_INPUTS.has(input.type)) copy.setAttribute('value', input.value);
    } else if (tag === 'TEXTAREA') {
      copy.textContent = (orig as HTMLTextAreaElement).value;
    } else if (tag === 'OPTION') {
      copy.toggleAttribute('selected', (orig as HTMLOptionElement).selected);
    } else if (tag === 'STYLE') {
      const text = sheetText((orig as HTMLStyleElement).sheet);
      if (text !== null) copy.textContent = text;
    } else if (tag === 'CANVAS') {
      try {
        const img = copy.ownerDocument.createElement('img');
        for (const attr of Array.from(orig.attributes)) img.setAttribute(attr.name, attr.value);
        img.src = (orig as HTMLCanvasElement).toDataURL();
        copy.replaceWith(img);
      } catch {
        // canvas "contaminado" por imágenes de otro origen: se queda vacío
      }
    }

    if (orig !== orig.ownerDocument.documentElement && orig !== orig.ownerDocument.body && (orig.scrollLeft || orig.scrollTop)) {
      copy.setAttribute('data-mozo-scroll', `${orig.scrollLeft},${orig.scrollTop}`);
    }
    try {
      if (orig.matches(':modal')) {
        copy.removeAttribute('open'); // showModal() falla si ya está abierto
        copy.setAttribute('data-mozo-modal', '');
      } else if (orig.matches(':popover-open')) {
        copy.setAttribute('data-mozo-popover', '');
      }
    } catch {
      // navegador sin :modal / :popover-open
    }

    const shadow = orig.shadowRoot;
    if (shadow) copy.prepend(shadowTemplate(shadow, copy.ownerDocument));
  });
}

/** Shadow DOM abierto como <template shadowrootmode> (Shadow DOM declarativo). */
function shadowTemplate(shadow: ShadowRoot, doc: Document): HTMLTemplateElement {
  const container = doc.createElement('div');
  for (const child of Array.from(shadow.childNodes)) container.append(child.cloneNode(true));
  transfer(Array.from(shadow.querySelectorAll('*')), Array.from(container.querySelectorAll('*')));
  container.querySelectorAll(SKIP).forEach((el) => el.remove());
  const adopted = adoptedStyle(shadow, doc);
  if (adopted) container.prepend(adopted);
  const template = doc.createElement('template');
  template.setAttribute('shadowrootmode', 'open');
  template.innerHTML = container.innerHTML;
  return template;
}

/** HTML de la página en su estado actual, listo para un iframe con srcdoc. */
export function snapshotPage(): string {
  const html = document.documentElement;
  const copy = html.cloneNode(true) as HTMLElement;
  transfer([html, ...Array.from(html.querySelectorAll('*'))], [copy, ...Array.from(copy.querySelectorAll('*'))]);
  copy.querySelectorAll(SKIP).forEach((el) => el.remove());

  const head = copy.querySelector('head') ?? copy.insertBefore(document.createElement('head'), copy.firstChild);
  const adopted = adoptedStyle(document, document);
  if (adopted) head.append(adopted);
  // Las URL relativas se resuelven contra la página original, no contra about:srcdoc.
  head.querySelectorAll('base').forEach((el) => el.remove());
  const base = document.createElement('base');
  base.href = document.baseURI;
  head.prepend(base);

  return (document.compatMode === 'CSS1Compat' ? '<!doctype html>' : '') + copy.outerHTML;
}

/** Aplica en la copia ya cargada lo que no se puede expresar en HTML. */
export function restoreSnapshotState(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-mozo-scroll]'))) {
    const [left, top] = el.getAttribute('data-mozo-scroll')!.split(',').map(Number);
    el.scrollLeft = left;
    el.scrollTop = top;
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLDialogElement>('dialog[data-mozo-modal]'))) {
    try {
      el.showModal();
    } catch {
      el.setAttribute('open', '');
    }
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-mozo-popover]'))) {
    try {
      el.showPopover();
    } catch {
      // sin API de popover
    }
  }
}
