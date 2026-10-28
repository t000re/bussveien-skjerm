/* Trasélinje: 3 stopp bakover og 3 stopp framover fra holdeplassen.
   Hvis linjene deler seg (eller slår seg sammen), tegnes en gaffel: felles stamme,
   deretter én gren per retning med linjenummer ved enden. Bussene vises som små merker
   som glir langs linjen basert på sanntidstider. */
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
    while (true) {
      const live = seqs.filter(s => s.nodes.length > t);
      if (!live.length || live.length < seqs.length) break;
      const id = live[0].nodes[t].stopId;
      if (!live.every(s => s.nodes[t].stopId === id)) break;
      t++;
      if (t >= DEPTH) break;
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
    // Grenen med flest linjer går rett fram
    branches.sort((a, b) => b.lines.size - a.lines.size);
    return { trunk, branches };
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
      patterns.set(key, {
        key, lineCode: j.lineCode, line: j.line,
        up: j.calls.slice(Math.max(0, k - DEPTH), k).reverse().map(c => ({ stopId: c.stopId, name: c.name })),
        down: j.calls.slice(k + 1, k + 1 + DEPTH).map(c => ({ stopId: c.stopId, name: c.name }))
      });
    });
    if (!patterns.size) return null;
    const ps = Array.from(patterns.values());
    const up = buildSide(ps.map(p => ({ key: p.key, lineCode: p.lineCode, nodes: p.up })));
    const down = buildSide(ps.map(p => ({ key: p.key, lineCode: p.lineCode, nodes: p.down })));
    const sig = JSON.stringify([up.trunk.map(n => n.stopId), up.branches.map(b => b.nodes.map(n => n.stopId)),
      down.trunk.map(n => n.stopId), down.branches.map(b => [b.nodes.map(n => n.stopId), [...b.lines]])]);
    return { up, down, journeys, sig, patterns: ps };
  }

  let cache = { at: null, model: null };
  function model(data) {
    if (!data) return null;
    if (cache.at !== data) { cache = { at: data, model: buildModel(data) }; }
    return cache.model;
  }

  /* ---------- Geometri ---------- */
  function edgePoint(p, q, u) {
    if (Math.abs(p.y - q.y) < 0.5) return { x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u };
    // Kubisk Bézier med horisontale tangenter (samme som tegnet linje)
    const mx = (q.x - p.x) * 0.5;
    const P = [p, { x: p.x + mx, y: p.y }, { x: q.x - mx, y: q.y }, q];
    const v = 1 - u;
    return {
      x: v * v * v * P[0].x + 3 * v * v * u * P[1].x + 3 * v * u * u * P[2].x + u * u * u * P[3].x,
      y: v * v * v * P[0].y + 3 * v * v * u * P[1].y + 3 * v * u * u * P[2].y + u * u * u * P[3].y
    };
  }
  function edgeD(p, q) {
    if (Math.abs(p.y - q.y) < 0.5) return `M ${p.x} ${p.y} L ${q.x} ${q.y}`;
    const mx = (q.x - p.x) * 0.5;
    return `M ${p.x} ${p.y} C ${p.x + mx} ${p.y} ${q.x - mx} ${q.y} ${q.x} ${q.y}`;
  }

  BV.widgets.line = {
    title: 'Trasé',
    description: 'Stoppene før og etter, med gaffel der linjene deler seg',
    sizes: ['12x3', '12x2', '12x4'],

    available(data) { return { show: !!model(data), must: false }; },

    create(root, ctx) {
      root.classList.add('w-line');
      let geo = { w: 1032, h: 250 };
      let s = null, busLayer = null, layoutSig = null;
      let nodePos = null, mainY = 0;        // side|stopId -> {x,y}
      let tails = null;          // ends of the line for buses entering/leaving
      const busEls = new Map();

      function build(m) {
        root.innerHTML = '';
        busEls.clear();
        const W = geo.w, H = geo.h;
        s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'line-svg', preserveAspectRatio: 'xMidYMid meet' });
        root.appendChild(s);
        const compact = H < 200;
        const hasDownFork = m.down.branches.length > 1;
        const hasUpFork = m.up.branches.length > 1;
        const forked = hasDownFork || hasUpFork;
        const y0 = forked ? H * (compact ? 0.42 : 0.4) : H * 0.52;
        const dy = Math.min(H * 0.3, 90);
        const offsets = [0, dy, -dy];
        const padX = 28;
        const endRoom = hasDownFork || hasUpFork ? 110 : 10;
        const cx = W / 2;
        const slot = (W / 2 - padX - endRoom) / DEPTH;
        const fontSize = compact ? 17 : 19;
        mainY = y0;

        const defs = svg('defs', {}, s);
        ['L', 'R'].forEach(side => {
          const fork = side === 'L' ? hasUpFork : hasDownFork;
          const edge = fork ? endRoom - 6 : 0;
          const g = svg('linearGradient', { id: 'fade' + side + root.dataset.uid, gradientUnits: 'userSpaceOnUse', x1: side === 'L' ? edge : W - edge, x2: side === 'L' ? edge + slot * 0.55 : W - edge - slot * 0.55, y1: 0, y2: 0 }, defs);
          svg('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0 }, g);
          svg('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 1 }, g);
          const mask = svg('mask', { id: 'mask' + side + root.dataset.uid, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defs);
          svg('rect', { x: 0, y: 0, width: W, height: H, fill: `url(#fade${side}${root.dataset.uid})` }, mask);
        });

        // Linjefarger: hver linje får sin egen stripe der linjene går sammen
        const lineInfo = new Map(m.patterns.map(p => [p.lineCode, p.line || { code: p.lineCode }]));
        const colored = BV.colors.mode(ctx) !== 'neutral';
        const strokeOf = code => BV.colors.stroke(code, (lineInfo.get(code) || {}).color, ctx);
        function drawTrack(a, b, lines, cls, parent, extra = {}) {
          const codes = colored ? [...new Set(lines || [])].sort() : [];
          if (!codes.length) { svg('path', { d: edgeD(a, b), class: cls, ...extra }, parent); return; }
          const n = codes.length;
          const sw = n > 1 ? 7 : 10, gap = sw + 1.5;
          codes.forEach((code, i) => {
            const off = (i - (n - 1) / 2) * gap;
            svg('path', { d: edgeD({ x: a.x, y: a.y + off }, { x: b.x, y: b.y + off }), class: cls, style: `stroke:${strokeOf(code)};stroke-width:${sw}px`, ...extra }, parent);
          });
        }
        const allLines = m.patterns.map(p => p.lineCode);

        nodePos = new Map();
        const here = { x: cx, y: y0 };
        const tracks = svg('g', { class: 'tracks' }, s);
        const dots = svg('g', { class: 'dots' }, s);
        const labels = svg('g', { class: 'labels' }, s);
        tails = {};

        function side(name, sideModel, dir) {
          const pts = [];
          let prev = here;
          sideModel.trunk.forEach((n, i) => {
            const p = { x: cx + dir * (i + 1) * slot, y: y0, n };
            nodePos.set(name + '|' + n.stopId, p);
            drawTrack(dir > 0 ? prev : p, dir > 0 ? p : prev, allLines, 'track', tracks);
            pts.push(p); prev = p;
          });
          const trunkEnd = prev;
          const t = sideModel.trunk.length;
          const ends = [];
          sideModel.branches.forEach((b, bi) => {
            let bp = trunkEnd;
            b.nodes.forEach((n, i) => {
              const p = { x: cx + dir * (t + i + 1) * slot, y: y0 + offsets[bi], n, branch: bi };
              nodePos.set(name + '|' + n.stopId, p);
              drawTrack(dir > 0 ? bp : p, dir > 0 ? p : bp, [...b.lines], 'track' + (bi ? ' branch' : ''), tracks);
              pts.push(p); bp = p;
            });
            ends.push({ p: bp, lines: [...b.lines], bi });
          });
          if (!sideModel.branches.length) ends.push({ p: trunkEnd, lines: null, bi: 0 });
          // Haler ut mot kanten. Ved gaffel stopper halen før linjenumrene helt ytterst.
          const forkSide = sideModel.branches.length > 1;
          ends.forEach(e => {
            const ex = dir > 0 ? (forkSide ? W - endRoom + 6 : W) : (forkSide ? endRoom - 6 : 0);
            const tail = { x: ex, y: e.p.y };
            drawTrack(dir > 0 ? e.p : tail, dir > 0 ? tail : e.p, e.lines || allLines, 'track tail', tracks, { mask: `url(#mask${dir > 0 ? 'R' : 'L'}${root.dataset.uid})` });
            tails[name + '|' + (e.p.n ? e.p.n.stopId : 'here')] = tail;
            if (e.lines && forkSide) {
              // Linjenummer ytterst på hver gren
              const widths = e.lines.sort().map(code => Math.max(36, 16 + String(code).length * 12));
              const chipW = widths.reduce((a, w) => a + w + 4, -4);
              const gx = dir > 0 ? W - padX - chipW : padX;
              const g = svg('g', { class: 'branch-chips', transform: `translate(${gx}, ${e.p.y - 18})` }, labels);
              let cx0 = 0;
              e.lines.forEach((code, i) => {
                const st = BV.colors.chip(lineInfo.get(code) || { code }, ctx);
                svg('rect', { x: cx0, y: 0, width: widths[i], height: 36, rx: 10, class: 'bchip', style: st ? `fill:${st.bg}` : '' }, g);
                const tx = svg('text', { x: cx0 + widths[i] / 2, y: 19, class: 'bchip-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, g);
                tx.textContent = code;
                cx0 += widths[i] + 4;
              });
            }
          });
          pts.forEach(p => {
            svg('circle', { cx: p.x, cy: p.y, r: compact ? 8 : 10, class: 'stop-dot' }, dots);
            const tx = svg('text', { x: p.x, y: p.y + (compact ? 30 : 38), class: 'stop-label', 'text-anchor': 'middle', 'font-size': fontSize }, labels);
            tx.textContent = p.n.name;
            fitText(tx, slot * 0.96);
          });
        }
        side('down', m.down, 1);
        side('up', m.up, -1);

        // Du er her
        const youG = svg('g', { class: 'you', transform: `translate(${here.x}, ${here.y})` }, dots);
        svg('circle', { r: 26, class: 'you-pulse' }, youG);
        svg('circle', { r: compact ? 15 : 18, class: 'you-ring' }, youG);
        svg('circle', { r: compact ? 10 : 12, class: 'you-dot' }, youG);
        const yl = svg('text', { x: here.x, y: here.y + (compact ? 30 : 38), class: 'stop-label you-label', 'text-anchor': 'middle', 'font-size': fontSize }, labels);
        yl.textContent = 'Du er her';

        busLayer = svg('g', { class: 'buses' }, s);
        nodePos.set('here', here);
        root.firstChild.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BV.anim.ms(600), easing: BV.anim.ease });
      }

      function fitText(t, maxW) {
        try {
          let txt = t.textContent;
          if (t.getComputedTextLength() <= maxW) return;
          while (txt.length > 3 && t.getComputedTextLength() > maxW) { txt = txt.slice(0, -1); t.textContent = txt.trimEnd() + '…'; }
        } catch (e) { }
      }

      // Bygger en tidslinje av punkter for en reise: [{x,y,time}].
      // Bussen dukker først opp når den er innenfor de N siste stoppene før holdeplassen,
      // og glir ut mot høyre kant etter at den har passert.
      function journeyTrack(j, k) {
        const pts = [];
        const calls = j.calls;
        const ahead = Math.max(1, Math.min(DEPTH, ctx.settings.view.busStops || 2));
        const upStart = Math.max(0, k - ahead);
        if (upStart === k) pts.push({ ...nodePos.get('here'), time: calls[k].time - 60000, appear: true });
        for (let i = upStart; i < k; i++) {
          const p = nodePos.get('up|' + calls[i].stopId);
          if (p) pts.push({ x: p.x, y: p.y, time: calls[i].time, appear: !pts.length });
        }
        pts.push({ ...nodePos.get('here'), time: calls[k].time });
        let last = null;
        for (let i = k + 1; i <= Math.min(calls.length - 1, k + DEPTH); i++) {
          const p = nodePos.get('down|' + calls[i].stopId);
          if (p) { pts.push({ x: p.x, y: p.y, time: calls[i].time }); last = { i, p, id: calls[i].stopId }; }
        }
        const endKey = last ? 'down|' + last.id : 'down|here';
        const tail = tails[endKey];
        if (tail) {
          const after = calls[(last ? last.i : k) + 1];
          const lastT = pts[pts.length - 1].time;
          pts.push({ x: tail.x, y: tail.y, time: after ? after.time : lastT + 3 * 60000, edge: true });
        }
        return pts;
      }

      function busPosition(track, now) {
        if (track.length < 2 || now < track[0].time || now > track[track.length - 1].time) return null;
        for (let i = 0; i < track.length - 1; i++) {
          const a = track[i], b = track[i + 1];
          if (now >= a.time && now <= b.time) {
            const u = b.time === a.time ? 0 : (now - a.time) / (b.time - a.time);
            const p = edgePoint(a, b, u);
            const fade = a.appear ? u * 2 : a.edge ? u : b.edge ? 1 - u : 1;
            return { ...p, fade: Math.min(1, fade * 2.2) };
          }
        }
        return null;
      }

      function renderBuses(now) {
        const m = model(ctx.data);
        if (!m || !busLayer) return;
        const nextKey = (BV.util.upcoming(ctx.data, now, false)[0] || {}).journeyId;
        const keep = new Set();
        m.journeys.forEach(({ j, k }) => {
          const pos = busPosition(journeyTrack(j, k), now);
          if (!pos) return;
          keep.add(j.journeyId);
          let g = busEls.get(j.journeyId);
          if (!g) {
            g = svg('g', { class: 'bus' }, busLayer);
            const inner = svg('g', { class: 'bus-inner' }, g);
            svg('line', { x1: 0, y1: -8, x2: 0, y2: -22, class: 'bus-stem' }, inner);
            svg('circle', { r: 5.5, class: 'bus-dot' }, inner);
            const bw = Math.max(36, 16 + String(j.lineCode).length * 12);
            const st = BV.colors.chip(j.line || { code: j.lineCode }, ctx);
            if (st) g.classList.add('colored');
            svg('rect', { x: -bw / 2, y: -56, width: bw, height: 34, rx: 10, class: 'bus-chip', style: st ? `fill:${st.bg}` : '' }, inner);
            const t = svg('text', { x: 0, y: -38.5, class: 'bus-text', 'text-anchor': 'middle', 'dominant-baseline': 'central', style: st ? `fill:${st.fg}` : '' }, inner);
            t.textContent = j.lineCode;
            busEls.set(j.journeyId, g);
            g.style.transition = 'none';
            g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
            g.getBoundingClientRect();
            g.style.transition = '';
          }
          g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
          g.style.opacity = pos.fade;
          // På nedre gren legger merket seg på linjen, så det ikke dekker stoppnavnene over
          g.classList.toggle('on-line', pos.y > mainY + 4);
          g.classList.toggle('next', j.journeyId === nextKey);
        });
        busEls.forEach((g, id) => {
          if (keep.has(id)) return;
          busEls.delete(id);
          g.style.opacity = 0;
          setTimeout(() => g.remove(), 1200);
        });
      }

      function render(now) {
        const m = model(ctx.data);
        if (!m) return;
        const sig = m.sig + '|' + Math.round(geo.w) + 'x' + Math.round(geo.h);
        if (sig !== layoutSig) { layoutSig = sig; build(m); }
        renderBuses(now);
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { layoutSig = null; busEls.clear(); render(Date.now()); },
        resize(g) { geo = { w: g.w, h: g.h }; render(Date.now()); }
      };
    }
  };
})(window.BV);
