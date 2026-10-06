/**
 * Product pages without the 3D story (e.g. skeen.html): smooth scroll, header behaviour,
 * scroll-in reveals, parallax/tilt and the film reveal — same motion language as
 * experience.js on the DL5 Plus page.
 */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (!window.gsap || !window.ScrollTrigger) {
    root.classList.remove('js');
    return;
  }
  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  /* Smooth scroll */
  let lenis = null;
  if (window.Lenis && !reduceMotion) {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    new MutationObserver(() => {
      if (document.body.classList.contains('no-scroll')) lenis.stop();
      else lenis.start();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute('data-action')) return;
    const hash = a.getAttribute('href');
    if (hash.length < 2) return;
    const el = $(hash);
    if (!el) return;
    e.preventDefault();
    const drawer = $('#mobileDrawer');
    if (drawer && drawer.classList.contains('is-open')) $('#closeMobileDrawer').click();
    if (lenis) lenis.scrollTo(hash === '#hero' ? 0 : el, { offset: -70, duration: 1.4 });
    else el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* Header: hide on scroll down, progress bar, active link */
  const header = $('#mainHeader');
  const progressBar = $('#scrollProgress');
  let lastY = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (progressBar) progressBar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    if (header && !document.body.classList.contains('no-scroll')) {
      if (y > lastY + 4 && y > 500) header.classList.add('is-hidden');
      else if (y < lastY - 4 || y < 200) header.classList.remove('is-hidden');
    }
    lastY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  $$('.nav-desktop .nav-link:not(.nav-products-toggle)').forEach(link => {
    const target = $(link.getAttribute('href'));
    if (!target) return;
    ScrollTrigger.create({
      trigger: target, start: 'top 50%', end: 'bottom 50%',
      onToggle: self => link.parentElement.classList.toggle('active', self.isActive)
    });
  });

  /* Reveals: live position check, explicit visible end state (see experience.js) */
  const pending = [];
  let tick = 0;
  function check() {
    const line = innerHeight * 0.92;
    for (let i = pending.length - 1; i >= 0; i--) {
      const r = pending[i];
      if (r.el.getBoundingClientRect().top < line) {
        pending.splice(i, 1);
        r.tw.play();
        setTimeout(() => { if (r.tw.progress() < 1) r.tw.progress(1); }, 2800);
      }
    }
  }
  function reveal(el, targets, from, to) {
    pending.push({ el, tw: gsap.fromTo(targets, from, Object.assign({ paused: true }, to)) });
  }

  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = '';
    const wrap = node => {
      const w = document.createElement('span'); w.className = 'w';
      const i = document.createElement('span'); i.className = 'wi';
      i.appendChild(node); w.appendChild(i); el.appendChild(w);
    };
    nodes.forEach(n => {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) el.appendChild(document.createTextNode(' '));
          else wrap(document.createTextNode(part));
        });
      } else if (n.nodeName === 'BR') el.appendChild(n);
      else wrap(n);
    });
    return $$('.wi', el);
  }

  if (!reduceMotion) {
    $$('[data-split]').forEach(el => reveal(el, splitWords(el),
      { yPercent: 115, rotate: 4 },
      { yPercent: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.06 }));
    $$('[data-reveal]').forEach(el => reveal(el, el,
      { y: 50, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 1.2, ease: 'expo.out' }));
    $$('[data-reveal-group]').forEach(g => reveal(g, Array.from(g.children),
      { y: 60, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 1.1, ease: 'expo.out', stagger: 0.08, clearProps: 'transform' }));

    // Image frames swing in from a 3D angle as they enter
    $$('[data-tilt-in]').forEach(el => {
      const dir = el.closest('.reverse') ? -1 : 1;
      gsap.fromTo(el,
        { rotationX: 20, rotationY: 14 * dir, scale: 0.88, y: 80, transformPerspective: 1400 },
        { rotationX: 0, rotationY: 0, scale: 1, y: 0, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'center 60%', scrub: 1 } });
    });

    // Film frame opens from a rounded window to full width
    const film = $('#skFilm');
    if (film) {
      gsap.fromTo(film, { clipPath: 'inset(12% 14% 12% 14% round 32px)' }, {
        clipPath: 'inset(0% 0% 0% 0% round 28px)', ease: 'none',
        scrollTrigger: { trigger: film, start: 'top 95%', end: 'center 55%', scrub: true }
      });
    }

    // Hero image drifts up slightly on scroll
    const heroImg = $('.sk-hero-media img');
    if (heroImg) {
      gsap.to(heroImg, { yPercent: -8, ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
    }

    // Hero entrance
    gsap.from('.sk-in', { y: 40, autoAlpha: 0, duration: 1.2, ease: 'expo.out', stagger: 0.1, delay: 0.1 });
  }
  window.addEventListener('scroll', check, { passive: true });
  gsap.ticker.add(() => { if (pending.length && ++tick % 12 === 0) check(); });
  window.addEventListener('load', () => { check(); ScrollTrigger.refresh(); });
  check();

  /* Marquee */
  const track = $('#marqueeTrack');
  if (track && !reduceMotion) gsap.to(track, { xPercent: -50, ease: 'none', duration: 38, repeat: -1 });

  /* Tilt + magnetic buttons (mouse only) */
  if (finePointer && !reduceMotion) {
    $$('[data-tilt]').forEach(el => {
      const max = el.classList.contains('sk-hero-media') ? 6 : 8;
      const rx = gsap.quickTo(el, 'rotationX', { duration: 0.8, ease: 'power3' });
      const ry = gsap.quickTo(el, 'rotationY', { duration: 0.8, ease: 'power3' });
      gsap.set(el, { transformPerspective: 1000 });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        ry((px - 0.5) * max * 2);
        rx(-(py - 0.5) * max * 2);
        el.style.setProperty('--mx', `${px * 100}%`);
        el.style.setProperty('--my', `${py * 100}%`);
      });
      el.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
    $$('[data-magnetic]').forEach(el => {
      const mx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
      const my = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.28);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      el.addEventListener('pointerleave', () => gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: true }));
    });
  }

  /* Videos only play while on screen */
  const io = new IntersectionObserver(entries => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) target.play().catch(() => {});
    else target.pause();
  }), { threshold: 0.15 });
  $$('video').forEach(v => io.observe(v));
})();
