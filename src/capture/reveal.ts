// Recorre la página antes de capturarla. Muchas webs (Framer, Webflow, AOS, GSAP…) ocultan
// los bloques con opacidad 0 hasta que entran en pantalla, y cargan las imágenes al aparecer:
// sin este recorrido, todo lo que aún no se ha visto se perdería.

const STEP_DELAY_MS = 120;
const SETTLE_MS = 600;
const MAX_STEPS = 200; // tope para páginas con scroll infinito

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function revealPage(target: Window, onProgress?: (fraction: number) => void): Promise<void> {
  const doc = target.document.documentElement;
  const startX = target.scrollX;
  const startY = target.scrollY;
  const scrollTo = (y: number) => target.scrollTo({ left: startX, top: y, behavior: 'instant' as ScrollBehavior });

  const step = Math.max(200, Math.round(target.innerHeight / 2));
  for (let y = 0, i = 0; i < MAX_STEPS; i++, y += step) {
    const max = Math.max(0, doc.scrollHeight - target.innerHeight);
    scrollTo(Math.min(y, max));
    onProgress?.(max ? Math.min(1, y / max) : 1);
    await wait(STEP_DELAY_MS);
    if (y >= max) break;
  }
  scrollTo(startY);
  await wait(SETTLE_MS);
  finishEntryAnimations(target.document);
}

/** Adelanta las animaciones de entrada (fade/blur-in) a su estado final; las infinitas se dejan. */
export function finishEntryAnimations(doc: Document): void {
  for (const animation of doc.getAnimations?.() ?? []) {
    try {
      if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
    } catch {
      // animaciones que no se pueden terminar
    }
  }
}
