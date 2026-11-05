// Efectos compartidos de las páginas públicas de Mozō. Se carga justo después del hero, sin
// defer, para partir el texto en palabras antes del primer pintado (sin parpadeo).

// Entrada «Blur Text»: recorre los [data-blur] en orden de documento con un reloj común.
// data-blur="words" anima palabra a palabra (data-step ms entre palabras) y "whole" el
// elemento entero; data-gap es la pausa antes de empezar ese elemento. SPEED acelera (o frena)
// todos los retrasos a la vez; la duración de cada palabra está en landing.css (.blur-in).
(() => {
  const SPEED = 0.35;
  let delay = 0;
  for (const el of document.querySelectorAll('[data-blur]')) {
    delay += +(el.dataset.gap || 0) * SPEED;
    if (el.dataset.blur === 'whole') {
      el.classList.add('blur-in');
      el.style.setProperty('--delay', `${delay}ms`);
      continue;
    }
    const step = +(el.dataset.step || 150);
    const parts = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    parts.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'blur-in';
      span.textContent = word;
      span.style.setProperty('--delay', `${delay}ms`);
      el.append(span, i < parts.length - 1 ? ' ' : '');
      delay += step * SPEED;
    });
  }
})();

// Parallax: al hacer scroll las capas lejanas se quedan atrás (data-scroll) y, con ratón, todas
// se desplazan un poco hacia el lado contrario del puntero (data-move, en px).
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const layers = [...document.querySelectorAll('.scene img')].map((el) => ({ el, scroll: +el.dataset.scroll, move: +el.dataset.move }));
  const target = { x: 0, y: 0 }, current = { x: 0, y: 0 };
  let frame = 0;
  const render = () => {
    current.x += (target.x - current.x) * 0.08;
    current.y += (target.y - current.y) * 0.08;
    for (const { el, scroll, move } of layers) {
      el.style.transform = `translate3d(${-current.x * move}px, ${scrollY * scroll - current.y * move * 0.5}px, 0) scale(1.08)`;
    }
    const moving = Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001;
    frame = moving ? requestAnimationFrame(render) : 0;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    target.x = (e.clientX / innerWidth) * 2 - 1;
    target.y = (e.clientY / innerHeight) * 2 - 1;
    schedule();
  }, { passive: true });
  schedule();
})();

// Luciérnagas: puntos que vagan sin parar con un rumbo que cambia poco a poco y brillan con
// un pulso propio. Con «reducir movimiento» se dibujan una vez, quietas.
(() => {
  const canvas = document.querySelector('.fireflies');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = ['255, 214, 130', '255, 236, 170', '200, 170, 255'];
  // Halo pre-renderado por color: dibujar una imagen es mucho más barato que un shadowBlur por punto.
  const sprites = colors.map((rgb) => {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${rgb}, 1)`);
    grad.addColorStop(0.12, `rgba(${rgb}, .95)`);
    grad.addColorStop(0.35, `rgba(${rgb}, .3)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return s;
  });
  let width = 0, height = 0, flies = [];
  const spawn = () => ({
    x: Math.random() * width, y: Math.random() * height,
    angle: Math.random() * Math.PI * 2, speed: 0.15 + Math.random() * 0.35,
    size: 16 + Math.random() * 22, phase: Math.random() * Math.PI * 2, pulse: 0.6 + Math.random() * 1.2,
    sprite: sprites[Math.random() < 0.7 ? (Math.random() < 0.5 ? 0 : 1) : 2],
  });
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth; height = innerHeight;
    canvas.width = width * dpr; canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(60, Math.round((width * height) / 22000));
    while (flies.length < count) flies.push(spawn());
    flies.length = count;
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of flies) {
      if (!still) {
        f.angle += (Math.random() - 0.5) * 0.12;
        f.x += Math.cos(f.angle) * f.speed;
        f.y += Math.sin(f.angle) * f.speed - 0.05; // tienden a subir despacio
        const m = f.size;
        if (f.x < -m) f.x = width + m; else if (f.x > width + m) f.x = -m;
        if (f.y < -m) f.y = height + m; else if (f.y > height + m) f.y = -m;
      }
      const glow = 0.25 + 0.75 * Math.max(0, Math.sin(t / 1000 * f.pulse + f.phase)) ** 2;
      ctx.globalAlpha = glow;
      ctx.drawImage(f.sprite, f.x - f.size / 2, f.y - f.size / 2, f.size, f.size);
    }
    if (!still) requestAnimationFrame(draw);
  };
  addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();
