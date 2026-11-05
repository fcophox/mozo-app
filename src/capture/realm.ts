// Ventana cuyo DOM se captura. Normalmente es la propia página, pero para capturar a otro ancho
// (escritorio, iPhone, iPad) la página se vuelve a cargar en un iframe del mismo origen y se
// recorre su documento. Los `instanceof` y getComputedStyle deben usar el reino del iframe.
export let win: Window & typeof globalThis = window;

export function setRealm(next: Window & typeof globalThis) {
  win = next;
}
