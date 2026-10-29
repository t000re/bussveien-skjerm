/* Analog klokke med to varianter:
   Avansert – alle avgangene den neste timen som små linjemerker, minuttstreker og sekundviser.
   Enkel    – bare time- og minuttviser og de tre neste bussene som store, lesbare linjeskilt.
   I begge viser en grønn bue tiden fram til neste buss. */
(function (BV) {
  const { svg, upcoming } = BV.util;
  const C = 100;            // senter i viewBox 200×200
  const R_FACE = 92;
  const R_MARK = 68;      // merkene ligger inne på urskiven, innenfor minuttstrekene

  function polar(angleDeg, r) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  }
  function angleOf(ms) {
    const d = new Date(ms);
    return (d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000) * 6;
  }
  function arcPath(a0, a1, r) {
    let sweep = a1 - a0;
    while (sweep < 0) sweep += 360;
    if (sweep < 0.5) sweep = 0.5;
    const [x0, y0] = polar(a0, r);
    const [x1, y1] = polar(a0 + sweep, r);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  }

  BV.widgets.clock = {
    title: 'Klokke',
    description: 'Urskive med avgangene den neste timen',
    sizes: ['6x5', '6x8', '6x4', '4x4'],
    modes: [{ id: 'advanced', label: 'Avansert' }, { id: 'simple', label: 'Enkel' }],

    available() { return { show: true, must: false }; },

    create(root, ctx) {
      root.classList.add('w-clock');
      const s = svg('svg', { viewBox: '0 0 200 200', class: 'clock-svg', preserveAspectRatio: 'xMidYMid meet' });
      root.appendChild(s);
      const modeOf = () => ((ctx.settings.widgets.find(w => w.id === 'clock') || {}).mode) || 'advanced';
      let mode, arc, marks, hourHand, minHand, secHand, cfg;

      function build() {
        mode = modeOf();
        const simple = mode === 'simple';
        root.classList.toggle('simple', simple);
        // Merkestørrelse og antall per variant
        cfg = simple
          ? { max: 4, h: 20, font: 11.5, r: 78, edge: R_FACE - 4, step: 0, hourLen: 36, minLen: 56 }
          : { max: 99, h: 11, font: 6.6, r: R_MARK, step: 12, hourLen: 44, minLen: 74 };
        s.innerHTML = '';
        markEls.clear();
        svg('circle', { cx: C, cy: C, r: R_FACE, class: 'clock-face' }, s);
        const ticks = svg('g', { class: 'clock-ticks' }, s);
        if (simple) {
          // Bare fire prikker for kvartene
          for (let i = 0; i < 4; i++) {
            const [x, y] = polar(i * 90, 78);
            svg('circle', { cx: x, cy: y, r: 2.6, class: 'tick-dot' }, ticks);
          }
        } else {
          for (let i = 0; i < 60; i++) {
            const major = i % 15 === 0, hour = i % 5 === 0;
            if (!hour) {
              const [x0, y0] = polar(i * 6, R_FACE - 6);
              const [x1, y1] = polar(i * 6, R_FACE - 4);
              svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tick minor' }, ticks);
              continue;
            }
            const [x0, y0] = polar(i * 6, R_FACE - (major ? 13 : 9.5));
            const [x1, y1] = polar(i * 6, R_FACE - 5);
            svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tick' + (major ? ' major' : '') }, ticks);
          }
        }
        // Enkel: svak ring der minuttviserens spiss og linjeskiltene møtes
        arc = svg('path', { class: 'clock-arc', d: '' }, s);
        if (simple) arc.style.display = 'none';   // enkel: det grønne skiltet viser neste buss
        hourHand = svg('line', { x1: C, y1: C + 8, x2: C, y2: C - cfg.hourLen, class: 'hand hour' }, s);
        minHand = svg('line', { x1: C, y1: C + 10, x2: C, y2: C - cfg.minLen, class: 'hand minute' }, s);
        // Enkel: syltynn guloransje sekundviser med motvekt, i Braun-stil
        secHand = simple
          ? svg('line', { x1: C, y1: C + 16, x2: C, y2: C - 56, class: 'hand second braun' }, s)
          : svg('line', { x1: C, y1: C + 14, x2: C, y2: C - 80, class: 'hand second' }, s);
        svg('circle', { cx: C, cy: C, r: 3.6, class: 'hand-hub' }, s);
        svg('circle', { cx: C, cy: C, r: simple ? 2 : 1.4, class: 'hand-hub-in' + (simple ? ' braun' : '') }, s);
        marks = svg('g', { class: 'clock-marks' }, s);   // merkene over viserne, så de alltid kan leses
      }

      const markEls = new Map();
      let raf;
      build();

      function frame() {
        const now = Date.now();
        const d = new Date(now);
        const sec = d.getSeconds() + d.getMilliseconds() / 1000;
        const min = d.getMinutes() + sec / 60;
        const hr = (d.getHours() % 12) + min / 60;
        if (secHand) secHand.setAttribute('transform', `rotate(${sec * 6} ${C} ${C})`);
        minHand.setAttribute('transform', `rotate(${min * 6} ${C} ${C})`);
        hourHand.setAttribute('transform', `rotate(${hr * 30} ${C} ${C})`);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      function render(now) {
        if (modeOf() !== mode) build();
        const deps = upcoming(ctx.data, now, false).filter(d => d.expected - now < 59 * 60000).slice(0, cfg.max);
        const next = deps.find(d => d.expected > now);   // buen viser tiden fram til neste buss som ikke har gått
        const a0 = angleOf(now);
        if (next) {
          arc.setAttribute('d', arcPath(a0, angleOf(next.expected), R_FACE - 9));
          arc.style.opacity = 1;
        } else arc.style.opacity = 0;

        // Enkel: avganger med under to minutters mellomrom blir én gruppe på samme sted, så
        // skiltet alltid står der minuttviseren vil være når bussen kommer.
        // Avansert: hvert merke for seg, flyttes innover ved kollisjon.
        const items = [];
        deps.forEach(dep => {
          const last = items[items.length - 1];
          items.push({ deps: [dep] });
        });
        items.forEach(it => { it.key = it.deps.map(d => d.key).join('+'); });
        const placed = [];
        const keep = new Set();
        items.forEach((it, i) => {
          const dep = it.deps[0];
          const ang = angleOf(dep.expected);
          let r = cfg.r;
          if (mode !== 'simple') for (const p of placed) {
            let da = Math.abs(p.ang - ang); if (da > 180) da = 360 - da;
            if (da < 8 && Math.abs(p.r - r) < cfg.step - 2) r -= cfg.step;
          }
          placed.push({ ang, r });
          keep.add(it.key);
          let g = markEls.get(it.key);
          const isNew = !g;
          if (isNew) {
            g = svg('g', { class: 'mark' }, marks);
            const inner = svg('g', { class: 'mark-inner' }, g);
            const H = cfg.h;
            // Skiltene i en gruppe står tett ved siden av hverandre, midtstilt på tidspunktet
            const sizes = it.deps.map(d => {
              const len = String(d.line.code).length;
              const fsz = len > 2 ? cfg.font * 0.82 : cfg.font;
              return { d, fsz, w: len > 1 ? H * 0.55 + len * fsz * 0.62 : H };
            });
            const gap = H * 0.12;
            let x0 = -(sizes.reduce((a, z) => a + z.w, 0) + gap * (sizes.length - 1)) / 2;
            sizes.forEach(({ d, fsz, w }, k) => {
              const st = BV.colors.chip(d.line, ctx);
              if (st) g.classList.add('colored');
              svg('rect', { x: x0, y: -H / 2, width: w, height: H, rx: H / 2, class: 'mark-bg' + (k ? ' later' : ''), style: st ? `fill:${st.bg}` : '' }, inner);
              const t = svg('text', { x: x0 + w / 2, class: 'mark-text' + (k ? ' later' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.4, style: `font-size:${fsz}px;` + (st ? `fill:${st.fg}` : '') }, inner);
              t.textContent = d.line.code;
              x0 += w + gap;
            });
            g._hw = (sizes.reduce((a, z) => a + z.w, 0) + gap * (sizes.length - 1)) / 2;
            g._hh = H / 2;
            markEls.set(it.key, g);
          }
          // Enkel: skiltets ytterkant skal ligge inntil urskivens kant, uansett bredde og retning
          if (mode === 'simple') {
            const t = (ang - 90) * Math.PI / 180;
            const ext = Math.abs(Math.cos(t)) * g._hw + Math.abs(Math.sin(t)) * g._hh;
            r = Math.min(cfg.r, cfg.edge - ext);
            placed[placed.length - 1].r = r;
          }
          // Ligger merket nesten helt under en tidligere buss, vises bare kanten (ikke teksten)
          if (mode === 'simple') {
            const covered = placed.slice(0, -1).some(p => { let da = Math.abs(p.ang - ang); if (da > 180) da = 360 - da; return da < 11; });
            if (g) g.classList.toggle('covered', covered);
          }
          const [x, y] = polar(ang, r);
          g.style.transform = `translate(${x}px, ${y}px)`;
          g.classList.toggle('next', i === 0);
          // Avganger langt fram tones litt ned
          const mins = (dep.expected - now) / 60000;
          g.style.opacity = mins > 45 ? Math.max(0.35, 1 - (mins - 45) / 20) : 1;
          if (isNew) {
            g.querySelector('.mark-inner').animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
              { duration: BV.anim.ms(700), easing: BV.anim.spring });
          }
        });
        // Nærmeste buss øverst: senere merker legges bak, så de «glir inn under»
        for (let i = items.length - 1; i >= 0; i--) { const g = markEls.get(items[i].key); if (g) marks.appendChild(g); }
        markEls.forEach((g, k) => {
          if (keep.has(k)) return;
          markEls.delete(k);
          const a = g.querySelector('.mark-inner').animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.8)', opacity: 0 }],
            { duration: BV.anim.ms(600), easing: BV.anim.ease, fill: 'forwards' });
          a.onfinish = () => g.remove();
        });
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { build(); render(Date.now()); },
        resize() { },
        destroy() { cancelAnimationFrame(raf); }
      };
    }
  };
})(window.BV);
