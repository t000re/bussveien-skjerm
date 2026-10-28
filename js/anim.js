/* Animasjonshjelpere: fjær-easing, myk tekstbytte og nøkkelbaserte lister (FLIP). */
window.BV = window.BV || {};

(function (BV) {
  // Genererer en CSS linear()-easing som etterligner en dempet fjær.
  function springEasing(damping = 0.82, stiffness = 9, samples = 48) {
    const pts = [];
    const w0 = stiffness;
    const zeta = damping;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const v = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
      pts.push(+v.toFixed(4));
    }
    pts[pts.length - 1] = 1;
    return `linear(${pts.join(', ')})`;
  }

  const supportsLinear = (() => {
    try { return CSS.supports('transition-timing-function', 'linear(0, 1)'); } catch (e) { return false; }
  })();

  const anim = {
    speed: 1,
    spring: supportsLinear ? springEasing(0.86, 8.5) : 'cubic-bezier(.2,.9,.25,1.05)',
    softSpring: supportsLinear ? springEasing(1, 7) : 'cubic-bezier(.22,1,.36,1)',
    ease: 'cubic-bezier(.22,1,.36,1)',
    ms(base) { return Math.round(base / anim.speed); },

    applySpeed(speed) {
      anim.speed = speed || 1;
      const root = document.documentElement.style;
      root.setProperty('--dur-layout', anim.ms(1100) + 'ms');
      root.setProperty('--dur-med', anim.ms(600) + 'ms');
      root.setProperty('--dur-fast', anim.ms(350) + 'ms');
      root.setProperty('--ease-spring', anim.spring);
      root.setProperty('--ease-soft', anim.softSpring);
    },

    /* Bytter innholdet i et element med en myk «rull»: gammelt glir opp og ut, nytt kommer nedenfra. */
    swapText(el, text, opts = {}) {
      if (el._bvText === text) return;
      const first = el._bvText === undefined;
      el._bvText = text;
      if (first || opts.instant) { el.classList.add('swap-host'); el.innerHTML = ''; const s = document.createElement('span'); s.className = 'swap-item'; s.textContent = text; el.appendChild(s); return; }
      el.classList.add('swap-host');
      const old = Array.from(el.querySelectorAll('.swap-item'));
      const neu = document.createElement('span');
      neu.className = 'swap-item';
      neu.textContent = text;
      el.appendChild(neu);
      const dist = opts.distance || '0.35em';
      const dur = anim.ms(opts.duration || 700);
      old.forEach(o => {
        o.classList.add('swap-out');
        const a = o.animate([
          { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' },
          { transform: `translateY(-${dist})`, opacity: 0, filter: 'blur(6px)' }
        ], { duration: dur * 0.7, easing: anim.ease, fill: 'forwards' });
        a.onfinish = () => o.remove();
      });
      neu.animate([
        { transform: `translateY(${dist})`, opacity: 0, filter: 'blur(6px)' },
        { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' }
      ], { duration: dur, easing: anim.ease, delay: dur * 0.12, fill: 'backwards' });
    },

    /* Oppdaterer en liste av elementer basert på nøkler, med FLIP-animasjon for flytt,
       inn- og ut-animasjon for nye/fjernede. render(item, el, isNew) fyller elementet. */
    keyedList(container, items, keyOf, create, render, opts = {}) {
      const map = container._bvMap || (container._bvMap = new Map());
      const before = new Map();
      map.forEach((el, k) => before.set(k, el.getBoundingClientRect()));
      const parentBox = container.getBoundingClientRect();
      const keep = new Set();
      const dur = anim.ms(opts.duration || 800);
      const scale = opts.scale || BV.stageScale || 1;

      items.forEach((item, i) => {
        const k = keyOf(item);
        keep.add(k);
        let el = map.get(k);
        const isNew = !el;
        if (isNew) {
          el = create(item);
          el._bvKey = k;
          map.set(k, el);
        }
        render(item, el, isNew, i);
        // Sørg for riktig rekkefølge
        const at = container.children[i];
        if (at !== el) container.insertBefore(el, at || null);
      });

      // Fjern elementer som ikke lenger finnes – animer ut fra sin gamle posisjon.
      map.forEach((el, k) => {
        if (keep.has(k)) return;
        map.delete(k);
        const r = before.get(k);
        if (r && !opts.noExit) {
          el.style.position = 'absolute';
          el.style.left = (r.left - parentBox.left) / scale + 'px';
          el.style.top = (r.top - parentBox.top) / scale + 'px';
          el.style.width = r.width / scale + 'px';
          el.style.pointerEvents = 'none';
          container.appendChild(el);
          const a = el.animate([
            { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
            { opacity: 0, transform: `translateY(${opts.exitY || '-40%'}) scale(.96)`, filter: 'blur(4px)' }
          ], { duration: dur * 0.6, easing: anim.ease, fill: 'forwards' });
          a.onfinish = () => el.remove();
        } else {
          el.remove();
        }
      });

      // FLIP for elementer som flyttet seg, inn-animasjon for nye
      items.forEach((item, i) => {
        const el = map.get(keyOf(item));
        const r0 = before.get(keyOf(item));
        if (r0) {
          const r1 = el.getBoundingClientRect();
          const dy = (r0.top - r1.top) / scale;
          const dx = (r0.left - r1.left) / scale;
          if (Math.abs(dy) > 0.5 || Math.abs(dx) > 0.5) {
            el.animate([
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: 'translate(0,0)' }
            ], { duration: dur, easing: anim.spring });
          }
        } else if (!opts.firstRender || container._bvRendered) {
          el.animate([
            { opacity: 0, transform: 'translateY(40%) scale(.97)', filter: 'blur(4px)' },
            { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
          ], { duration: dur, easing: anim.ease, delay: dur * 0.25 + i * 40, fill: 'backwards' });
        }
      });
      container._bvRendered = true;
    }
  };

  BV.anim = anim;
  BV.springEasing = springEasing;
})(window.BV);
