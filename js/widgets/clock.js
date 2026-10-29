/* Klokke i Braun-stil: grå time- og minuttviser, tynn guloransje sekundviser og
   prikker på 12, 3, 6 og 9. Avgangene står som runde linjeskilt ytterst på urskiven,
   ved nøyaktig minutt. Viserne slutter før skiltene, så de aldri dekker en buss.
   Tette avganger overlapper: nærmeste øverst, de neste glir inn under.

   Valg for hvor mye som vises:
     next5 – de fem neste avgangene (samme som lista)
     hour  – alle avgangene den neste timen
     dots  – de fem neste som skilt, resten av timen som små grå prikker */
(function (BV) {
  const { svg, upcoming } = BV.util;
  const C = 100;             // senter i viewBox 200×200
  const R_FACE = 92;
  const R_CHIP = 78;         // skiltenes ring
  const EDGE = R_FACE - 4;   // skiltenes ytterkant skal ligge innenfor denne
  const H = 20, FONT = 11.5; // skiltstørrelse
  const SHOWN = 5;

  function polar(angleDeg, r) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  }
  function angleOf(ms) {
    const d = new Date(ms);
    return (d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000) * 6;
  }

  BV.widgets.clock = {
    title: 'Klokke',
    description: 'Urskive med de neste avgangene',
    sizes: ['6x5', '6x8', '6x4', '4x4'],
    modes: [{ id: 'next5', label: 'Neste 5' }, { id: 'hour', label: 'Hele timen' }, { id: 'dots', label: '5 + prikker' }],

    available() { return { show: true, must: false }; },

    create(root, ctx) {
      root.classList.add('w-clock', 'simple');
      const s = svg('svg', { viewBox: '0 0 200 200', class: 'clock-svg', preserveAspectRatio: 'xMidYMid meet' });
      root.appendChild(s);
      svg('circle', { cx: C, cy: C, r: R_FACE, class: 'clock-face' }, s);
      for (let i = 0; i < 4; i++) {
        const [x, y] = polar(i * 90, R_CHIP);
        svg('circle', { cx: x, cy: y, r: 2.6, class: 'tick-dot' }, s);
      }
      const dotLayer = svg('g', { class: 'clock-dots' }, s);
      const hourHand = svg('line', { x1: C, y1: C + 8, x2: C, y2: C - 36, class: 'hand hour' }, s);
      const minHand = svg('line', { x1: C, y1: C + 10, x2: C, y2: C - 56, class: 'hand minute' }, s);
      const secHand = svg('line', { x1: C, y1: C + 16, x2: C, y2: C - 56, class: 'hand second braun' }, s);
      svg('circle', { cx: C, cy: C, r: 3.6, class: 'hand-hub' }, s);
      svg('circle', { cx: C, cy: C, r: 2, class: 'hand-hub-in braun' }, s);
      const marks = svg('g', { class: 'clock-marks' }, s);   // over viserne, så skiltene alltid kan leses

      const markEls = new Map();
      const dotEls = new Map();
      const modeOf = () => {
        const m = (ctx.settings.widgets.find(w => w.id === 'clock') || {}).mode;
        return ['next5', 'hour', 'dots'].includes(m) ? m : 'next5';
      };

      let raf;
      function frame() {
        const d = new Date();
        const sec = d.getSeconds() + d.getMilliseconds() / 1000;
        const min = d.getMinutes() + sec / 60;
        const hr = (d.getHours() % 12) + min / 60;
        secHand.setAttribute('transform', `rotate(${sec * 6} ${C} ${C})`);
        minHand.setAttribute('transform', `rotate(${min * 6} ${C} ${C})`);
        hourHand.setAttribute('transform', `rotate(${hr * 30} ${C} ${C})`);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      function makeChip(dep) {
        const g = svg('g', { class: 'mark' }, marks);
        const inner = svg('g', { class: 'mark-inner' }, g);
        const len = String(dep.line.code).length;
        const fsz = len > 2 ? FONT * 0.82 : FONT;
        const w = len > 1 ? H * 0.55 + len * fsz * 0.62 : H;   // rund, eller pille for lange numre
        const st = BV.colors.chip(dep.line, ctx);
        if (st) g.classList.add('colored');
        svg('rect', { x: -w / 2, y: -H / 2, width: w, height: H, rx: H / 2, class: 'mark-bg', style: st ? `fill:${st.bg}` : '' }, inner);
        const t = svg('text', { class: 'mark-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.4, style: `font-size:${fsz}px;` + (st ? `fill:${st.fg}` : '') }, inner);
        t.textContent = dep.line.code;
        g._hw = w / 2;
        inner.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: BV.anim.ms(700), easing: BV.anim.spring });
        return g;
      }

      function remove(map, keep, big) {
        map.forEach((g, k) => {
          if (keep.has(k)) return;
          map.delete(k);
          const target = g.firstChild || g;
          const a = target.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: `scale(${big ? 1.8 : 0})`, opacity: 0 }],
            { duration: BV.anim.ms(600), easing: BV.anim.ease, fill: 'forwards' });
          a.onfinish = () => g.remove();
        });
      }

      function render(now) {
        const mode = modeOf();
        const hour = upcoming(ctx.data, now, false).filter(d => d.expected - now < 59 * 60000);
        const chips = mode === 'hour' ? hour : hour.slice(0, SHOWN);
        const dots = mode === 'dots' ? hour.slice(SHOWN) : [];

        const placed = [];
        const keep = new Set();
        chips.forEach((dep, i) => {
          keep.add(dep.key);
          let g = markEls.get(dep.key);
          if (!g) { g = makeChip(dep); markEls.set(dep.key, g); }
          const ang = angleOf(dep.expected);
          // Skiltets ytterkant ligger inntil urskivens kant, uansett bredde og retning
          const t = (ang - 90) * Math.PI / 180;
          const ext = Math.abs(Math.cos(t)) * g._hw + Math.abs(Math.sin(t)) * (H / 2);
          const r = Math.min(R_CHIP, EDGE - ext);
          // Nesten helt dekket av en tidligere buss: vis bare kanten
          const covered = placed.some(p => { let da = Math.abs(p - ang); if (da > 180) da = 360 - da; return da < 11; });
          placed.push(ang);
          const [x, y] = polar(ang, r);
          g.style.transform = `translate(${x}px, ${y}px)`;
          g.classList.toggle('next', i === 0);
          g.classList.toggle('covered', covered);
        });
        // Nærmeste buss øverst: senere skilt legges bak
        for (let i = chips.length - 1; i >= 0; i--) { const g = markEls.get(chips[i].key); if (g) marks.appendChild(g); }
        remove(markEls, keep, true);

        const keepDots = new Set();
        dots.forEach(dep => {
          keepDots.add(dep.key);
          let c = dotEls.get(dep.key);
          if (!c) {
            c = svg('circle', { r: 2.3, class: 'bus-dot-later' }, dotLayer);
            c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BV.anim.ms(600) });
            dotEls.set(dep.key, c);
          }
          const [x, y] = polar(angleOf(dep.expected), R_CHIP);
          c.setAttribute('cx', x); c.setAttribute('cy', y);
        });
        remove(dotEls, keepDots, false);
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { markEls.forEach(g => g.remove()); markEls.clear(); render(Date.now()); },
        resize() { },
        destroy() { cancelAnimationFrame(raf); }
      };
    }
  };
})(window.BV);
