// Formato intermedio entre el script de captura (navegador) y el plugin de Figma.
// Todas las coordenadas son absolutas respecto al documento (px CSS).

export const SCHEMA_VERSION = 1;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RGBA {
  r: number; // 0..1
  g: number;
  b: number;
  a: number;
}

export interface SolidPaint {
  type: 'SOLID';
  color: RGBA;
}

export interface GradientStop {
  position: number; // 0..1
  color: RGBA;
}

export interface LinearGradientPaint {
  type: 'LINEAR_GRADIENT';
  angle: number; // grados CSS (0 = hacia arriba, 90 = hacia la derecha)
  stops: GradientStop[];
}

export interface ImagePaint {
  type: 'IMAGE';
  src: string; // data: URL (preferido) o URL remota
  scaleMode: 'FILL' | 'FIT' | 'TILE' | 'CROP';
}

export type Paint = SolidPaint | LinearGradientPaint | ImagePaint;

export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: RGBA;
}

export interface Border {
  top: number;
  right: number;
  bottom: number;
  left: number;
  color: RGBA;
}

export interface Radii {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

interface BaseNode {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
}

export interface FrameNode extends BaseNode {
  type: 'FRAME';
  fills: Paint[]; // en orden de pintado de Figma (el último queda arriba)
  border?: Border;
  radii?: Radii;
  shadows?: Shadow[];
  clip: boolean;
  children: CapturedNode[];
}

export interface TextNode extends BaseNode {
  type: 'TEXT';
  characters: string;
  fontFamilies: string[]; // lista de font-family en orden de preferencia
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  lineHeight: number | null; // px; null = auto
  letterSpacing: number; // px
  color: RGBA;
  textAlign: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textCase: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  textDecoration: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  wrap: boolean; // true = ancho fijo con salto de línea; false = una sola línea
  /**
   * Rellenos del texto cuando el elemento usa `background-clip: text` (texto con
   * degradado o imagen). Sustituyen a `color`. Las pinturas están definidas sobre
   * `fillBox` (la caja del elemento que declara el fondo), no sobre el texto.
   */
  fills?: Paint[];
  fillBox?: Box;
}

export interface SvgNode extends BaseNode {
  type: 'SVG';
  svg: string;
}

export type CapturedNode = FrameNode | TextNode | SvgNode;

export interface Capture {
  version: typeof SCHEMA_VERSION;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  capturedAt: string;
  root: FrameNode;
}
