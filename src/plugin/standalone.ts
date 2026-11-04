// Bundle del importador sin UI, para ejecutarlo en Figma desde scripts externos
// (p. ej. pruebas a través del conector de Figma). Expone globalThis.__mozo.
import { inflateSync, strFromU8 } from 'fflate';
import { createChunkRoot, finalizeChunks, importCapture, importChunk } from './importer';

/** Decodifica un bloque generado por scripts/figma-chunks.mjs (JSON → deflate → base64). */
function unpack<T>(base64: string): T {
  return JSON.parse(strFromU8(inflateSync(figma.base64Decode(base64))));
}

(globalThis as unknown as { __mozo: unknown }).__mozo = { importCapture, createChunkRoot, importChunk, finalizeChunks, unpack };
