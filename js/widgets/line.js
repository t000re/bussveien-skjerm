/* Trasélinje: 3 stopp bakover og 3 stopp framover fra holdeplassen, pluss start- og
   endeholdeplass ytterst (stiplet linje når det er skjulte stopp imellom).
   Hvis linjene deler seg, tegnes en gaffel med én gren per retning.
   Boksen tegnes vertikalt når den er høyere enn den er bred.
   All geometri regnes i et abstrakt rom (a = langs linjen, o = på tvers) og speiles
   til x/y etter retning, slik at horisontal og vertikal variant deler samme kode. */
(function (BV) {
  const { svg } = BV.util;
  const DEPTH = 3;

  /* ---------- Modell ---------- */
  function hereIndex(j, stop) {
    let i = j.calls.findIndex(c => c.quayId === stop.quayId);
    if (i < 0) i = j.calls.findIndex(c => c.stopId === stop.stopPlaceId);
    return i;
  }

  function buildSide(seqs) {
    // seqs: [{ key, lineCode, nodes: [{stopId, name}] }] – nærmest holdeplassen først
    let t = 0;
    while (t < DEPTH) {
      const live = seqs.filter(s => s.nodes.length > t);
      if (!live.length || live.length < seqs.length) break;
      const id = live[0].nodes[t].stopId;
      if (!live.every(s => s.nodes[t].stopId === id)) break;
      t++;
    }
    const groups = new Map();
    seqs.forEach(s => {
      if (s.nodes.length <= t) return;
      const id = s.nodes[t].stopId;
      if (!groups.has(id)) groups.set(id, { nodes: s.nodes.slice(t), lines: new Set(), keys: [] });
      const g = groups.get(id);
      g.lines.add(s.lineCode);
      g.keys.push(s.key);
      if (s.nodes.length - t > g.nodes.length) g.nodes = s.nodes.slice(t);
    });
    let branches = Array.from(groups.values()).slice(0, 3);
    const longest = seqs.reduce((a, s) => s.nodes.length > a.nodes.length ? s : a, seqs[0] || { nodes: [] });
    let trunk = longest.nodes.slice(0, t);
    let trunkKeys = seqs.map(s => s.key);
    if (branches.length === 1) { trunk = trunk.concat(branches[0].nodes); branches = []; }
    branches.sort((a, b) => b.lines.size - a.lines.size); // grenen med flest linjer går rett fram
    return { trunk, branches, trunkKeys };
  }

  function buildModel(data) {
    if (!data || !data.journeys) return null;
    const patterns = new Map();
    const journeys = [];
    Object.values(data.journeys).forEach(j => {
      const k = hereIndex(j, data.stop);
      if (k < 0) return;
      journeys.push({ j, k });
      const key = j.lineCode + '|' + j.dest;
      if (patterns.has(key)) return;
      const last = j.calls.length - 1;
      const node = c => ({ stopId: c.stopId, name: c.name });
      patterns.set(key, {
        key, lineCode: j.lineCode, line: j.line,
        up: j.calls.slice(Math.max(0, k - DEPTH), k).reverse().map(node),
        down: j.calls.slice(k + 1, k + 1 + DEPTH).map(node),
        // Start- og endeholdeplass når de ligger utenfor de viste stoppene
        origin: k - DEPTH > 0 ? { ...node(j.calls[0]), gap: k - DEPTH > 1 } : null,
        terminus: last > k + DEPTH ? { ...node(j.calls[last]), gap: last - (k + DEPTH) > 1 } : null
      });
    });
    if (!patterns.size) return null;
    const ps = Array.from(patterns.values());
    const up = buildSide(ps.map(p => ({ key: p.key, lineCode: p.lineCode, nodes: p.up })));
    const down = buildSide(ps.map(p => ({ key: p.key, lineCode: p.lineCode, nodes: p.down })));
    const byKey = new Map(ps.map(p => [p.key, p]));
    // Endeholdeplasser per ende (gren eller stamme), gruppert per holdeplass
    function ends(side, prop) {
      const list = side.branches.length ? side.branches.map((b, bi) => ({ bi, keys: b.keys })) : [{ bi: 0, keys: side.trunkKeys }];
      return list.map(e => {
        const terms = new Map();
        e.keys.forEach(k => {
          const p = byKey.get(k), t = p[prop];
          if (!t) return;
          if (!terms.has(t.stopId)) terms.set(t.stopId, { ...t, lines: new Set() });
          terms.get(t.stopId).lines.add(p.lineCode);
        });
        return { bi: e.bi, terms: [...terms.values()] };
      });
    }
    up.ends = ends(up, 'origin');
    down.ends = ends(down, 'terminus');
    const sig = JSON.stringify([up.trunk.map(n => n.stopId), up.branches.map(b => b.nodes.map(n => n.stopId)),
      down.trunk.map(n => n.stopId), down.branches.map(b => [b.nodes.map(n => n.stopId), [...b.lines]]),
      up.ends.map(e => e.terms.map(t => t.stopId)), down.ends.map(e => e.terms.map(t => t.stopId)), data.stop.name]);
    return { up, down, journeys, sig, patterns: ps, hereName: data.stop.name || 'Her' };
  }

  let cache = { at: null, model: null };
  function model(data) {
    if (!data) return null;
    if (cache.at !== data) cache = { at: data, model: buildModel(data) };
    return cache.model;
  }

  /* ---------- Geometri (abstrakt: a langs, o på tvers) ---------- */
  function bez(p, q, u) {
    if (Math.abs(p.o - q.o) < 0.5) return { a: p.a + (q.a - p.a) * u, o: p.o };
    const m = (q.a - p.a) * 0.5;
    const P = [p, { a: p.a + m, o: p.o }, { a: q.a - m, o: q.o }, q];
    const v = 1 - u;
    const c = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
    return { a: c.reduce((s, k, i) => s + k * P[i].a, 0), o: c.reduce((s, k, i) => s + k * P[i].o, 0) };
  }

  // Tekstbredde uten å tvinge fram layout (brukes mens boksen animerer)
  const measureCtx = document.createElement('canvas').getContext('2d');
  function textWidth(text, size, weight = 500) {
    measureCtx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
    return measureCtx.measureText(text).width;
  }
  function fit(text, size, maxW, weight) {
    if (maxW <= 20) return '';
    if (textWidth(text, size, weight) <= maxW) return text;
    let t = text;
    while (t.length > 2 && textWidth(t + '…', size, weight) > maxW) t = t.slice(0, -1);
    return t.trimEnd() + '…';
  }

  BV.widgets.line = {
    title: 'Trasé',
    description: 'Stoppene før og etter, med gaffel der linjene deler seg',
    sizes: ['12x3', '12x2', '12x4', '4x20', '5x20', '6x20'],
    defaultSizes: ['12x3', '12x2', '12x4'],

    available(data) { return { show: !!model(data), must: false }; },

    create(root, ctx) {
      root.classList.add('w-line');
      let size = { w: 0, h: 0 };
      let s = null, busLayer = null, builtSig = null;
      let G = null;               // geometri fra siste build
      const busEls = new Map();

      /* ----- Bygg statisk del ----- */
      function build(m, animate) {
        const W = size.w, H = size.h;
        if (W < 40 || H < 40) return;
        const vertical = H > W * 1.15;
        const angled = !vertical && ctx.settings.view.labelAngle === 'angled';
        const L = vertical ? H : W;          // lengde langs linjen
        const C = vertical ? W : H;          // bredde på tvers
        const map = (a, o) => vertical ? { x: o, y: a } : { x: a, y: o };
        const pathD = (p, q) => {
          const A = map(p.a, p.o), B = map(q.a, q.o);
          if (Math.abs(p.o - q.o) < 0.5) return `M ${A.x} ${A.y} L ${B.x} ${B.y}`;
          const mA = (q.a - p.a) * 0.5;
          const c1 = map(p.a + mA, p.o), c2 = map(q.a - mA, q.o);
          return `M ${A.x} ${A.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${B.x} ${B.y}`;
        };

        const compact = !vertical && H < 200;
        const fs = compact ? 17 : 19;
        const downFork = m.down.branches.length > 1, upFork = m.up.branches.length > 1;
        const forked = downFork || upFork;
        const termUp = m.up.ends.some(e => e.terms.length), termDown = m.down.ends.some(e => e.terms.length);

        // Plassering på tvers
        let o0, dy;
        if (vertical) {
          dy = Math.min(C * 0.2, 64);
          o0 = forked ? (C + dy) / 2 : Math.min(C * 0.3, 90);
        } else if (angled) {
          o0 = Math.max(64, C * (forked ? 0.27 : 0.3));
          dy = Math.min(C * 0.26, 80);
        } else {
          o0 = forked ? Math.max(64, C * (compact ? 0.42 : 0.38)) : Math.max(64, C * 0.46);
          dy = Math.min(C * 0.3, 90);
        }
        // Gren 1 nedover/til venstre i vertikal, gren 2 motsatt
        const branchO = vertical ? [0, -dy, dy] : [0, dy, -dy];

        // Plassering langs: tre synlige stopp + endeholdeplass, likt på begge sider
        const padA = vertical ? 30 : (angled ? 24 : 70);
        const sideUnits = (sm, term) => Math.max(sm.trunk.length + Math.max(0, ...sm.branches.map(b => b.nodes.length)), 0.5) + (term ? 1.25 : 0);
        const unitsUp = sideUnits(m.up, termUp), unitsDown = sideUnits(m.down, termDown);
        const slot = (L / 2 - padA) / Math.max(unitsUp, unitsDown, 1);
        const aC = L / 2;

        const lineInfo = new Map(m.patterns.map(p => [p.lineCode, p.line || { code: p.lineCode }]));
        const colored = BV.colors.mode(ctx) !== 'neutral';
        const strokeOf = code => BV.colors.stroke(code, (lineInfo.get(code) || {}).color, ctx);
        const allLines = m.patterns.map(p => p.lineCode);

        const frag = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'line-svg' + (vertical ? ' vertical' : '') });
        const tracks = svg('g', { class: 'tracks' }, frag);
        const dots = svg('g', { class: 'dots' }, frag);
        const labels = svg('g', { class: 'labels' }, frag);

        function track(p, q, lines, cls) {
          const codes = colored ? [...new Set(lines || [])].sort() : [];
          if (!codes.length) { svg('path', { d: pathD(p, q), class: cls }, tracks); return; }
          const n = codes.length, sw = n > 1 ? 7 : 10, gap = sw + 1.5;
          codes.forEach((code, i) => {
            const off = (i - (n - 1) / 2) * gap;
            svg('path', { d: pathD({ a: p.a, o: p.o + off }, { a: q.a, o: q.o + off }), class: cls, style: `stroke:${strokeOf(code)};stroke-width:${sw}px` }, tracks);
          });
        }

        // Etikett for et stopp. side: +1 = vanlig side (under / til høyre), -1 = motsatt (til venstre i vertikal)
        function label(p, text, opts = {}) {
          const P = map(p.a, p.o);
          const cls = 'stop-label' + (opts.cls ? ' ' + opts.cls : '');
          const weight = opts.weight || 500;
          if (vertical) {
            const side = opts.side || 1;
            const room = side > 0 ? C - p.o - 26 : p.o - 26;
            const t = svg('text', { x: P.x + side * 22, y: P.y, class: cls, 'text-anchor': side > 0 ? 'start' : 'end', 'dominant-baseline': 'central', 'font-size': fs }, labels);
            t.textContent = fit(text, fs, room, weight);
            if (opts.sub) {
              t.setAttribute('y', P.y - 11);
              const s2 = svg('text', { x: P.x + side * 22, y: P.y + 12, class: 'stop-label you-sub', 'text-anchor': side > 0 ? 'start' : 'end', 'dominant-baseline': 'central', 'font-size': fs - 3 }, labels);
              s2.textContent = opts.sub;
            }
          } else if (angled) {
            const room = (C - p.o - 16) / Math.SQRT1_2 - 6;
            // Endeholdeplassen helt til høyre speiles, så teksten ikke går ut av boksen
            const mirror = opts.end === 'right';
            const off = opts.big ? 14 : 4;
            const tf = mirror ? `translate(${P.x - 4}, ${P.y + 18}) rotate(-45)` : `translate(${P.x + off}, ${P.y + 14 + off}) rotate(45)`;
            const g = svg('g', { transform: tf }, labels);
            const t = svg('text', { x: 0, y: 0, class: cls, 'text-anchor': mirror ? 'end' : 'start', 'dominant-baseline': 'central', 'font-size': fs }, g);
            t.textContent = fit(text, fs, Math.min(room, 260), weight);
            if (opts.sub) {
              const s2 = svg('text', { x: 0, y: fs + 2, class: 'stop-label you-sub', 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': fs - 3 }, g);
              s2.textContent = opts.sub;
            }
          } else {
            // Endeholdeplasser forankres mot ytterkanten så de ikke klippes
            const anchor = opts.end === 'left' ? 'start' : opts.end === 'right' ? 'end' : 'middle';
            const x = opts.end === 'left' ? P.x - 12 : opts.end === 'right' ? P.x + 12 : P.x;
            const t = svg('text', { x, y: P.y + (compact ? 30 : 38), class: cls, 'text-anchor': anchor, 'font-size': fs }, labels);
            t.textContent = fit(text, fs, opts.room || slot * 0.96, weight);
            if (opts.sub) {
              const s2 = svg('text', { x: P.x, y: P.y + (compact ? 30 : 38) + fs + 2, class: 'stop-label you-sub', 'text-anchor': 'middle', 'font-size': fs - 3 }, labels);
              s2.textContent = opts.sub;
            }
          }
        }

        function lineChips(p, lines) {
          // Linjenummer ved endeholdeplassen, på motsatt side av etiketten
          const codes = [...lines].sort();
          const widths = codes.map(c => Math.max(34, 14 + String(c).length * 12));
          const total = widths.reduce((a, w) => a + w + 4, -4);
          const P = map(p.a, p.o);
          const gx = P.x - total / 2;
          const gy = P.y - 17;
          const g = svg('g', { class: 'branch-chips', transform: `translate(${gx}, ${gy})` }, labels);
          let x0 = 0;
          codes.forEach((code, i) => {
            const st = BV.colors.chip(lineInfo.get(code) || { code }, ctx);
            svg('rect', { x: x0, y: 0, width: widths[i], height: 34, rx: 10, class: 'bchip', style: st ? `fill:${st.bg}` : '' }, g);
            const tx = svg('text', { x: x0 + widths[i] / 2, y: 18, class: 'bchip-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, g);
            tx.textContent = code;
            x0 += widths[i] + 4;
          });
        }

        const nodePos = new Map();
        const endPos = {};        // side|bi -> siste synlige punkt
        const termPos = new Map(); // side|stopId -> punkt
        const here = { a: aC, o: o0 };
        const r = compact ? 8 : 10;

        function side(name, sm, dir) {
          const pts = [];
          let prev = here;
          sm.trunk.forEach((n, i) => {
            const p = { a: aC + dir * (i + 1) * slot, o: o0, n };
            nodePos.set(name + '|' + n.stopId, p);
            track(dir > 0 ? prev : p, dir > 0 ? p : prev, allLines, 'track');
            pts.push(p); prev = p;
          });
          const trunkEnd = prev, t = sm.trunk.length;
          if (!sm.branches.length) endPos[name + '|0'] = { p: trunkEnd, lines: allLines };
          sm.branches.forEach((b, bi) => {
            let bp = trunkEnd;
            b.nodes.forEach((n, i) => {
              const p = { a: aC + dir * (t + i + 1) * slot, o: o0 + branchO[bi], n, bi };
              nodePos.set(name + '|' + n.stopId, p);
              track(dir > 0 ? bp : p, dir > 0 ? p : bp, [...b.lines], 'track');
              pts.push(p); bp = p;
            });
            endPos[name + '|' + bi] = { p: bp, lines: [...b.lines] };
          });

          // Start-/endeholdeplasser
          sm.ends.forEach(e => {
            const from = endPos[name + '|' + e.bi];
            if (!from) return;
            const n = e.terms.length;
            e.terms.forEach((tm, i) => {
              const spread = n > 1 ? (i - (n - 1) / 2) * Math.min(dy, 70) : 0;
              const units = Math.abs(from.p.a - aC) / slot + 1.25;
              const p = { a: aC + dir * units * slot, o: from.p.o + spread, n: tm, term: true };
              termPos.set(name + '|' + tm.stopId, p);
              track(dir > 0 ? from.p : p, dir > 0 ? p : from.p, [...tm.lines], 'track' + (tm.gap ? ' gap' : ''));
              const P = map(p.a, p.o);
              svg('circle', { cx: P.x, cy: P.y, r: r + 2, class: 'term-dot' }, dots);
              label(p, tm.name, { cls: 'term-label', weight: 600, side: vertical && p.o < o0 - 1 ? -1 : 1, room: angled || vertical ? slot * 1.35 : slot * 0.78 + 12, end: dir > 0 ? 'right' : 'left' });
              // Linjenumrene står på linjen mellom siste viste stopp og endeholdeplassen
              if (dir > 0 || sm.branches.length > 1 || n > 1) lineChips(bez(from.p, p, 0.5), tm.lines);
            });
          });

          pts.forEach(p => {
            const P = map(p.a, p.o);
            svg('circle', { cx: P.x, cy: P.y, r, class: 'stop-dot' }, dots);
            label(p, p.n.name, { side: vertical && p.o < o0 - 1 ? -1 : 1 });
          });
        }
        side('down', m.down, 1);
        side('up', m.up, -1);

        // Holdeplassen: navnet som de andre, «Du er her» under
        const HP = map(here.a, here.o);
        const youG = svg('g', { class: 'you', transform: `translate(${HP.x}, ${HP.y})` }, dots);
        svg('circle', { r: 26, class: 'you-pulse' }, youG);
        svg('circle', { r: compact ? 15 : 18, class: 'you-ring' }, youG);
        svg('circle', { r: compact ? 10 : 12, class: 'you-dot' }, youG);
        label(here, m.hereName, { cls: 'here-label', weight: 650, sub: 'Du er her', room: slot * 1.1, big: true });

        busLayer = svg('g', { class: 'buses' }, frag);
        busEls.clear();
        G = { vertical, map, nodePos, termPos, here, o0, slot, aC };

        root.innerHTML = '';
        root.appendChild(frag);
        s = frag;
        if (animate) frag.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BV.anim.ms(600), easing: BV.anim.ease });
      }

      /* ----- Busser ----- */
      // Tidslinje for en reise i abstrakte koordinater: [{a,o,time}]
      function journeyTrack(j, k) {
        const pts = [];
        const calls = j.calls;
        const ahead = Math.max(1, Math.min(DEPTH, ctx.settings.view.busStops || 2));
        const upStart = Math.max(0, k - ahead);
        for (let i = upStart; i < k; i++) {
          const p = G.nodePos.get('up|' + calls[i].stopId);
          if (p) pts.push({ a: p.a, o: p.o, time: calls[i].time, appear: !pts.length });
        }
        if (!pts.length) pts.push({ ...G.here, time: calls[k].time - 60000, appear: true });
        pts.push({ ...G.here, time: calls[k].time });
        let lastI = k;
        for (let i = k + 1; i <= Math.min(calls.length - 1, k + DEPTH); i++) {
          const p = G.nodePos.get('down|' + calls[i].stopId);
          if (p) { pts.push({ a: p.a, o: p.o, time: calls[i].time }); lastI = i; }
        }
        // Videre mot endeholdeplassen: bussen tones ut et stykke inn på den stiplede linjen
        const lastP = pts[pts.length - 1];
        const term = G.termPos.get('down|' + calls[calls.length - 1].stopId);
        const nextCall = calls[lastI + 1];
        if (term && nextCall) {
          const q = bez(lastP, term, 0.4);
          pts.push({ a: q.a, o: q.o, time: nextCall.time, edge: true, curveFrom: lastP, curveTo: term, uMax: 0.4 });
        } else {
          pts.push({ a: lastP.a, o: lastP.o, time: lastP.time + 60000, edge: true });
        }
        return pts;
      }

      function busPosition(track, now) {
        if (track.length < 2 || now < track[0].time || now > track[track.length - 1].time) return null;
        for (let i = 0; i < track.length - 1; i++) {
          const a = track[i], b = track[i + 1];
          if (now >= a.time && now <= b.time) {
            const u = b.time === a.time ? 0 : (now - a.time) / (b.time - a.time);
            const p = b.curveFrom ? bez(b.curveFrom, b.curveTo, u * b.uMax) : bez(a, b, u);
            const fade = a.appear ? u * 2 : b.edge ? 1 - u : 1;
            return { ...p, fade: Math.min(1, Math.max(0, fade * 2.2)) };
          }
        }
        return null;
      }

      function makeBus(j) {
        const g = svg('g', { class: 'bus' + (G.vertical ? ' vertical' : '') }, busLayer);
        const inner = svg('g', { class: 'bus-inner' }, g);
        const code = String(j.lineCode);
        const bw = Math.max(36, 16 + code.length * 12);
        const st = BV.colors.chip(j.line || { code: j.lineCode }, ctx);
        if (st) g.classList.add('colored');
        if (G.vertical) {
          // Pille på linjen med pil nedover
          svg('rect', { x: -bw / 2, y: -17, width: bw, height: 34, rx: 10, class: 'bus-chip', style: st ? `fill:${st.bg}` : '' }, inner);
          const t = svg('text', { x: 0, y: 0.5, class: 'bus-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, inner);
          t.textContent = code;
          svg('path', { d: 'M -7 21 L 7 21 L 0 29 Z', class: 'bus-arrow' }, inner);
        } else {
          svg('line', { x1: 0, y1: -8, x2: 0, y2: -22, class: 'bus-stem' }, inner);
          svg('circle', { r: 5.5, class: 'bus-dot' }, inner);
          svg('rect', { x: -bw / 2, y: -56, width: bw, height: 34, rx: 10, class: 'bus-chip', style: st ? `fill:${st.bg}` : '' }, inner);
          const t = svg('text', { x: 0, y: -38.5, class: 'bus-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, inner);
          t.textContent = code;
          // Liten trekant på siden som viser kjøreretningen
          svg('path', { d: `M ${bw / 2 + 4} -45.5 L ${bw / 2 + 12} -39 L ${bw / 2 + 4} -32.5 Z`, class: 'bus-arrow' }, inner);
        }
        return g;
      }

      function renderBuses(now) {
        const m = model(ctx.data);
        if (!m || !busLayer || !G) return;
        const nextKey = (BV.util.upcoming(ctx.data, now, false)[0] || {}).journeyId;
        const keep = new Set();
        m.journeys.forEach(({ j, k }) => {
          const pos = busPosition(journeyTrack(j, k), now);
          if (!pos) return;
          keep.add(j.journeyId);
          const P = G.map(pos.a, pos.o);
          let g = busEls.get(j.journeyId);
          if (!g) {
            g = makeBus(j);
            busEls.set(j.journeyId, g);
            g.style.transition = 'none';
            g.style.transform = `translate(${P.x}px, ${P.y}px)`;
            g.getBoundingClientRect();
            g.style.transition = '';
          }
          g.style.transform = `translate(${P.x}px, ${P.y}px)`;
          g.style.opacity = pos.fade;
          // På nedre gren legger merket seg på linjen, så det ikke dekker stoppnavnene over
          if (!G.vertical) g.classList.toggle('on-line', pos.o > G.o0 + 4);
          g.classList.toggle('next', j.journeyId === nextKey);
        });
        busEls.forEach((g, id) => {
          if (keep.has(id)) return;
          busEls.delete(id);
          g.style.opacity = 0;
          setTimeout(() => g.remove(), 1200);
        });
      }

      /* ----- Størrelse: følg boksen bilde for bilde mens den animerer ----- */
      let rafPending = false;
      const ro = new ResizeObserver(entries => {
        const r = entries[entries.length - 1].contentRect;
        size = { w: Math.round(r.width), h: Math.round(r.height) };
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; render(Date.now(), true); });
      });
      ro.observe(root);

      function render(now, fromResize) {
        const m = model(ctx.data);
        if (!m) return;
        const sig = m.sig + '|' + size.w + 'x' + size.h + '|' + ctx.settings.view.labelAngle;
        if (sig !== builtSig) {
          const modelChanged = !builtSig || builtSig.split('|')[0] !== sig.split('|')[0];
          builtSig = sig;
          build(m, modelChanged && !fromResize);
          // Busser plasseres uten overgang etter ombygging, så de ikke glir fra feil sted
          renderBuses(now);
          return;
        }
        renderBuses(now);
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { builtSig = null; render(Date.now()); },
        resize() { },
        destroy() { ro.disconnect(); }
      };
    }
  };
})(window.BV);
