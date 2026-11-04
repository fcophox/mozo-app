// Resolución de fuentes CSS (familia + peso + itálica) a fuentes disponibles en Figma.
import type { TextStyle } from '../shared/schema';

type FontRequest = Pick<TextStyle, 'fontFamilies' | 'fontWeight' | 'italic'>;

const GENERIC_FALLBACKS: Record<string, string[]> = {
  'sans-serif': ['Inter'],
  'system-ui': ['SF Pro Text', 'Inter'],
  '-apple-system': ['SF Pro Text', 'Inter'],
  'blinkmacsystemfont': ['SF Pro Text', 'Inter'],
  'ui-sans-serif': ['Inter'],
  'serif': ['Georgia', 'Times New Roman', 'Noto Serif', 'Roboto Serif'],
  'ui-serif': ['Georgia', 'Noto Serif'],
  'monospace': ['Roboto Mono', 'Menlo', 'Courier New'],
  'ui-monospace': ['SF Mono', 'Roboto Mono', 'Menlo'],
};
const LAST_RESORT = 'Inter';

// Orden importa: "extrabold" antes que "bold", "semibold" antes que "bold"...
const WEIGHT_KEYWORDS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/extra\s*light|ultra\s*light/, 200],
  [/light/, 300],
  [/medium/, 500],
  [/semi\s*bold|demi\s*bold/, 600],
  [/extra\s*bold|ultra\s*bold/, 800],
  [/bold/, 700],
  [/black|heavy/, 900],
];

function styleWeight(style: string): number {
  const s = style.toLowerCase();
  for (const [re, weight] of WEIGHT_KEYWORDS) if (re.test(s)) return weight;
  return 400;
}

function isItalic(style: string) {
  return /italic|oblique/i.test(style);
}

export class FontResolver {
  private families = new Map<string, FontName[]>();
  private resolved = new Map<string, FontName>();

  async init() {
    for (const font of await figma.listAvailableFontsAsync()) {
      const key = font.fontName.family.toLowerCase();
      const list = this.families.get(key) ?? [];
      list.push(font.fontName);
      this.families.set(key, list);
    }
  }

  private candidates(families: string[]): string[] {
    const out: string[] = [];
    for (const family of families) {
      const generic = GENERIC_FALLBACKS[family.toLowerCase()];
      out.push(...(generic ?? [family]));
    }
    out.push(LAST_RESORT);
    return out;
  }

  private pick(family: string, weight: number, italic: boolean): FontName | null {
    const styles = this.families.get(family.toLowerCase());
    if (!styles?.length) return null;
    let best = styles[0];
    let bestScore = Infinity;
    for (const font of styles) {
      const score = Math.abs(styleWeight(font.style) - weight) + (isItalic(font.style) === italic ? 0 : 1000);
      if (score < bestScore) {
        best = font;
        bestScore = score;
      }
    }
    return best;
  }

  key(text: FontRequest) {
    return `${text.fontFamilies.join(',')}|${text.fontWeight}|${text.italic}`;
  }

  resolve(text: FontRequest): FontName {
    const key = this.key(text);
    const cached = this.resolved.get(key);
    if (cached) return cached;
    let font: FontName = { family: LAST_RESORT, style: 'Regular' };
    for (const family of this.candidates(text.fontFamilies)) {
      const found = this.pick(family, text.fontWeight, text.italic);
      if (found) {
        font = found;
        break;
      }
    }
    this.resolved.set(key, font);
    return font;
  }

  /** Carga todas las fuentes necesarias; devuelve las familias que se sustituyeron. */
  async loadAll(texts: FontRequest[]): Promise<string[]> {
    const fonts = new Map<string, FontName>();
    const substituted = new Set<string>();
    for (const text of texts) {
      const font = this.resolve(text);
      fonts.set(`${font.family}|${font.style}`, font);
      const wanted = text.fontFamilies.find((f) => !GENERIC_FALLBACKS[f.toLowerCase()]);
      if (wanted && wanted.toLowerCase() !== font.family.toLowerCase()) substituted.add(`${wanted} → ${font.family}`);
    }
    await Promise.all([...fonts.values()].map((f) => figma.loadFontAsync(f)));
    return [...substituted];
  }
}
