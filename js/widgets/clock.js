/* Analog klokke. Avgangene den neste timen ligger som små linjemerker langs urskiven,
   og en grønn bue viser tiden fram til neste buss. */
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

    available() { return { show: true, must: false }; },

    create(root, ctx) {
      root.classList.add('w-clock');
      const s = svg('svg', { viewBox: '0 0 200 200', class: 'clock-svg', preserveAspectRatio: 'xMidYMid meet' });
      root.appendChild(s);
      svg('circle', { cx: C, cy: C, r: R_FACE, class: 'clock-face' }, s);
      const ticks = svg('g', { class: 'clock-ticks' }, s);
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
      const arc = svg('path', { class: 'clock-arc', d: '' }, s);
      const marks = svg('g', { class: 'clock-marks' }, s);
      const hourHand = svg('line', { x1: C, y1: C + 8, x2: C, y2: C - 44, class: 'hand hour' }, s);
      const minHand = svg('line', { x1: C, y1: C + 10, x2: C, y2: C - 74, class: 'hand minute' }, s);
      const secHand = svg('line', { x1: C, y1: C + 14, x2: C, y2: C - 80, class: 'hand second' }, s);
      svg('circle', { cx: C, cy: C, r: 3.6, class: 'hand-hub' }, s);
      svg('circle', { cx: C, cy: C, r: 1.4, class: 'hand-hub-in' }, s);

      const markEls = new Map();
      let raf;

      function frame() {
        const now = Date.now();
        const d = new Date(now);
        const sec = d.getSeconds() + d.getMilliseconds() / 1000;
        const min = d.getMinutes() + sec / 60;
        const hr = (d.getHours() % 12) + min / 60;
        secHand.setAttribute('transform', `rotate(${sec * 6} ${C} ${C})`);
        minHand.setAttribute('transform', `rotate(${min * 6} ${C} ${C})`);
        hourHand.setAttribute('transform', `rotate(${hr * 30} ${C} ${C})`);
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      function render(now) {
        const deps = upcoming(ctx.data, now, false).filter(d => d.expected - now < 59 * 60000);
        const next = deps.find(d => d.expected > now);   // buen viser tiden fram til neste buss som ikke har gått
        const a0 = angleOf(now);
        if (next) {
          arc.setAttribute('d', arcPath(a0, angleOf(next.expected), R_FACE - 9));
          arc.style.opacity = 1;
        } else arc.style.opacity = 0;

        // Plasser merker, og flytt innover hvis de kolliderer med et tidligere merke
        const placed = [];
        const keep = new Set();
        deps.forEach((dep, i) => {
          const ang = angleOf(dep.expected);
          let r = R_MARK;
          for (const p of placed) {
            let da = Math.abs(p.ang - ang); if (da > 180) da = 360 - da;
            if (da < 8 && Math.abs(p.r - r) < 10) r -= 12;
          }
          placed.push({ ang, r });
          keep.add(dep.key);
          let g = markEls.get(dep.key);
          const isNew = !g;
          if (isNew) {
            g = svg('g', { class: 'mark' }, marks);
            const inner = svg('g', { class: 'mark-inner' }, g);
            const len = String(dep.line.code).length;
            const mw = len > 2 ? 6 + len * 3.6 : 11;
            const st = BV.colors.chip(dep.line, ctx);
            if (st) g.classList.add('colored');
            svg('rect', { x: -mw / 2, y: -5.5, width: mw, height: 11, rx: 5.5, class: 'mark-bg', style: st ? `fill:${st.bg}` : '' }, inner);
            const t = svg('text', { class: 'mark-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.4, style: (len > 2 ? 'font-size:5.4px;' : '') + (st ? `fill:${st.fg}` : '') }, inner);
            t.textContent = dep.line.code;
            markEls.set(dep.key, g);
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
        restyle() { markEls.forEach(g => g.remove()); markEls.clear(); render(Date.now()); },
        resize() { },
        destroy() { cancelAnimationFrame(raf); }
      };
    }
  };
})(window.BV);
