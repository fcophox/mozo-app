// Bundle del importador sin UI, para ejecutarlo en Figma desde scripts externos
// (p. ej. pruebas a través del conector de Figma). Expone globalThis.__mozoImport.
import { importCapture } from './importer';

(globalThis as unknown as { __mozoImport: typeof importCapture }).__mozoImport = importCapture;
