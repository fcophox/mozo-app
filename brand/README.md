# Marca de Mozō

Todo lo gráfico de Mozō vive en esta carpeta. Los archivos de `logo/` y los colores de
`brand.json` se inyectan solos al ejecutar `npm run build`. El resto son imágenes que subes a
mano a Figma Community o a GitHub.

## 1. Se usan en el build (prioridad alta)

| Archivo | Formato y tamaño | Dónde aparece |
| --- | --- | --- |
| `logo/mozo-symbol.svg` | SVG cuadrado (`viewBox="0 0 24 24"` o similar), sin texto | Cabecera del plugin (24 px), panel del capturador (20 px) y favicon de la página de instalación |
| `logo/mozo-logo.svg` | SVG horizontal (isotipo + "Mozō") | Página de instalación del marcador (48 px de alto) |
| `brand.json` → `colors.primary` / `colors.onPrimary` | Hex | Botones del plugin, del panel y de la página de instalación |

Recomendaciones para los SVG:

- Convierte el texto a contornos: el "ō" con macrón no puede depender de una fuente instalada.
- Usa colores planos en `fill`, sin `<style>` ni clases. El SVG se incrusta en páginas ajenas y en
  la interfaz de Figma, y unos estilos externos podrían chocar con los de esas páginas.
- Si quieres que el isotipo se adapte al tema claro u oscuro, usa `fill="currentColor"`.
- No incluyas `width` ni `height` fijos: el tamaño lo pone el CSS.

Si falta algún SVG, el build avisa y muestra el nombre en texto.

## 2. Figma Community (al publicar el plugin)

Se suben en el formulario de publicación de Figma, no en el código.

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `figma-community/icon-128.png` | 128 × 128 px, PNG | Icono del plugin en el menú de plugins y en Community |
| `figma-community/cover-1920x960.png` | 1920 × 960 px, PNG/JPG | Portada y miniatura de la ficha |
| `figma-community/carousel/01.png` … `09.png` | 1920 × 1080 px, PNG/JPG (también admite vídeo/GIF) | Capturas del flujo: página web → plugin → capas en Figma |

Textos que también pide el formulario: nombre (**Mozō**), tagline (está en `brand.json`),
descripción, etiquetas y un contacto de soporte.

> Comprueba los tamaños en el formulario de Figma cuando publiques: Figma los cambia de vez en
> cuando.

## 3. GitHub y README (opcional)

| Archivo | Tamaño | Uso |
| --- | --- | --- |
| `github/social-preview-1280x640.png` | 1280 × 640 px, PNG/JPG, < 1 MB | Imagen al compartir el repo (Settings → General → Social preview) |
| `github/readme-banner.png` | ~1600 × 400 px | Cabecera del README principal |

## Checklist

- [ ] `logo/mozo-symbol.svg`
- [ ] `logo/mozo-logo.svg`
- [ ] Colores definitivos en `brand.json`
- [ ] `figma-community/icon-128.png`
- [ ] `figma-community/cover-1920x960.png`
- [ ] `figma-community/carousel/` (de 3 a 5 capturas)
- [ ] `github/social-preview-1280x640.png`
- [ ] `github/readme-banner.png` (opcional)
