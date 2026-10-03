/**
 * DermLite DL5 Plus - 3D Scroll Experience
 * Smooth scrolling (Lenis), scroll-scrubbed 3D product story (Three.js + GSAP ScrollTrigger),
 * cinematic section transitions, and micro-interactions (tilt, magnetic buttons, cursor).
 * Everything degrades gracefully: without GSAP the page is a normal static page,
 * without WebGL the story uses the product photo instead of the 3D model.
 */

(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGSAP = !!(window.gsap && window.ScrollTrigger);
  const TAU = Math.PI * 2;

  const preloader = $('#preloader');

  if (!hasGSAP) {
    root.classList.remove('js');
    if (preloader) preloader.remove();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.config({ ignoreMobileResize: true });

  // Lazy images / video metadata change the page height after ScrollTrigger has
  // measured it; re-measure (debounced) so scrubbed scenes stay in sync.
  let refreshTimer = 0;
  const queueRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 250);
  };
  document.addEventListener('load', e => {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') queueRefresh();
  }, true);
  document.addEventListener('loadedmetadata', queueRefresh, true);

  /* ==========================================================================
     Smooth scroll
     ========================================================================== */
  let lenis = null;
  if (window.Lenis && !reduceMotion) {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);

    // Freeze page scroll while a modal / drawer / lightbox has locked the body
    new MutationObserver(() => {
      if (document.body.classList.contains('no-scroll')) lenis.stop();
      else lenis.start();
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function scrollToTarget(target, opts = {}) {
    if (lenis) {
      lenis.scrollTo(target, Object.assign({ offset: typeof target === 'number' ? 0 : -60, duration: 1.6 }, opts));
    } else if (typeof target === 'number') {
      window.scrollTo({ top: target, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }
  window.ExpScrollTo = scrollToTarget;

  // In-page anchors (links with data-action are handled by lead-form.js / app.js)
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || a.hasAttribute('data-action')) return;
    const hash = a.getAttribute('href');
    if (hash.length < 2) return;
    const el = document.querySelector(hash);
    if (!el) return;
    e.preventDefault();
    const drawer = $('#mobileDrawer');
    if (drawer && drawer.classList.contains('is-open')) $('#closeMobileDrawer').click();
    requestAnimationFrame(() => scrollToTarget(hash === '#hero' ? 0 : el));
  });

  // Compare CTA: app.js uses native scrollIntoView; route it through Lenis instead
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action="compare-table"]');
    if (!a || !lenis) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = $('#compare') || $('#specs');
    if (target) scrollToTarget(target);
  }, true);

  /* ==========================================================================
     Header, progress bar, active nav
     ========================================================================== */
  const header = $('#mainHeader');
  const progressBar = $('#scrollProgress');
  let lastY = window.scrollY;

  function onScroll() {
    const y = window.scrollY;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progressBar) progressBar.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
    if (header && !document.body.classList.contains('no-scroll')) {
      if (y > lastY + 4 && y > 500) header.classList.add('is-hidden');
      else if (y < lastY - 4 || y < 200) header.classList.remove('is-hidden');
    }
    lastY = y;
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  $$('.nav-desktop .nav-link').forEach(link => {
    const target = $(link.getAttribute('href'));
    if (!target) return;
    ScrollTrigger.create({
      trigger: target,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: self => link.parentElement.classList.toggle('active', self.isActive)
    });
  });

  /* ==========================================================================
     Text splitting
     ========================================================================== */
  function wrapWord(node) {
    const w = document.createElement('span');
    w.className = 'w';
    const i = document.createElement('span');
    i.className = 'wi';
    i.appendChild(node);
    w.appendChild(i);
    return w;
  }

  function splitWords(el) {
    const nodes = Array.from(el.childNodes);
    el.textContent = '';
    nodes.forEach(n => {
      if (n.nodeType === 3) {
        n.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          if (/^\s+$/.test(part)) el.appendChild(document.createTextNode(' '));
          else el.appendChild(wrapWord(document.createTextNode(part)));
        });
      } else if (n.nodeName === 'BR') {
        el.appendChild(n);
      } else {
        el.appendChild(wrapWord(n));
      }
    });
    return $$('.wi', el);
  }

  /* ==========================================================================
     Generic reveals, parallax & 3D entrances
     ========================================================================== */
  // One-shot entrances check the element's live position on scroll instead of relying on
  // ScrollTrigger start positions measured at load: lazy images, videos and the
  // mobile/desktop layout switch shift the page afterwards, and a stale position could
  // leave text hidden. Anything already scrolled past (anchor jumps) reveals at once.
  const pendingReveals = [];
  let revealTick = 0;
  function checkReveals() {
    const line = innerHeight * 0.92;
    for (let i = pendingReveals.length - 1; i >= 0; i--) {
      const r = pendingReveals[i];
      if (r.el.getBoundingClientRect().top < line) {
        pendingReveals.splice(i, 1);
        r.tw.play();
        // Failsafe: content must never stay hidden, even if animation frames stall
        setTimeout(() => { if (r.tw.progress() < 1) r.tw.progress(1); }, 2800);
      }
    }
    if (!pendingReveals.length) {
      window.removeEventListener('scroll', checkReveals);
      gsap.ticker.remove(tickReveals);
    }
  }
  function tickReveals() { if (++revealTick % 12 === 0) checkReveals(); }
  window.addEventListener('load', () => { if (pendingReveals.length) checkReveals(); });
  document.addEventListener('visibilitychange', () => { if (pendingReveals.length) checkReveals(); });

  // fromTo with explicit, fully visible end values: a from() tween ends on whatever the
  // element looked like when it was created, so any second tween or interference on the
  // same element could make "hidden" the end state (this left the accessory cards blank).
  function onReveal(el, fromVars, toVars) {
    const tw = gsap.fromTo(el.__revealTargets || el, fromVars, Object.assign({ paused: true }, toVars));
    if (!pendingReveals.length) {
      window.addEventListener('scroll', checkReveals, { passive: true });
      gsap.ticker.add(tickReveals);
    }
    const entry = { el, tw };
    pendingReveals.push(entry);
    return entry;
  }

  function dropReveal(entry) {
    const i = pendingReveals.indexOf(entry);
    if (i >= 0) pendingReveals.splice(i, 1);
  }

  function initReveals() {
    $$('[data-split]').forEach(el => {
      el.__revealTargets = splitWords(el);
      onReveal(el,
        { yPercent: 115, rotate: 4 },
        { yPercent: 0, rotate: 0, duration: 1.2, ease: 'expo.out', stagger: 0.06 });
    });

    $$('[data-reveal]').forEach(el => {
      onReveal(el,
        { y: 50, autoAlpha: 0 },
        { y: 0, autoAlpha: 1, duration: 1.2, ease: 'expo.out' });
    });

    $$('[data-reveal-group]').forEach(group => {
      group.__revealTargets = Array.from(group.children);
      onReveal(group,
        { y: 70, rotationX: 18, transformPerspective: 900, transformOrigin: '50% 100%', autoAlpha: 0 },
        { y: 0, rotationX: 0, autoAlpha: 1, duration: 1.2, ease: 'expo.out', stagger: 0.08, clearProps: 'transform' });
    });

    // Video frames swing in from a 3D angle as they enter
    $$('[data-tilt-in]').forEach((el, i) => {
      const dir = el.closest('.reverse') ? -1 : 1;
      gsap.fromTo(el,
        { rotationX: 24, rotationY: 16 * dir, scale: 0.84, y: 90, transformPerspective: 1400 },
        {
          rotationX: 0, rotationY: 0, scale: 1, y: 0, ease: 'none',
          scrollTrigger: { trigger: el, start: 'top bottom', end: 'center 60%', scrub: 1 }
        });
    });

    // Contrast banner: clip opens to full-bleed, video drifts
    const bannerClip = $('#bannerClip');
    if (bannerClip) {
      gsap.fromTo(bannerClip,
        { clipPath: 'inset(8% 6% 8% 6% round 32px)' },
        {
          clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none',
          scrollTrigger: { trigger: '#contrast-section', start: 'top bottom', end: 'top top', scrub: true }
        });
      gsap.fromTo('.video-banner-bg', { yPercent: -58 }, {
        yPercent: -42, ease: 'none',
        scrollTrigger: { trigger: '#contrast-section', start: 'top bottom', end: 'bottom top', scrub: true }
      });
    }

    // Simulator lens gently counter-rotates with scroll
    gsap.fromTo('#simLensBezel', { rotation: -12 }, {
      rotation: 0, ease: 'none',
      scrollTrigger: { trigger: '#simulator', start: 'top bottom', end: 'center center', scrub: true }
    });

    // Footer giant word
    gsap.fromTo('.footer-giant', { yPercent: 40, opacity: 0 }, {
      yPercent: 0, opacity: 1, ease: 'none',
      scrollTrigger: { trigger: '.site-footer', start: 'top bottom', end: 'bottom bottom', scrub: true }
    });
  }

  /* ==========================================================================
     Cinema (hero film expands on scroll)
     ========================================================================== */
  function initCinema() {
    const frame = $('#cinemaFrame');
    if (!frame) return;
    const mm = gsap.matchMedia();
    mm.add({ desktop: '(min-width: 900px)', mobile: '(max-width: 899px)' }, ctx => {
      const from = ctx.conditions.desktop ? 'inset(32% 30% 32% 30% round 28px)' : 'inset(36% 12% 36% 12% round 20px)';
      const tl = gsap.timeline({
        scrollTrigger: { trigger: '#cinema', start: 'top top', end: 'bottom bottom', scrub: 1 }
      });
      tl.fromTo(frame, { clipPath: from }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'power2.inOut', duration: 1 }, 0)
        .fromTo(frame.querySelector('video'), { scale: 1.25 }, { scale: 1, ease: 'power2.inOut', duration: 1 }, 0)
        .to('.cinema-headline span:nth-child(1)', { xPercent: -60, opacity: 0, duration: 0.8 }, 0)
        .to('.cinema-headline span:nth-child(3)', { xPercent: 60, opacity: 0, duration: 0.8 }, 0)
        .to('.cinema-headline span:nth-child(2)', { scale: 1.4, opacity: 0, duration: 0.8 }, 0)
        .fromTo('.cinema-caption', { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.3 }, 0.75)
        .to({}, { duration: 0.3 });
    });
  }

  /* ==========================================================================
     Marquee (speeds up with scroll velocity)
     ========================================================================== */
  function initMarquee() {
    const track = $('#marqueeTrack');
    if (!track) return;
    const loop = gsap.to(track, { xPercent: -50, ease: 'none', duration: 38, repeat: -1 });
    let boost = 1;
    let dir = 1;
    ScrollTrigger.create({
      trigger: '.marquee',
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: self => {
        dir = self.direction;
        boost = Math.min(7, 1 + Math.abs(self.getVelocity()) / 350);
      }
    });
    gsap.ticker.add(() => {
      boost += (1 - boost) * 0.04;
      const target = dir * boost;
      loop.timeScale(loop.timeScale() + (target - loop.timeScale()) * 0.12);
    });
  }

  /* ==========================================================================
     Ecosystem horizontal 3D rail
     ========================================================================== */
  function initEcosystem() {
    const section = $('#ecosystem');
    const track = $('#ecoTrack');
    if (!section || !track) return;
    const cards = $$('.eco-card', track);
    const progress = $('#ecoProgress');
    const mm = gsap.matchMedia();

    mm.add('(min-width: 900px)', () => {
      section.classList.add('is-pinned');
      let distance = 0;
      // Measured from layout offsets: scrollWidth shrinks with the cards' 3D rotation
      // and innerWidth includes the scrollbar, which left the last card cut off.
      const layout = () => {
        const cs = getComputedStyle(track);
        const first = cards[0], last = cards[cards.length - 1];
        const content = last.offsetLeft - first.offsetLeft + last.offsetWidth +
          (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        distance = Math.max(0, content - track.clientWidth);
        section.style.height = `${window.innerHeight + distance}px`;
      };
      layout();
      ScrollTrigger.addEventListener('refreshInit', layout);

      const place = () => {
        const vw = window.innerWidth;
        cards.forEach(card => {
          const r = card.getBoundingClientRect();
          const d = gsap.utils.clamp(-1.4, 1.4, (r.left + r.width / 2 - vw / 2) / (vw / 2));
          gsap.set(card, {
            rotationY: -d * 22,
            z: -Math.abs(d) * 160,
            y: Math.abs(d) * 18,
            transformPerspective: 1600
          });
          gsap.set(card.querySelector('.eco-media img'), { xPercent: d * -8 });
        });
      };

      const tween = gsap.to(track, {
        x: () => -distance,
        ease: 'none',
        scrollTrigger: {
          trigger: section,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.8,
          invalidateOnRefresh: true,
          onUpdate: self => {
            if (progress) progress.style.transform = `scaleX(${self.progress})`;
          }
        },
        onUpdate: place
      });
      place();

      return () => {
        ScrollTrigger.removeEventListener('refreshInit', layout);
        section.classList.remove('is-pinned');
        section.style.height = '';
        tween.kill();
        gsap.set(cards, { clearProps: 'transform' });
      };
    });

    mm.add('(max-width: 899px)', () => {
      const entries = cards.map(card => onReveal(card,
        { y: 80, rotationX: 14, transformPerspective: 1000, autoAlpha: 0 },
        { y: 0, rotationX: 0, autoAlpha: 1, duration: 1.1, ease: 'expo.out' }));
      return () => entries.forEach(dropReveal);
    });
  }

  /* ==========================================================================
     Micro-interactions: tilt, magnetic, cursor
     ========================================================================== */
  function initInteractions() {
    if (!finePointer || reduceMotion) return;

    $$('[data-tilt]').forEach(el => {
      const max = el.classList.contains('lens-bezel') ? 14 : 8;
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
      el.addEventListener('pointerleave', () => {
        rx(0);
        ry(0);
      });
    });

    $$('[data-magnetic]').forEach(el => {
      const mx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
      const my = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - r.left - r.width / 2) * 0.28);
        my((e.clientY - r.top - r.height / 2) * 0.35);
      });
      el.addEventListener('pointerleave', () => {
        gsap.to(el, { x: 0, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.4)', overwrite: true });
      });
    });

    const dot = $('.cursor-dot');
    const ring = $('.cursor-ring');
    if (dot && ring) {
      root.classList.add('has-cursor');
      const dx = gsap.quickTo(dot, 'x', { duration: 0.08 });
      const dy = gsap.quickTo(dot, 'y', { duration: 0.08 });
      const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
      const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });
      window.addEventListener('pointermove', e => {
        dx(e.clientX);
        dy(e.clientY);
        rx(e.clientX);
        ry(e.clientY);
      }, { passive: true });
      const hoverSel = 'a, button, input, textarea, select, label, [data-tilt], .thumb-item';
      document.addEventListener('pointerover', e => {
        if (e.target.closest(hoverSel)) root.classList.add('cursor-hover');
      });
      document.addEventListener('pointerout', e => {
        if (e.target.closest(hoverSel)) root.classList.remove('cursor-hover');
      });
      document.addEventListener('pointerleave', () => root.classList.remove('has-cursor'));
      document.addEventListener('pointerenter', () => root.classList.add('has-cursor'));
    }
  }

  /* ==========================================================================
     Videos: only play while visible
     ========================================================================== */
  function initVideos() {
    const heroVideo = $('#heroVideo');
    let heroUserPaused = false;
    const btn = $('#btnTogglePlay');
    if (btn && heroVideo) btn.addEventListener('click', () => { heroUserPaused = heroVideo.paused; });

    const io = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) {
          if (target === heroVideo && heroUserPaused) return;
          const p = target.play();
          if (p && p.catch) p.catch(() => {});
        } else {
          target.pause();
        }
      });
    }, { threshold: 0.05 });
    $$('video').forEach(v => io.observe(v));
  }

  /* ==========================================================================
     3D SCENE
     ========================================================================== */
  const stage = $('#storyStage');
  const S = { px: 0, py: 0, rx: 0, ry: 0, rz: 0, s: 1, explode: 0, uv: 0, pb: 0, level: 0, power: 0.35, dial: 0 };
  const intro = { k: reduceMotion ? 1 : 0 };
  const pointer = { x: 0, y: 0 };
  window.addEventListener('pointermove', e => {
    pointer.x = e.clientX / window.innerWidth - 0.5;
    pointer.y = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });

  function createScene() {
    const canvas = $('#dl5Canvas');
    const fallback = $('#stageFallback');
    const fail = () => {
      stage.classList.add('no-webgl');
      return {
        render() {
          if (!fallback) return;
          const k = 0.6 + 0.4 * intro.k;
          fallback.style.transform =
            `translate(-50%, -50%) translate(${S.px * 2.2}vw, ${-S.py * 1.2}vh) perspective(1200px) ` +
            `rotateY(${Math.sin(S.ry) * 28}deg) rotate(${S.rz}rad) scale(${S.s * 0.85 * k})`;
          fallback.style.opacity = intro.k;
        },
        resize() {}
      };
    };

    if (!window.THREE || !window.DL5Model || !canvas) return fail();

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      return fail();
    }
    if (!renderer.getContext()) return fail();

    const isSmall = window.innerWidth < 900;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall ? 1.75 : 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    if (THREE.RoomEnvironment) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }

    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 0, 44);

    scene.add(new THREE.AmbientLight(0xffffff, 0.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(8, 12, 16);
    scene.add(key);
    const rimGold = new THREE.DirectionalLight(0xdcc7ad, 2.1);
    rimGold.position.set(-14, 6, -10);
    scene.add(rimGold);
    const rimCool = new THREE.DirectionalLight(0xc3cde0, 1.4);
    rimCool.position.set(14, -6, -8);
    scene.add(rimCool);
    const ledLight = new THREE.PointLight(0xffffff, 0, 40, 2);
    scene.add(ledLight);

    const model = DL5Model.build(THREE);
    const pivot = new THREE.Group();
    const holder = new THREE.Group();
    holder.rotation.order = 'ZYX';
    holder.add(model.root);
    pivot.add(holder);
    scene.add(pivot);

    // Floating dust for depth
    const count = isSmall ? 220 : 420;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 2] = -30 + Math.random() * 38;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dotTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const dustMat = new THREE.PointsMaterial({
      size: 0.22, map: dotTex, color: 0xe8c39a, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    const dust = new THREE.Points(dustGeo, dustMat);
    scene.add(dust);

    const hotspots = $$('#hotspots .hotspot').map(el => ({
      el,
      left: el.classList.contains('hs-left'),
      anchor: model.anchors.find(a => a.userData.id === el.dataset.id)
    })).filter(h => h.anchor);
    const v3 = new THREE.Vector3();

    let w = 1;
    let h = 1;
    function resize() {
      w = stage.clientWidth;
      h = stage.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    const clock = new THREE.Clock();
    let mouseX = 0;
    let mouseY = 0;

    // Displayed state eases toward the scroll-driven state every frame (frame-rate independent),
    // so rotation glides instead of following every wheel tick.
    const D = Object.assign({}, S);
    const dustBase = new THREE.Color(0xe8c39a);
    let lastT = 0;

    function render() {
      const t = clock.getElapsedTime();
      const dt = Math.min(1, t - lastT);
      lastT = t;
      const k = intro.k;
      const idle = reduceMotion ? 0 : 1;

      const follow = reduceMotion ? 1 : 1 - Math.exp(-dt * 4.2);
      for (const key in S) D[key] += (S[key] - D[key]) * follow;

      const ease = 1 - Math.exp(-dt * 3);
      mouseX += (pointer.x - mouseX) * ease;
      mouseY += (pointer.y - mouseY) * ease;
      pivot.rotation.y = mouseX * 0.3 * idle;
      pivot.rotation.x = mouseY * 0.14 * idle;

      holder.position.set(
        D.px,
        D.py + Math.sin(t * 0.8) * 0.16 * idle - (1 - k) * 4,
        (1 - k) * -10
      );
      holder.rotation.set(D.rx, D.ry + Math.sin(t * 0.45) * 0.06 * idle - (1 - k) * 2.6, D.rz);
      holder.scale.setScalar(D.s * (0.55 + 0.45 * k));

      model.apply(D, t);

      ledLight.color.copy(model.ledColor);
      ledLight.intensity = Math.max(0, D.power - 0.3) * 0.9;
      ledLight.position.set(D.px, D.py + 6 * D.s, -6);

      dust.rotation.y = t * 0.012 + mouseX * 0.1;
      dust.position.y = (D.ry * 0.4) % 20;
      dustMat.color.copy(model.ledColor).lerp(dustBase, 1 - Math.max(D.uv, D.pb));

      renderer.render(scene, camera);

      // Project exploded-view hotspots
      const op = gsap.utils.clamp(0, 1, (D.explode - 0.55) / 0.4);
      if (op > 0.01) {
        hotspots.forEach(hs => {
          hs.anchor.getWorldPosition(v3);
          v3.project(camera);
          const x = (v3.x * 0.5 + 0.5) * w - (hs.left ? hs.el.offsetWidth : 0);
          const y = (-v3.y * 0.5 + 0.5) * h;
          hs.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          hs.el.style.opacity = op;
        });
      } else if (hotspots.length && hotspots[0].el.style.opacity !== '0') {
        hotspots.forEach(hs => { hs.el.style.opacity = 0; });
      }
    }

    return { render, resize };
  }

  /* ==========================================================================
     Story timeline (scroll-scrubbed chapters)
     ========================================================================== */
  const K_DESKTOP = [
    { px: 5.2, py: -0.2, rx: 0.1, ry: -0.55, rz: 0.06, s: 1, explode: 0, uv: 0, pb: 0, power: 0.35 },
    { px: -5.4, py: -8.2, rx: 0.08, ry: 0.3, rz: -0.12, s: 1.6, explode: 0, uv: 0, pb: 0, power: 0.3 },
    { px: 5.4, py: -7.6, rx: 0.3, ry: 2.45, rz: 0.1, s: 1.55, explode: 0, uv: 0, pb: 0, power: 0.5 },
    { px: -5, py: -8.6, rx: -0.05, ry: 3.14, rz: 0, s: 1.75, explode: 0, uv: 1, pb: 0, power: 1 },
    { px: 5.2, py: -8.2, rx: -0.22, ry: 3.7, rz: 0.12, s: 1.7, explode: 0, uv: 0, pb: 1, power: 1 },
    { px: 4.8, py: -0.4, rx: 0.12, ry: 1.32, rz: 0, s: 0.9, explode: 1, uv: 0, pb: 0, power: 0.6 },
    { px: 5, py: 0.5, rx: 0.35, ry: -0.47, rz: -1.05, s: 1.02, explode: 0, uv: 0, pb: 0, power: 0.35 }
  ];
  const K_MOBILE = [
    { px: 0, py: 5.2, rx: 0.1, ry: -0.5, rz: 0.05, s: 0.46, explode: 0, uv: 0, pb: 0, power: 0.35 },
    { px: 0.3, py: -3.2, rx: 0.08, ry: 0.3, rz: -0.1, s: 1.15, explode: 0, uv: 0, pb: 0, power: 0.3 },
    { px: 0, py: -3, rx: 0.3, ry: 2.45, rz: 0.1, s: 1.1, explode: 0, uv: 0, pb: 0, power: 0.5 },
    { px: 0, py: -3.6, rx: -0.05, ry: 3.14, rz: 0, s: 1.25, explode: 0, uv: 1, pb: 0, power: 1 },
    { px: 0, py: -3.4, rx: -0.2, ry: 3.7, rz: 0.1, s: 1.2, explode: 0, uv: 0, pb: 1, power: 1 },
    { px: -0.4, py: 3.4, rx: 0.12, ry: 1.32, rz: 0, s: 0.45, explode: 1, uv: 0, pb: 0, power: 0.6 },
    { px: 0, py: 3.6, rx: 0.35, ry: -0.47, rz: -1.05, s: 0.52, explode: 0, uv: 0, pb: 0, power: 0.35 }
  ];

  // Mobile: py / s of each K_MOBILE chapter are replaced by a fit of the model into the
  // space the text leaves, so model and copy share the screen on any phone height. The
  // hero puts the model between the title and the buttons; chapter cards (frosted glass)
  // sit at the top with the model just below them.
  // h / w: projected model size in world units at s = 1 for that pose; max: scale cap.
  const MOBILE_FIT = [
    { h: 18.4, w: 7.4, max: 0.8 },
    { h: 18.4, w: 7.4, max: 1.1 },
    { h: 18.4, w: 8, max: 1.1 },
    { h: 18.4, w: 7.4, max: 1.2 },
    { h: 18.4, w: 8, max: 1.15 },
    { h: 19, w: 14, max: 0.6 },
    { h: 15, w: 19, max: 0.7 }
  ];
  const VIEW_HALF_H = 44 * Math.tan(Math.PI / 12); // camera at z 44, 30° vertical fov

  function fitMobile(K) {
    const sh = stage.clientHeight || window.innerHeight;
    const sw = stage.clientWidth || window.innerWidth;
    const unit = (2 * VIEW_HALF_H) / sh; // world units per px on the model plane
    const bottom = sh - 24;
    return K.map((k, i) => {
      const f = MOBILE_FIT[i];
      const p = panels.find(el => +el.dataset.chapter === i);
      let top = sh * 0.4;
      let end = bottom;
      const tagline = p && p.querySelector('.hero-tagline');
      const ctas = p && p.querySelector('.hero-ctas');
      if (tagline && ctas) {
        top = p.offsetTop + tagline.offsetTop + tagline.offsetHeight + 6;
        end = p.offsetTop + ctas.offsetTop - 6;
      } else if (p) {
        top = p.offsetTop + p.offsetHeight - 24; // tucks just under the card's lower edge
      }
      top = Math.min(top, end - sh * 0.3); // a long panel still leaves 30% for the model
      const room = end - top;
      const s = Math.min(f.max, (room * 0.92 * unit) / f.h, (sw * 0.86 * unit) / f.w);
      return Object.assign({}, k, { s, py: (sh / 2 - (top + room / 2)) * unit });
    });
  }

  let storyTL = null;
  let currentChapter = -1;
  const panels = $$('.story-panel');
  const navBtns = $$('#chapterNav button');
  const polChips = $$('#polSwitch .pol-chip');
  const polIndicator = $('#polSwitch .pol-indicator');
  const pbBars = $$('#pbMeter .pb-bars i');
  const pbLevel = $('#pbLevel');
  const scrollCue = $('#scrollCue');
  let lastPol = -1;
  let lastLvl = -1;
  let lastAccent = '';

  pbBars.forEach((bar, i) => {
    const t = i / 8;
    bar.style.setProperty('--c', `rgb(${Math.round(mix(140, 255, t))}, ${Math.round(mix(185, 140, t))}, ${Math.round(mix(255, 50, t))})`);
  });

  function countUp(panel) {
    $$('[data-count]', panel).forEach(el => {
      const end = parseFloat(el.dataset.count);
      const pre = el.dataset.prefix || '';
      const suf = el.dataset.suffix || '';
      const o = { v: 0 };
      gsap.to(o, {
        v: end, duration: 1.4, ease: 'power3.out', overwrite: true,
        onUpdate: () => { el.textContent = `${pre}${Math.round(o.v)}${suf}`; }
      });
    });
  }

  function mix(a, b, t) { return a + (b - a) * t; }

  function updateStoryUI() {
    if (!storyTL) return;
    const t = storyTL.time();
    const chapter = t < 0.55 ? 0 : Math.min(panels.length - 1, Math.floor(t + 0.45));
    if (chapter !== currentChapter) {
      currentChapter = chapter;
      navBtns.forEach((b, i) => b.classList.toggle('is-active', i === chapter));
      const panel = panels.find(p => +p.dataset.chapter === chapter);
      if (panel) countUp(panel);
    }
    if (scrollCue) scrollCue.style.opacity = t > 0.05 ? 0 : 1;

    const pol = Math.min(2, Math.floor((((S.dial % TAU) + TAU) % TAU) / TAU * 3));
    if (pol !== lastPol) {
      lastPol = pol;
      polChips.forEach((c, i) => c.classList.toggle('is-active', i === pol));
      if (polIndicator) polIndicator.style.transform = `translateX(${pol * 100}%)`;
    }

    const lvl = 1 + Math.round(S.level * 8);
    if (lvl !== lastLvl) {
      lastLvl = lvl;
      pbBars.forEach((b, i) => b.classList.toggle('on', i < lvl));
      if (pbLevel) pbLevel.textContent = `Level ${lvl}`;
    }

    // Stage accent: gold -> UV violet -> PigmentBoost amber
    const r = Math.round(mix(mix(204, 139, S.uv), 255, S.pb));
    const g = Math.round(mix(mix(153, 92, S.uv), 150, S.pb));
    const b = Math.round(mix(mix(102, 246, S.uv), 60, S.pb));
    const accent = `${r}, ${g}, ${b}`;
    if (accent !== lastAccent) {
      lastAccent = accent;
      stage.style.setProperty('--accent-rgb', accent);
    }
  }

  function buildStory(K) {
    const desktop = K === K_DESKTOP;
    if (!desktop) K = fitMobile(K);
    Object.assign(S, K[0], { dial: 0, level: 0 });
    const N = K.length - 1;
    const tl = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      // Phones: shorter story and a tighter scrub so the model keeps up with the finger
      scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom bottom', scrub: desktop ? 1.1 : 0.5 },
      onUpdate: updateStoryUI
    });

    // GSAP takes over the CSS `translate` centring when it first parses each panel and
    // doesn't always keep it (panels ended up half a panel too low on laptops), so the
    // vertical centring is set explicitly here: desktop panels sit at top:50%.
    const centred = desktop ? -50 : 0;
    panels.forEach((p, i) => gsap.set(p, { autoAlpha: i === 0 ? 1 : 0, y: 0, yPercent: centred, translate: 'none' }));

    for (let i = 1; i <= N; i++) {
      const at = i - 0.45;
      tl.to(S, Object.assign({ duration: 0.6, ease: 'sine.inOut' }, K[i]), i - 0.6);
      tl.to(panels[i - 1], { autoAlpha: 0, y: -50, filter: 'blur(6px)', duration: 0.2, ease: 'power1.in' }, at);
      tl.fromTo(panels[i],
        { autoAlpha: 0, y: 60, filter: 'blur(8px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.24, ease: 'power2.out' }, at + 0.24);
      tl.fromTo(panels[i].children,
        { y: 30 },
        { y: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out' }, at + 0.24);
    }

    // Chapter-specific motion
    tl.fromTo(S, { dial: 0 }, { dial: TAU * 0.999, duration: 1, ease: 'none' }, 1.55);
    tl.fromTo(S, { level: 0 }, { level: 1, duration: 0.95, ease: 'none' }, 3.55);

    // Background layers drift
    tl.fromTo('#stageBigText', { xPercent: 0, opacity: 1 }, { xPercent: -30, opacity: 0, duration: 1, ease: 'none' }, 0);
    tl.fromTo('.stage-rings', { rotation: 0, scale: 1 }, { rotation: 120, scale: 1.25, duration: N + 0.4, ease: 'none' }, 0);

    tl.to({}, { duration: 0.4 }, N);
    return tl;
  }

  function initStory(scene) {
    let mm = null;
    let layoutKey = '';
    const measure = () => `${stage.clientWidth}x${stage.clientHeight}|${panels.map(p => p.offsetHeight).join(',')}`;
    const setup = () => {
      if (mm) mm.revert();
      layoutKey = measure();
      mm = gsap.matchMedia();
      mm.add({ desktop: '(min-width: 900px)', mobile: '(max-width: 899px)' }, ctx => {
        storyTL = buildStory(ctx.conditions.desktop ? K_DESKTOP : K_MOBILE);
        currentChapter = -1;
        updateStoryUI();
        if (scene) scene.resize();
        return () => { storyTL = null; };
      });
    };
    setup();

    // The mobile framing is measured from the panels, so rebuild when they change size
    // (web fonts arriving, rotation, a different phone).
    const recheck = () => {
      if (window.innerWidth >= 900 || measure() === layoutKey) return;
      setup();
      ScrollTrigger.refresh();
    };
    let recheckTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(recheckTimer);
      recheckTimer = setTimeout(recheck, 300);
    });
    window.addEventListener('load', recheck);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(recheck);

    navBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!storyTL) return;
        const st = storyTL.scrollTrigger;
        const i = +btn.dataset.go;
        const time = i === 0 ? 0 : i + 0.12;
        scrollToTarget(st.start + (time / storyTL.duration()) * (st.end - st.start), { duration: 2 });
      });
    });

    // Render only while the story is on screen
    let visible = true;
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      document.body.classList.toggle('in-story', visible);
    }).observe($('#hero'));
    gsap.ticker.add(() => {
      if (visible && scene) scene.render();
    });
    window.addEventListener('resize', () => scene && scene.resize());
  }

  /* ==========================================================================
     Preloader + hero intro
     ========================================================================== */
  function heroIntro() {
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.to(intro, { k: 1, duration: 2.4, ease: 'expo.out' }, 0)
      .from('.panel-hero .eyebrow-pill', { y: 20, autoAlpha: 0, duration: 1 }, 0.3)
      .from('.hero-title .line > span', { yPercent: 110, duration: 1.4, stagger: 0.1 }, 0.35)
      .from('.hero-tagline', { y: 24, autoAlpha: 0, duration: 1.1 }, 0.6)
      .from('.hero-ctas', { y: 24, autoAlpha: 0, duration: 1.1 }, 0.7)
      .from('.hero-mini-specs > div', { y: 20, autoAlpha: 0, duration: 1, stagger: 0.08 }, 0.85)
      .from('#stageBigText', { scale: 1.15, autoAlpha: 0, duration: 2 }, 0.1)
      .from('.stage-rings', { scale: 0.6, autoAlpha: 0, duration: 2.2 }, 0)
      .from(['#chapterNav', '#scrollCue', '#mainHeader'], { autoAlpha: 0, duration: 1 }, 1);
  }

  function runPreloader(onDone) {
    if (!preloader) {
      onDone();
      return;
    }
    if (lenis) lenis.stop();
    const bar = $('#preloaderBar');
    const count = $('#preloaderCount');
    const p = { v: 0 };
    const set = () => {
      if (bar) bar.style.transform = `scaleX(${p.v / 100})`;
      if (count) count.textContent = `${Math.round(p.v)}%`;
    };
    const crawl = gsap.to(p, { v: 86, duration: 2.2, ease: 'power2.out', onUpdate: set });

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      crawl.kill();
      gsap.timeline()
        .to(p, { v: 100, duration: 0.45, ease: 'power2.out', onUpdate: set })
        .to('.preloader-inner', { y: -20, autoAlpha: 0, duration: 0.5, ease: 'power2.in' })
        .to(preloader, { yPercent: -100, duration: 1, ease: 'expo.inOut' }, '-=0.1')
        .add(() => {
          preloader.remove();
          if (lenis) lenis.start();
          ScrollTrigger.refresh();
        })
        .add(onDone, '-=0.75');
    };

    const ready = Promise.all([
      new Promise(r => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true }))),
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
    ]);
    Promise.race([ready, new Promise(r => setTimeout(r, 4000))]).then(() => setTimeout(finish, 350));
  }

  /* ==========================================================================
     Boot
     ========================================================================== */
  function boot() {
    // Always start the story from the intro unless a deep link was requested
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    if (!location.hash) window.scrollTo(0, 0);

    let scene = null;
    if (stage) {
      try {
        scene = createScene();
      } catch (err) {
        console.warn('3D scene unavailable, using image fallback.', err);
        stage.classList.add('no-webgl');
      }
    }

    initStory(scene);
    initCinema();
    initMarquee();
    initEcosystem();
    initReveals();
    initInteractions();
    initVideos();
    onScroll();

    if (reduceMotion) {
      intro.k = 1;
      if (preloader) preloader.remove();
      return;
    }
    runPreloader(heroIntro);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
