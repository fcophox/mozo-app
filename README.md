# Mozō

Convierte páginas web en capas editables de Figma: frames con fondos, degradados, bordes,
radios y sombras; texto real y editable; imágenes y SVG.

Funciona en dos pasos:

1. **Capturador** (`dist/capture.js`): se ejecuta en la página abierta en el navegador, recorre
   el DOM renderizado con sus estilos calculados y genera un JSON (`src/shared/schema.ts`).
2. **Plugin de Figma** (`plugin/`): lee ese JSON y crea los nodos.

## Instalación

```bash
npm install
npm run build
```

### Capturador (bookmarklet)

Abre `dist/install.html` en el navegador y arrastra el botón **Mozō** a la barra de marcadores.

Si la página bloquea el bookmarklet (CSP), pega el contenido de `dist/capture.js` en la consola de
DevTools: hace exactamente lo mismo.

### Plugin

En Figma Desktop: **Plugins → Development → Import plugin from manifest…** y elige
`plugin/manifest.json`.

## Uso

1. Abre la página y ajusta el ancho de la ventana: será el ancho del frame en Figma.
2. Pulsa el marcador **Mozō** y espera a que termine (procesa también las imágenes).
3. **Copiar JSON** o **Descargar**.
4. En Figma: **Plugins → Development → Mozō**, pega el JSON (o suelta el archivo)
   y pulsa **Importar**.

También puedes capturar desde código:

```js
const capture = await window.__mozo.capture({ flatten: true, inlineImages: true });
```

- `flatten`: omite los elementos sin estilo visual y sube sus hijos (árbol de capas más limpio).
- `inlineImages`: incrusta las imágenes como data: URLs en PNG/JPEG/GIF.

## Qué soporta

| CSS / HTML | En Figma |
| --- | --- |
| `background-color`, varias capas de `background-image` | Rellenos sólidos e imagen (cover → Fill, contain → Fit, repeat → Tile) |
| `linear-gradient` (ángulos y `to …`) | Degradado lineal |
| `border` (ancho distinto por lado) | Trazo interior con pesos por lado |
| `border-radius` por esquina | Radios por esquina |
| `box-shadow` (incluido `inset` y `spread`) | Drop shadow / Inner shadow |
| `opacity`, `overflow` | Opacidad de capa, Clip content |
| Texto: familia, peso, itálica, tamaño, `line-height`, `letter-spacing`, `text-transform`, subrayado y tachado, alineación | Capa de texto editable |
| Párrafos con `<a>`, `<em>`, `<strong>`, `<br>`… | Una sola capa de texto con tramos de estilo (fuente, color, subrayado) |
| `background-clip: text` (texto con degradado o imagen) | Relleno de degradado/imagen en las capas de texto, continuo entre líneas |
| `<img>`, `<canvas>`, `poster` de `<video>`, SVG en línea (incluidos `<use>` de sprites) | Relleno de imagen / vector |
| `<input>`, `<textarea>`, `<select>` | Frame + texto del valor o placeholder |
| Shadow DOM y `<slot>` | Se recorren como DOM normal |
| Cualquier sintaxis de color (`oklch`, `color-mix`…) | El navegador la resuelve a RGBA |

## Limitaciones conocidas

- **Fuentes:** si la fuente no está instalada en Figma, se sustituye (el plugin te dice cuáles).
  Las genéricas (`sans-serif`, `system-ui`…) se mapean a Inter / SF Pro.
- **Sin auto-layout:** todo se posiciona en absoluto, tal como se ve en la ventana.
- No se capturan los pseudo-elementos `::before` / `::after`, `transform` (se usa la caja
  resultante), `filter`, `mix-blend-mode`, los degradados radiales y cónicos (se aproximan con su
  primer color) ni el contenido de los `<iframe>` (quedan como un rectángulo gris).
- Las imágenes de otro dominio sin CORS no se pueden incrustar; el plugin intenta descargarlas y, si
  no puede, las deja en gris.
- Los elementos en línea con fondo, borde o márgenes laterales (p. ej. una etiqueta o un enlace con
  `margin`) se mantienen como capas aparte, porque un texto de Figma no puede expresar esos huecos.

## Marca

El logo, el isotipo y los colores están en [`brand/`](brand/README.md), donde también está la lista de
assets gráficos que hay que crear (icono y portada de Figma Community, social preview de GitHub…).

## Desarrollo

```bash
npm run watch       # recompila capturador y plugin al guardar
npm run typecheck
node test/plugin-mock.mjs [captura.json]   # ejecuta el plugin contra un `figma` simulado
python3 test/serve.py 4174                 # sirve el proyecto con CORS, para probar test/fixture.html
```

Estructura:

```
brand/                   identidad de Mozō (logos, colores, assets de publicación)
src/shared/schema.ts     formato JSON intermedio
src/capture/             capturador (navegador)
  walk.ts                recorrido del DOM, texto, SVG y formularios
  css.ts                 colores, fondos, degradados, bordes, radios y sombras
  images.ts              incrustación de imágenes
  index.ts               panel y punto de entrada
src/plugin/              plugin de Figma
  code.ts                JSON → nodos
  fonts.ts               resolución de fuentes
  ui.html                interfaz del plugin
plugin/manifest.json
```
