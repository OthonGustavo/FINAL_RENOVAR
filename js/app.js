// ============================================================
// Renovar Pilates — UI, tema e animações (GSAP + Lenis + Splide)
// ============================================================
(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';

  /* ---------- Toasts (usado também pelo auth.js) ---------- */
  window.toast = (message, type = 'info', duration = 4500) => {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
  };

  /* ---------- Tema claro / escuro ---------- */
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('renovar-theme', theme);
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#100c0a' : '#FE5800';
  };

  // estado inicial: preferência salva > preferência do sistema
  const savedTheme = localStorage.getItem('renovar-theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(savedTheme || (systemDark ? 'dark' : 'light'));

  $('#theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  /* ---------- Ano do rodapé ---------- */
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- Lenis (scroll suave — MIT) ---------- */
  let lenis = null;
  if (!reducedMotion && typeof window.Lenis !== 'undefined' && hasGsap) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    document.documentElement.classList.add('lenis');
    lenis.on('scroll', () => window.ScrollTrigger && ScrollTrigger.update());
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const scrollToTarget = (selector) => {
    const target = $(selector);
    if (!target) return;
    if (lenis) lenis.scrollTo(target, { offset: -76, duration: 1.2 });
    else target.scrollIntoView({ behavior: 'smooth' });
  };

  /* ---------- Navegação por âncoras ---------- */
  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href.length > 1 && $(href)) {
        e.preventDefault();
        closeMobileMenu();
        scrollToTarget(href);
      }
    });
  });

  /* ---------- Menu mobile ---------- */
  const navToggle = $('#nav-toggle');
  const mobileMenu = $('#mobile-menu');

  const closeMobileMenu = () => {
    navToggle?.classList.remove('open');
    navToggle?.setAttribute('aria-expanded', 'false');
    mobileMenu?.classList.remove('open');
    mobileMenu?.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    lenis?.start();
  };

  navToggle?.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.toggle('open');
    navToggle.classList.toggle('open', isOpen);
    navToggle.setAttribute('aria-expanded', String(isOpen));
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
    if (isOpen) lenis?.stop();
    else lenis?.start();
  });

  /* ---------- Header: fundo + esconder ao rolar ---------- */
  const header = $('#site-header');
  let lastScrollY = 0;

  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle('scrolled', y > 10);
    // esconde ao descer, mostra ao subir (só depois do hero começar a sair)
    if (y > 420 && y > lastScrollY + 4) header.classList.add('header-hidden');
    else if (y < lastScrollY - 4) header.classList.remove('header-hidden');
    lastScrollY = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Scrollspy (link ativo na nav) ---------- */
  const sections = $$('main section[id]');
  const navLinks = $$('.main-nav a');
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((l) =>
            l.classList.toggle('active', l.getAttribute('href') === `#${entry.target.id}`)
          );
        });
      },
      { rootMargin: '-40% 0px -55% 0px' }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- Preloader + intro do hero ---------- */
  const preloader = $('#preloader');

  // envolve cada palavra do título em máscaras para animar
  const wrapTitleWords = () => {
    const title = $('#hero-title');
    if (!title) return [];
    const wrapNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+)/).forEach((part) => {
          if (!part.trim()) {
            frag.appendChild(document.createTextNode(part));
            return;
          }
          const mask = document.createElement('span');
          mask.className = 'word-mask';
          const word = document.createElement('span');
          word.className = 'word';
          word.textContent = part;
          mask.appendChild(word);
          frag.appendChild(mask);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        [...node.childNodes].forEach(wrapNode);
      }
    };
    [...title.childNodes].forEach(wrapNode);
    return $$('.word', title);
  };

  const runIntro = () => {
    if (!hasGsap || reducedMotion) {
      preloader?.remove();
      return;
    }
    const words = wrapTitleWords();
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.to(preloader, {
      yPercent: -100,
      duration: 0.85,
      ease: 'power3.inOut',
      delay: 0.35,
      onComplete: () => preloader?.remove(),
    });
    if (words.length) {
      tl.from(words, { yPercent: 115, duration: 0.9, stagger: 0.055 }, '-=0.25');
    }
    tl.from(
      '[data-hero-fade]',
      { y: 28, opacity: 0, duration: 0.85, stagger: 0.09 },
      '-=0.55'
    );
  };

  if (document.readyState === 'complete') runIntro();
  else window.addEventListener('load', runIntro);
  // segurança: nunca deixar o preloader travado na tela
  setTimeout(() => preloader?.remove(), 3500);

  /* ---------- Animações de scroll (GSAP + ScrollTrigger) ---------- */
  if (hasGsap && typeof window.ScrollTrigger !== 'undefined' && !reducedMotion) {
    gsap.registerPlugin(ScrollTrigger);

    // revelação padrão das seções
    $$('[data-reveal]').forEach((el) => {
      gsap.fromTo(
        el,
        { y: 42, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.95,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 87%', once: true },
        }
      );
    });

    // contadores do hero
    $$('[data-count]').forEach((el) => {
      const target = Number(el.dataset.count);
      const counter = { value: 0 };
      ScrollTrigger.create({
        trigger: el,
        start: 'top 92%',
        once: true,
        onEnter: () =>
          gsap.to(counter, {
            value: target,
            duration: 1.8,
            ease: 'power2.out',
            onUpdate: () => (el.textContent = Math.round(counter.value)),
          }),
      });
    });

    // barra de progresso da página
    gsap.to('#progress-bar', {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 0.3 },
    });

    // parallax dos orbs do hero
    gsap.to('.orb-1', {
      y: 140,
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });
    gsap.to('.orb-2', {
      y: -100,
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
    });

    // cartões flutuantes do hero
    gsap.to('.float-card-1', { y: -13, duration: 2.6, repeat: -1, yoyo: true, ease: 'sine.inOut' });
    gsap.to('.float-card-2', { y: 11, duration: 3.1, repeat: -1, yoyo: true, ease: 'sine.inOut' });
  }

  /* ---------- Botões magnéticos ---------- */
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  if (hasGsap && finePointer && !reducedMotion) {
    $$('.magnetic').forEach((btn) => {
      const xTo = gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        xTo((e.clientX - rect.left - rect.width / 2) * 0.3);
        yTo((e.clientY - rect.top - rect.height / 2) * 0.3);
      });
      btn.addEventListener('mouseleave', () => {
        xTo(0);
        yTo(0);
      });
    });
  }

  /* ---------- Brilho que segue o cursor nos cards ---------- */
  if (finePointer) {
    $$('.service-card, .pass-card').forEach((card) => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - rect.left}px`);
        card.style.setProperty('--my', `${e.clientY - rect.top}px`);
      });
    });
  }

  /* ---------- Carrossel de depoimentos (Splide — MIT) ---------- */
  if (typeof window.Splide !== 'undefined' && $('#testimonials-slider')) {
    new Splide('#testimonials-slider', {
      type: 'loop',
      perPage: 3,
      gap: '1.2rem',
      autoplay: true,
      interval: 4500,
      pauseOnHover: true,
      speed: 700,
      breakpoints: {
        1060: { perPage: 2 },
        700: { perPage: 1, arrows: false },
      },
    }).mount();
  }
})();
