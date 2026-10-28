/* Redigering av layout direkte i visningen.
   Dra en boks for å flytte den, dra i hjørnet for å endre størrelse. Alt snapper til
   rutenettet (12 × 20). Bokser som står i veien bytter plass med den du drar, skyves ned,
   eller flyttes til første ledige plass. Er det ikke plass, blir skyggen rød og ingenting endres.
   Layouten lagres per kombinasjon av synlige bokser (f.eks. med og uten trafikkmelding). */
(function (BV) {
  const app = BV.app;
  const M = app.metrics;
  const MIN = { hero: [6, 6], departures: [4, 3], routes: [6, 2], clock: [3, 3], traffic: [4, 2], line: [3, 2] };

  let active = false;
  let drag = null;

  const ghost = document.createElement('div');
  ghost.className = 'edit-ghost';
  app.grid.appendChild(ghost);

  const bar = document.createElement('div');
  bar.className = 'edit-bar';
  bar.innerHTML = `
    <span class="eb-dot"></span>
    <span class="eb-text"><strong>Redigerer layout</strong><span class="eb-sub">Dra for å flytte · dra hjørnet for å endre størrelse</span></span>
    <button class="eb-btn" data-act="traffic" title="Bytt mellom layout med og uten trafikkmelding (T)">Trafikkmelding</button>
    <button class="eb-btn" data-act="reset">Tilbake til automatisk</button>
    <button class="eb-btn primary" data-act="done">Ferdig</button>`;
  document.body.appendChild(bar);
  bar.addEventListener('click', e => {
    const act = e.target.closest('button') && e.target.closest('button').dataset.act;
    if (act === 'done') toggle(false);
    if (act === 'traffic') { app.settings.sim.traffic = !app.settings.sim.traffic; BV.settings.changed('sim'); refresh(); }
    if (act === 'reset') {
      delete app.settings.manual[app.current.key];
      BV.settings.save(app.settings);
      app.relayout(true);
      BV.settings.refresh();
    }
  });

  function toStage(e) {
    const r = app.stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / BV.stageScale, y: (e.clientY - r.top) / BV.stageScale };
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const collide = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inGrid = p => p.x >= 0 && p.y >= 0 && p.x + p.w <= M.COLS && p.y + p.h <= M.ROWS;

  // Plasser target og flytt boksene som kolliderer. Returnerer ny layout eller null.
  function resolve(base, target, origin) {
    const out = [target];
    const fits = q => inGrid(q) && !out.some(o => collide(o, q));
    const others = base.filter(p => p.id !== target.id).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const o of others) {
      if (fits(o)) { out.push({ ...o }); continue; }
      let found = null;
      // 1) Bytt plass med boksen som dras
      if (origin) {
        const cands = [{ ...o, x: origin.x, y: origin.y }, { ...o, x: origin.x + origin.w - o.w, y: origin.y }, { ...o, x: origin.x, y: origin.y + origin.h - o.h }];
        found = cands.find(fits) || null;
      }
      // 2) Skyv nedover
      for (let y = o.y + 1; !found && y + o.h <= M.ROWS; y++) { const t = { ...o, y }; if (fits(t)) found = t; }
      // 3) Første ledige plass
      for (let y = 0; !found && y + o.h <= M.ROWS; y++)
        for (let x = 0; !found && x + o.w <= M.COLS; x++) { const t = { ...o, x, y }; if (fits(t)) found = t; }
      if (!found) return null;
      out.push(found);
    }
    return out;
  }

  function showGhost(p, valid) {
    const g = app.cellGeo(p);
    ghost.style.transform = `translate(${g.x}px, ${g.y}px)`;
    ghost.style.width = g.w + 'px';
    ghost.style.height = g.h + 'px';
    ghost.classList.toggle('invalid', !valid);
    ghost.classList.add('on');
  }

  function badge(id, p) {
    const b = app.boxes.get(id);
    if (!b) return;
    const prio = app.settings.widgets.findIndex(w => w.id === id) + 1;
    b.badge.textContent = `${prio} · ${BV.widgets[id].title} · ${p.w}×${p.h}`;
  }

  function placeOthers(layout, id) {
    layout.forEach(q => {
      if (q.id === id) return;
      const b = app.boxes.get(q.id);
      if (!b) return;
      const g = app.cellGeo(q);
      if (b.geo && b.geo.x === g.x && b.geo.y === g.y && b.geo.w === g.w && b.geo.h === g.h) return;
      app.setGeo(b.el, g);
      if (!b.geo || b.geo.w !== g.w || b.geo.h !== g.h) b.inst.resize(g);
      b.geo = g;
    });
  }

  function onDown(e) {
    if (!active || e.button > 0) return;
    const box = e.target.closest('.box');
    if (!box || box.classList.contains('leaving')) return;
    const id = box.dataset.id;
    const base = app.current.placed.map(q => ({ ...q }));
    const p = base.find(q => q.id === id);
    if (!p) return;
    e.preventDefault();
    const rz = e.target.closest('.rz');
    drag = {
      id, box, mode: rz ? 'resize' : 'move',
      // Hvilke kanter som flyttes: w/e (venstre/høyre) og n/s (topp/bunn)
      west: !!rz && rz.dataset.c.includes('w'), north: !!rz && rz.dataset.c.includes('n'),
      start: toStage(e),
      geo: app.cellGeo(p),            // slik boksen vises (kan være strukket opp i toppfeltet)
      raw: app.cellGeo(p, true),      // ren rutenettposisjon, brukes til snapping
      origin: { ...p },
      base, layout: base, valid: true, key: ''
    };
    box.classList.add('dragging');
    box.setPointerCapture && box.setPointerCapture(e.pointerId);
    showGhost(p, true);
  }

  function onMove(e) {
    if (!drag) return;
    const pt = toStage(e);
    const dx = pt.x - drag.start.x, dy = pt.y - drag.start.y;
    const b = app.boxes.get(drag.id);
    const o = drag.origin;
    const pitchX = M.COL_W + M.GAP, pitchY = M.ROW_H + M.GAP;
    let cand;
    if (drag.mode === 'move') {
      b.el.style.transform = `translate(${drag.geo.x + dx}px, ${drag.geo.y + dy}px)`;
      cand = {
        id: drag.id, w: o.w, h: o.h,
        x: clamp(Math.round((drag.raw.x + dx - M.PAD) / pitchX), 0, M.COLS - o.w),
        y: clamp(Math.round((drag.raw.y + dy - M.GRID_TOP) / pitchY), 0, M.ROWS - o.h)
      };
    } else {
      // Skalering fra hvilket som helst hjørne: motsatt kant står stille
      const [minW, minH] = MIN[drag.id] || [2, 2];
      const minWpx = minW * M.COL_W, minHpx = minH * M.ROW_H;
      const ddx = drag.west ? -dx : dx, ddy = drag.north ? -dy : dy;
      const wpx = Math.max(minWpx, drag.geo.w + ddx);
      const hpx = Math.max(minHpx, drag.geo.h + ddy);
      const rawW = Math.max(minWpx, drag.raw.w + ddx), rawH = Math.max(minHpx, drag.raw.h + ddy);
      const right = o.x + o.w, bottom = o.y + o.h;
      let x = o.x, y = o.y, w, h;
      if (drag.west) { x = clamp(right - Math.round((rawW + M.GAP) / pitchX), 0, right - minW); w = right - x; }
      else w = clamp(Math.round((rawW + M.GAP) / pitchX), minW, M.COLS - o.x);
      if (drag.north) { y = clamp(bottom - Math.round((rawH + M.GAP) / pitchY), 0, bottom - minH); h = bottom - y; }
      else h = clamp(Math.round((rawH + M.GAP) / pitchY), minH, M.ROWS - o.y);
      const px = drag.west ? drag.geo.x + drag.geo.w - wpx : drag.geo.x;
      const py = drag.north ? drag.geo.y + drag.geo.h - hpx : drag.geo.y;
      b.el.style.transform = `translate(${px}px, ${py}px)`;
      b.el.style.width = wpx + 'px';
      b.el.style.height = hpx + 'px';
      cand = { id: drag.id, x, y, w, h };
    }
    const key = `${cand.x},${cand.y},${cand.w},${cand.h}`;
    if (key === drag.key) return;
    drag.key = key;
    const res = resolve(drag.base, cand, drag.mode === 'move' ? o : null);
    drag.valid = !!res;
    drag.cand = cand;
    showGhost(cand, drag.valid);
    badge(drag.id, cand);
    if (res) {
      drag.layout = res;
      placeOthers(res, drag.id);
      if (drag.mode === 'resize') b.inst.resize(app.cellGeo(cand));
    } else {
      placeOthers(drag.base, drag.id);
    }
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    d.box.classList.remove('dragging');
    ghost.classList.remove('on');
    const final = d.valid ? d.layout : d.base;
    if (d.valid) {
      app.settings.manual[app.current.key] = final.map(q => ({ id: q.id, x: q.x, y: q.y, w: q.w, h: q.h }));
      BV.settings.save(app.settings);
    }
    // Slipp boksen: den glir på plass i rutenettet
    final.forEach(q => {
      const b = app.boxes.get(q.id);
      if (!b) return;
      const g = app.cellGeo(q);
      app.setGeo(b.el, g);
      if (!b.geo || b.geo.w !== g.w || b.geo.h !== g.h || q.id === d.id) b.inst.resize(g);
      b.geo = g;
      badge(q.id, q);
    });
    app.relayout(true);
    BV.settings.refresh();
  }

  function refresh() {
    app.boxes.forEach(b => {
      if (!b.el.querySelector('.rz')) {
        ['nw', 'ne', 'sw', 'se'].forEach(c => {
          const rz = document.createElement('div');
          rz.className = 'rz rz-' + c;
          rz.dataset.c = c;
          rz.title = 'Dra for å endre størrelse';
          b.el.appendChild(rz);
        });
      }
    });
    const manual = !!app.current.manual;
    bar.querySelector('[data-act="reset"]').disabled = !manual;
    bar.querySelector('.eb-sub').textContent = manual
      ? 'Egen layout for denne kombinasjonen · dra for å flytte, hjørnet for størrelse'
      : 'Automatisk layout · dra for å lage en egen';
    bar.querySelector('[data-act="traffic"]').classList.toggle('on', !!app.settings.sim.traffic);
  }

  function toggle(v) {
    active = v === undefined ? !active : v;
    document.body.classList.toggle('editing', active);
    app.fitStage();
    if (active) refresh();
    if (!active && drag) onUp();
  }

  app.grid.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);

  BV.editor = {
    toggle, refresh,
    get active() { return active; },
    get busy() { return !!drag; }
  };
})(window.BV);
