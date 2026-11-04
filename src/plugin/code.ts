// Hilo principal del plugin: conecta la UI con el importador.
import type { Capture } from '../shared/schema';
import { cancelImport, importCapture } from './importer';

figma.showUI(__html__, { width: 360, height: 440, themeColors: true });

type UiMessage = { type: 'import'; capture: Capture } | { type: 'cancel' };

const post = (msg: { type: 'progress' | 'done' | 'error'; text: string }) => figma.ui.postMessage(msg);

figma.ui.onmessage = async (msg: UiMessage) => {
  if (msg.type === 'cancel') {
    cancelImport();
    return;
  }
  try {
    const result = await importCapture(msg.capture, (text) => post({ type: 'progress', text }));
    const notes = [`${result.layers} capas creadas.`];
    if (result.failedImages) notes.push(`${result.failedImages} imágenes no se pudieron cargar (marcadas en gris).`);
    if (result.substitutedFonts.length) notes.push(`Fuentes sustituidas: ${result.substitutedFonts.join(', ')}.`);
    post({ type: 'done', text: notes.join(' ') });
    figma.notify(`Página importada: ${msg.capture.title || msg.capture.url}`);
  } catch (error) {
    post({ type: 'error', text: (error as Error).message });
  }
};
