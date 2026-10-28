/* Trasélinje: et valgfritt antall stopp før og etter holdeplassen, pluss start- og
   endeholdeplass ytterst (stiplet linje når det er skjulte stopp imellom).

   Når linjene deler seg, får hver gren og hver endeholdeplass sitt eget «spor» (lane).
   Spor 0 er hovedlinjen; de andre legges over (til venstre i vertikal). Gaffelen går ut
   rett etter siste felles stopp. Stoppnavn på hovedlinjen står under, navn på øvre gren
   står over, og endeholdeplassene står vannrett ved prikken med linjenummer.

   Boksen tegnes vertikalt når den er høyere enn den er bred. All geometri regnes i et
   abstrakt rom (a = langs linjen, o = på tvers) og speiles til x/y etter retning. */
(function (BV) {
  const { svg } = BV.util;

  function opts(ctx) {
    const v = ctx.settings.view;
    return {
      before: Math.max(1, Math.min(5, v.stopsBefore || 3)),
      after: Math.max(1, Math.min(5, v.stopsAfter || 3)),
      origin: v.showOrigin !== false,
      terminus: v.showTerminus !== false
    };
  }

  /* ---------- Modell ---------- */
  function hereIndex(j, stop) {
    let i = j.calls.findIndex(c => c.quayId === stop.quayId);
    if (i < 0) i = j.calls.findIndex(c => c.stopId === stop.stopPlaceId);
    return i;
  }

  function buildSide(seqs, depth) {
    // seqs: [{ key, lineCode, nodes: [{stopId, name}] }] – nærmest holdeplassen først
    let t = 0;
    while (t < depth) {
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
    if (branches.length === 1) { trunk = trunk.concat(branches[0].nodes); branches = []; }
    branches.sort((a, b) => b.lines.size - a.lines.size); // grenen med flest linjer går rett fram
    return { trunk, branches, trunkKeys: seqs.map(s => s.key) };
  }

  function buildModel(data, o) {
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
        up: j.calls.slice(Math.max(0, k - o.before), k).reverse().map(node),
        down: j.calls.slice(k + 1, k + 1 + o.after).map(node),
        origin: o.origin && k - o.before > 0 ? { ...node(j.calls[0]), gap: k - o.before > 1 } : null,
        terminus: o.terminus && last > k + o.after ? { ...node(j.calls[last]), gap: last - (k + o.after) > 1 } : null,
        hiddenUp: k - o.before > 0, hiddenDown: last > k + o.after
      });
    });
    if (!patterns.size) return null;
    const ps = Array.from(patterns.values());
    const byKey = new Map(ps.map(p => [p.key, p]));

    function side(prop, hiddenProp, nodesProp, depth) {
      const sm = buildSide(ps.map(p => ({ key: p.key, lineCode: p.lineCode, nodes: p[nodesProp] })), depth);
      const list = sm.branches.length ? sm.branches.map((b, bi) => ({ bi, keys: b.keys })) : [{ bi: 0, keys: sm.trunkKeys }];
      // Én node per endeholdeplass, selv om flere grener ender der (slås sammen på navn)
      const termMap = new Map();
      sm.ends = list.map(e => {
        const end = { bi: e.bi, hidden: false };
        e.keys.forEach(k => {
          const p = byKey.get(k), t = p[prop];
          if (p[hiddenProp]) end.hidden = true;
          if (!t) return;
          const key = t.name.trim().toLowerCase();
          if (!termMap.has(key)) termMap.set(key, { ...t, lines: new Set(), bis: new Set() });
          const tm = termMap.get(key);
          tm.lines.add(p.lineCode); tm.bis.add(e.bi); tm.gap = tm.gap || t.gap;
        });
        return end;
      });
      // Spor: hver gren får sitt eget; endeholdeplassen fortsetter helst rett fram på en gren den hører til
      const branchLane = {};
      list.forEach((e, i) => { branchLane[e.bi] = i; });
      let maxLane = list.length - 1;
      const taken = new Set();
      const terms = [...termMap.values()].sort((a, b) => a.bis.size - b.bis.size || b.lines.size - a.lines.size);
      terms.forEach(tm => {
        const cands = [...tm.bis].map(bi => branchLane[bi]).sort((a, b) => b - a);
        const free = cands.find(l => !taken.has(l));
        tm.lane = free !== undefined ? free : ++maxLane;
        taken.add(tm.lane);
      });
      sm.terms = terms.sort((a, b) => a.lane - b.lane);
      sm.lanes = maxLane + 1;
      sm.branchLane = bi => branchLane[bi] || 0;
      return sm;
    }
    const up = side('origin', 'hiddenUp', 'up', o.before);
    const down = side('terminus', 'hiddenDown', 'down', o.after);
    const sig = JSON.stringify([o, up.trunk.map(n => n.stopId), up.branches.map(b => b.nodes.map(n => n.stopId)),
      down.trunk.map(n => n.stopId), down.branches.map(b => [b.nodes.map(n => n.stopId), [...b.lines]]),
      up.terms.map(t => [t.name, t.lane]), down.terms.map(t => [t.name, t.lane]), up.ends.map(e => e.hidden), down.ends.map(e => e.hidden), data.stop.name]);
    return { up, down, journeys, sig, patterns: ps, hereName: data.stop.name || 'Her', o };
  }

  let cache = { at: null, key: '', model: null };
  function model(data, ctx) {
    if (!data) return null;
    const o = opts(ctx);
    const key = JSON.stringify(o);
    if (cache.at !== data || cache.key !== key) cache = { at: data, key, model: buildModel(data, o) };
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
    if (maxW <= 24) return '';
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

    available(data) { return { show: !!model(data, BV.app ? BV.app.ctx : { settings: { view: {} } }), must: false }; },

    create(root, ctx) {
      root.classList.add('w-line');
      let size = { w: 0, h: 0 };
      let busLayer = null, builtSig = null;
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
        const r = compact ? 8 : 10;
        const lanes = Math.max(m.up.lanes, m.down.lanes, 1);
        const forked = lanes > 1;
        // Grener med synlige stopp over hovedlinjen får navnene sine over
        const topLabels = [m.up, m.down].some(sm => sm.branches.some((b, bi) => sm.branchLane(bi) > 0));

        // På tvers: hvor hovedlinjen ligger og avstanden mellom sporene
        let o0, dy, below, above;
        if (vertical) {
          dy = Math.min(C * 0.2, 64);
          o0 = forked ? Math.min(C - 110, 40 + (lanes - 1) * dy + (topLabels ? 90 : 0)) : Math.min(C * 0.3, 90);
          o0 = Math.max(o0, 30 + (lanes - 1) * dy);
        } else {
          // Mål navnene som skal stå under og over linjen, og fordel høyden etter behov
          const bottomNames = [...m.up.trunk, ...m.down.trunk, ...[m.up, m.down].flatMap(sm => sm.branches.filter((b, bi) => sm.branchLane(bi) === 0).flatMap(b => b.nodes))].map(n => n.name);
          const topNames = [m.up, m.down].flatMap(sm => sm.branches.filter((b, bi) => sm.branchLane(bi) > 0).flatMap(b => b.nodes)).map(n => n.name);
          const widest = names => Math.min(260, Math.max(0, ...names.map(t => textWidth(t, fs))));
          const hereW = textWidth(m.hereName, fs, 650);
          if (angled) {
            below = Math.max(widest(bottomNames), hereW + 2 * fs) * Math.SQRT1_2 + 26;
            above = topLabels ? widest(topNames) * Math.SQRT1_2 + 26 : (forked ? 26 : 62);
          } else {
            below = (compact ? 30 : 38) + 2 * fs + 6;
            above = topLabels ? (compact ? 20 : 24) + fs + 8 : (forked ? 26 : 62);
          }
          const minAbove = topLabels ? 40 : (forked ? 24 : 58), minBelow = angled ? 60 : below;
          let dyPref = 54;
          let need = above + below + (lanes - 1) * dyPref;
          if (need > C && lanes > 1) { dyPref = Math.max(32, dyPref - (need - C) / (lanes - 1)); need = above + below + (lanes - 1) * dyPref; }
          if (need > C) {
            // Ikke plass til alt: krymp navnerommet forholdsmessig (navnene kortes ned)
            const over = need - C;
            const flexA = Math.max(0, above - minAbove), flexB = Math.max(0, below - minBelow);
            const k = Math.min(1, over / Math.max(1, flexA + flexB));
            above -= flexA * k; below -= flexB * k;
          }
          dy = lanes > 1 ? dyPref : 0;
          const used = (lanes - 1) * dy;
          const spare = Math.max(0, C - above - below - used);
          o0 = above + used + spare * (topLabels ? 0.5 : 0.4);
        }
        const laneO = lane => o0 - lane * dy;

        // Langs linjen: synlige stopp nær holdeplassen, endeholdeplassene helt ytterst
        const padEdge = vertical ? 26 : 28;
        const lineInfo = new Map(m.patterns.map(p => [p.lineCode, p.line || { code: p.lineCode }]));
        const visCount = sm => sm.trunk.length + Math.max(0, ...sm.branches.map(b => b.nodes.length));
        // Hver side: synlige stopp, deretter enten endeholdeplass (navn ytterst) eller en
        // stiplet stump helt ut til kanten når linjen fortsetter. Det som er igjen av lengden
        // fordeles på de stiplede strekkene, så traseen alltid fyller hele boksen.
        const sideInfo = sm => {
          const hasTerm = sm.terms.length > 0;
          const stub = !hasTerm && sm.ends.some(e => e.hidden);
          const name = hasTerm && !vertical ? Math.min(260, Math.max(...sm.terms.map(t => textWidth(t.name, fs, 600)))) : 0;
          return { hasTerm, stub, flex: hasTerm || stub, reserve: hasTerm ? (vertical ? 4 : r + 10 + name) : 0, n: visCount(sm) };
        };
        const sUp = sideInfo(m.up), sDown = sideInfo(m.down);
        const minGap = angled || vertical ? 56 : 40;
        const [minSlot, maxSlot] = vertical ? [56, 190] : angled ? [56, 120] : [88, 180];
        const gapMin = si => si.hasTerm ? minGap : si.stub ? 36 : 0;
        const nTot = Math.max(1, sUp.n + sDown.n);
        const usable = L - 2 * padEdge;
        let fixed = sUp.reserve + sDown.reserve + gapMin(sUp) + gapMin(sDown);
        const slot = Math.max(minSlot, Math.min(maxSlot, (usable - fixed) / nTot));
        // Ikke nok plass: endeholdeplassnavnene kortes ned
        const squeeze = Math.max(0, fixed + slot * nTot - usable);
        if (squeeze) {
          const tot = Math.max(1, sUp.reserve + sDown.reserve);
          [sUp, sDown].forEach(si => { if (si.reserve) si.reserve = Math.max(r + 60, si.reserve - squeeze * si.reserve / tot); });
          fixed = sUp.reserve + sDown.reserve + gapMin(sUp) + gapMin(sDown);
        }
        const extra = Math.max(0, usable - fixed - slot * nTot);
        const flexCount = (sUp.flex ? 1 : 0) + (sDown.flex ? 1 : 0);
        const gapUp = gapMin(sUp) + (sUp.flex ? extra / flexCount : 0);
        const shift = flexCount ? 0 : extra / 2;   // ingen stiplede strekk: midtstill hele traseen
        const aC = padEdge + shift + sUp.reserve + gapUp + sUp.n * slot;
        const termA = dir => dir > 0 ? L - padEdge - sDown.reserve : padEdge + sUp.reserve;
        const nameRoom = dir => Math.max(40, (dir > 0 ? sDown : sUp).reserve - r - 10);

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
          const n = codes.length, sw = n > 1 ? 6 : 10, gap = sw + 1.5;
          codes.forEach((code, i) => {
            const off = (i - (n - 1) / 2) * gap;
            svg('path', { d: pathD({ a: p.a, o: p.o + off }, { a: q.a, o: q.o + off }), class: cls, style: `stroke:${strokeOf(code)};stroke-width:${sw}px` }, tracks);
          });
        }
        const seg = (dir, p, q, lines, cls) => track(dir > 0 ? p : q, dir > 0 ? q : p, lines, cls);

        // Etikett for et stopp. above = navnet står over linjen (øvre gren)
        function label(p, text, o = {}) {
          const P = map(p.a, p.o);
          const cls = 'stop-label' + (o.cls ? ' ' + o.cls : '');
          const weight = o.weight || 500;
          if (vertical) {
            const side = o.above ? -1 : 1;
            const room = side > 0 ? C - p.o - 26 : p.o - 26;
            const anchor = side > 0 ? 'start' : 'end';
            const t = svg('text', { x: P.x + side * 22, y: o.sub ? P.y - 11 : P.y, class: cls, 'text-anchor': anchor, 'dominant-baseline': 'central', 'font-size': fs }, labels);
            t.textContent = fit(text, fs, room, weight);
            if (o.sub) {
              const s2 = svg('text', { x: P.x + side * 22, y: P.y + 12, class: 'stop-label you-sub', 'text-anchor': anchor, 'dominant-baseline': 'central', 'font-size': fs - 3 }, labels);
              s2.textContent = o.sub;
            }
          } else if (angled) {
            const off = o.big ? 14 : 4;
            const room = o.above ? (p.o - 14) / Math.SQRT1_2 - 6 : (C - p.o - 16) / Math.SQRT1_2 - 6;
            const tf = o.above ? `translate(${P.x + off}, ${P.y - 14 - off}) rotate(-45)` : `translate(${P.x + off}, ${P.y + 14 + off}) rotate(45)`;
            const g = svg('g', { transform: tf }, labels);
            const t = svg('text', { x: 0, y: 0, class: cls, 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': fs }, g);
            t.textContent = fit(text, fs, Math.min(room, 280), weight);
            if (o.sub) {
              const s2 = svg('text', { x: 0, y: fs + 2, class: 'stop-label you-sub', 'text-anchor': 'start', 'dominant-baseline': 'central', 'font-size': fs - 3 }, g);
              s2.textContent = o.sub;
            }
          } else {
            const y = o.above ? P.y - (compact ? 20 : 24) : P.y + (compact ? 30 : 38);
            const t = svg('text', { x: P.x, y, class: cls, 'text-anchor': 'middle', 'font-size': fs }, labels);
            t.textContent = fit(text, fs, o.room || slot * 0.94, weight);
            if (o.sub) {
              const s2 = svg('text', { x: P.x, y: y + fs + 2, class: 'stop-label you-sub', 'text-anchor': 'middle', 'font-size': fs - 3 }, labels);
              s2.textContent = o.sub;
            }
          }
        }

        // Endeholdeplass: vannrett navn ved siden av prikken, linjenummer mellom prikk og navn
        function termLabel(p, tm, dir, room) {
          const P = map(p.a, p.o);
          const sideDir = vertical ? 1 : dir;
          const x = P.x + sideDir * (r + 10);
          if (vertical) room = C - x - 10;
          const t = svg('text', { x, y: P.y, class: 'stop-label term-label', 'text-anchor': sideDir > 0 ? 'start' : 'end', 'dominant-baseline': 'central', 'font-size': fs }, labels);
          t.textContent = fit(tm.name, fs, room, 600);
        }

        const nodePos = new Map();
        const gapPath = new Map();  // side|stopId -> { from, mid } – første del av veien mot endeholdeplassen
        const here = { a: aC, o: o0 };

        function side(name, sm, dir) {
          const pts = [];
          const endPos = {};
          let prev = here;
          sm.trunk.forEach((nd, i) => {
            const p = { a: aC + dir * (i + 1) * slot, o: o0, n: nd };
            nodePos.set(name + '|' + nd.stopId, p);
            seg(dir, prev, p, allLines, 'track');
            pts.push(p); prev = p;
          });
          const trunkEnd = prev, t = sm.trunk.length;
          if (!sm.branches.length) endPos[0] = { p: trunkEnd, lines: allLines };
          sm.branches.forEach((b, bi) => {
            let bp = trunkEnd;
            const o = laneO(sm.branchLane(bi));
            b.nodes.forEach((nd, i) => {
              const p = { a: aC + dir * (t + i + 1) * slot, o, n: nd, above: o < o0 - 1 };
              nodePos.set(name + '|' + nd.stopId, p);
              seg(dir, bp, p, [...b.lines], 'track');
              pts.push(p); bp = p;
            });
            endPos[bi] = { p: bp, lines: [...b.lines] };
          });

          // Mot start-/endeholdeplass: gaffelen går ut rett etter siste viste stopp
          const aEnd = termA(dir);
          sm.ends.forEach(e => {
            const from = endPos[e.bi];
            if (from && e.hidden && !sm.terms.some(t => t.bis.has(e.bi))) {
              // Linjen fortsetter, men endeholdeplassen vises ikke: stiplet helt ut til kanten
              seg(dir, from.p, { a: dir > 0 ? L - padEdge : padEdge, o: from.p.o }, from.lines, 'track gap');
            }
          });
          sm.terms.forEach((tm, i) => {
            const o = laneO(tm.lane);
            // Vertikalt: endeholdeplassene trappes, så navnene (til høyre) ikke krysser andre spor
            const a = vertical ? aEnd - dir * (sm.terms.length - 1 - i) * 46 : aEnd;
            const p = { a, o, n: tm };
            const cls = 'track' + (tm.gap ? ' gap' : '');
            [...tm.bis].forEach(bi => {
              const from = endPos[bi];
              if (!from) return;
              const forkLen = Math.min(Math.max(slot * 0.9, 50), Math.abs(a - from.p.a) * 0.45);
              const mid = { a: from.p.a + dir * forkLen, o };
              seg(dir, from.p, mid, [...tm.lines], cls);
              seg(dir, mid, p, [...tm.lines], cls);
              gapPath.set(name + '|' + tm.name.trim().toLowerCase() + '|' + Math.round(from.p.o), { from: from.p, mid });
            });
            const P = map(p.a, p.o);
            svg('circle', { cx: P.x, cy: P.y, r: r + 1, class: 'term-dot' }, dots);
            termLabel(p, tm, dir, nameRoom(dir));
          });

          pts.forEach(p => {
            const P = map(p.a, p.o);
            svg('circle', { cx: P.x, cy: P.y, r, class: 'stop-dot' }, dots);
            label(p, p.n.name, { above: p.above });
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
        // Med gaffel legger bussmerkene seg på linjen (ingen «stilk»), så de ikke kolliderer med sporene over
        G = { vertical, pill: vertical || forked, map, nodePos, gapPath, here };

        root.innerHTML = '';
        root.appendChild(frag);
        if (animate) frag.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BV.anim.ms(600), easing: BV.anim.ease });
      }

      /* ----- Busser ----- */
      function journeyTrack(j, k, o) {
        const pts = [];
        const calls = j.calls;
        const ahead = Math.max(1, Math.min(o.before, ctx.settings.view.busStops || 2));
        for (let i = Math.max(0, k - ahead); i < k; i++) {
          const p = G.nodePos.get('up|' + calls[i].stopId);
          if (p) pts.push({ a: p.a, o: p.o, time: calls[i].time, appear: !pts.length });
        }
        if (!pts.length) pts.push({ ...G.here, time: calls[k].time - 60000, appear: true });
        pts.push({ ...G.here, time: calls[k].time });
        let lastI = k;
        for (let i = k + 1; i <= Math.min(calls.length - 1, k + o.after); i++) {
          const p = G.nodePos.get('down|' + calls[i].stopId);
          if (p) { pts.push({ a: p.a, o: p.o, time: calls[i].time }); lastI = i; }
        }
        // Videre: bussen følger gaffelen mot sin endeholdeplass og tones ut
        const lastP = pts[pts.length - 1];
        const gp = G.gapPath.get('down|' + calls[calls.length - 1].name.trim().toLowerCase() + '|' + Math.round(lastP.o));
        const nextCall = calls[lastI + 1];
        if (gp && nextCall) pts.push({ ...gp.mid, time: nextCall.time, edge: true, curveFrom: gp.from, curveTo: gp.mid });
        else pts.push({ a: lastP.a, o: lastP.o, time: lastP.time + 60000, edge: true });
        return pts;
      }

      function busPosition(track, now) {
        if (track.length < 2 || now < track[0].time || now > track[track.length - 1].time) return null;
        for (let i = 0; i < track.length - 1; i++) {
          const a = track[i], b = track[i + 1];
          if (now >= a.time && now <= b.time) {
            const u = b.time === a.time ? 0 : (now - a.time) / (b.time - a.time);
            const p = b.curveFrom ? bez(b.curveFrom, b.curveTo, u) : bez(a, b, u);
            const fade = a.appear ? u * 2 : b.edge ? 1 - u : 1;
            return { ...p, fade: Math.min(1, Math.max(0, fade * 2.2)) };
          }
        }
        return null;
      }

      function makeBus(j) {
        const g = svg('g', { class: 'bus' + (G.pill ? ' pill' : '') }, busLayer);
        const inner = svg('g', { class: 'bus-inner' }, g);
        const code = String(j.lineCode);
        const bw = Math.max(34, 14 + code.length * 12);
        const st = BV.colors.chip(j.line || { code: j.lineCode }, ctx);
        if (st) g.classList.add('colored');
        const cy = G.pill ? 0 : -39;   // midten av merket
        if (!G.pill) {
          svg('line', { x1: 0, y1: -8, x2: 0, y2: -22, class: 'bus-stem' }, inner);
          svg('circle', { r: 5.5, class: 'bus-dot' }, inner);
        }
        svg('rect', { x: -bw / 2, y: cy - 16, width: bw, height: 32, rx: 9, class: 'bus-chip', style: st ? `fill:${st.bg}` : '' }, inner);
        const t = svg('text', { x: 0, y: cy + 0.5, class: 'bus-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, inner);
        t.textContent = code;
        // Liten trekant som viser kjøreretningen (høyre, eller ned i vertikal)
        const d = G.vertical ? `M -7 ${cy + 20} L 7 ${cy + 20} L 0 ${cy + 28} Z` : `M ${bw / 2 + 4} ${cy - 6.5} L ${bw / 2 + 12} ${cy} L ${bw / 2 + 4} ${cy + 6.5} Z`;
        svg('path', { d, class: 'bus-arrow' }, inner);
        return g;
      }

      function renderBuses(now) {
        const m = model(ctx.data, ctx);
        if (!m || !busLayer || !G) return;
        const nextKey = (BV.util.upcoming(ctx.data, now, false)[0] || {}).journeyId;
        const keep = new Set();
        m.journeys.forEach(({ j, k }) => {
          const pos = busPosition(journeyTrack(j, k, m.o), now);
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
        const rc = entries[entries.length - 1].contentRect;
        size = { w: Math.round(rc.width), h: Math.round(rc.height) };
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => { rafPending = false; render(Date.now(), true); });
      });
      ro.observe(root);

      function render(now, fromResize) {
        const m = model(ctx.data, ctx);
        if (!m) return;
        const sig = m.sig + '§' + size.w + 'x' + size.h + '§' + ctx.settings.view.labelAngle;
        if (sig !== builtSig) {
          const modelChanged = !builtSig || builtSig.split('§')[0] !== m.sig;
          builtSig = sig;
          build(m, modelChanged && !fromResize);
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
