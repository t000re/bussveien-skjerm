/* Oppstart: skalerer «scenen» (1080×1920), henter data, beregner bento-layout og
   animerer infoboksene mellom layoutene. */
(function (BV) {
  const STAGE_W = 1080, STAGE_H = 1920;
  const PAD = 24, GAP = 16, HEADER_H = 100;
  const GRID_TOP = PAD + HEADER_H + GAP;
  const GRID_H = STAGE_H - GRID_TOP - PAD;
  const COLS = BV.layout.COLS, ROWS = BV.layout.ROWS;
  const COL_W = (STAGE_W - 2 * PAD - (COLS - 1) * GAP) / COLS;
  const ROW_H = (GRID_H - (ROWS - 1) * GAP) / ROWS;
  const PANEL_W = 460;

  const ENTUR_INTERVAL = 20000;
  const DEMO_INTERVAL = 10000;

  const $ = id => document.getElementById(id);
  const stage = $('stage'), grid = $('grid'), overlay = $('gridOverlay');

  const settings = BV.settings.load();
  const ctx = { settings, data: null, raw: null };
  const boxes = new Map();
  const bootTime = Date.now();
  let lastSig = null;
  let uid = 0;

  function cellGeo(p) {
    return {
      x: PAD + p.x * (COL_W + GAP),
      y: GRID_TOP + p.y * (ROW_H + GAP),
      w: p.w * COL_W + (p.w - 1) * GAP,
      h: p.h * ROW_H + (p.h - 1) * GAP,
      cols: p.w, rows: p.h
    };
  }

  /* ---------- Skalering ---------- */
  function fitStage() {
    const panel = BV.settings.isOpen && window.innerWidth > 900 ? PANEL_W : 0;
    const editing = document.body.classList.contains('editing');
    const vw = window.innerWidth - panel, vh = window.innerHeight - (editing ? 96 : 0);
    const margin = panel || editing ? 24 : 0;
    const s = Math.min((vw - margin * 2) / STAGE_W, (vh - margin * 2) / STAGE_H);
    const x = (vw - STAGE_W * s) / 2, y = (vh - STAGE_H * s) / 2;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    BV.stageScale = s;
  }

  /* ---------- Simulering og effektive data ---------- */
  function autoTrafficPhase(now) {
    const t = (now - bootTime) / 1000 - 12;
    if (t < 0) return null;
    const cycle = Math.floor(t / 70);
    return (t % 70) < 32 ? { index: cycle % 3, count: cycle % 2 ? 2 : 1 } : null;
  }

  function effective(raw, now) {
    if (!raw) return null;
    const d = Object.assign({}, raw);
    let sim = null;
    if (settings.sim.traffic) sim = { index: 0, count: 1 };
    else if (settings.sim.autoTraffic && raw.source === 'demo' && !(BV.editor && BV.editor.active)) sim = autoTrafficPhase(now);
    if (sim) {
      const extra = [];
      for (let i = 0; i < sim.count; i++) extra.push(BV.data.DEMO_SITUATIONS[(sim.index + i) % BV.data.DEMO_SITUATIONS.length]);
      d.situations = (raw.situations || []).concat(extra);
    }
    return d;
  }

  function refreshEffective(now) {
    ctx.data = effective(ctx.raw, now);
  }

  /* ---------- Layout ---------- */
  function layoutItems(now) {
    const items = [];
    settings.widgets.forEach(w => {
      const def = BV.widgets[w.id];
      if (!def || (!w.enabled && !def.required)) return;
      const av = def.available(ctx.data, w, now);
      if (!av.show) return;
      items.push({ id: w.id, sizes: w.sizes.map(BV.layout.parseSize), must: !!(av.must || def.required), noStretch: !!def.noStretch });
    });
    return items;
  }

  // Nøkkel for hvilke bokser som vises – egne (manuelle) layouter lagres per kombinasjon
  function setKey(items) { return items.map(i => i.id).sort().join(','); }
  let current = { key: null, placed: [] };

  function relayout(force) {
    if (BV.editor && BV.editor.busy) return;
    const now = Date.now();
    const items = layoutItems(now);
    const key = setKey(items);
    const manual = settings.manual && settings.manual[key];
    const sig = JSON.stringify(items) + (manual ? JSON.stringify(manual) : '');
    if (sig === lastSig && !force) return;
    const first = lastSig === null;
    lastSig = sig;
    const placed = manual ? manual.map(p => ({ ...p })) : BV.layout.compute(items);
    current = { key, placed: placed.map(p => ({ id: p.id, x: p.x, y: p.y, w: p.w, h: p.h })), manual: !!manual };
    apply(placed, now, first);
    BV.editor && BV.editor.refresh();
  }

  function apply(placed, now, first) {
    const ids = new Set(placed.map(p => p.id));
    const hadExit = [...boxes.keys()].some(id => !ids.has(id));
    const dur = BV.anim.ms(1100);

    // Ut
    boxes.forEach((b, id) => {
      if (ids.has(id)) return;
      boxes.delete(id);
      b.el.classList.add('leaving');
      const a = b.el.animate([
        { opacity: 1, scale: '1' },
        { opacity: 0, scale: '0.94' }
      ], { duration: dur * 0.45, easing: BV.anim.ease, fill: 'forwards' });
      a.onfinish = () => { b.inst.destroy && b.inst.destroy(); b.el.remove(); };
    });

    placed.forEach(p => {
      const geo = cellGeo(p);
      let b = boxes.get(p.id);
      const def = BV.widgets[p.id];
      if (!b) {
        const el = document.createElement('div');
        el.className = 'box card';
        el.dataset.id = p.id;
        el.style.transition = 'none';
        setGeo(el, geo);
        const inner = document.createElement('div');
        inner.className = 'box-inner';
        inner.dataset.uid = String(++uid);
        const badge = document.createElement('div');
        badge.className = 'prio-badge';
        el.append(inner, badge);
        grid.appendChild(el);
        const inst = def.create(inner, ctx);
        b = { el, inner, inst, badge };
        boxes.set(p.id, b);
        inst.resize(geo);
        inst.update(now);
        el.getBoundingClientRect();
        el.style.transition = '';
        if (!first) {
          el.animate([
            { opacity: 0, scale: '0.94' },
            { opacity: 1, scale: '1' }
          ], { duration: dur * 0.8, easing: BV.anim.ease, delay: hadExit ? dur * 0.4 : dur * 0.3, fill: 'backwards' });
        } else {
          el.animate([
            { opacity: 0, translate: '0 40px' },
            { opacity: 1, translate: '0 0' }
          ], { duration: BV.anim.ms(900), easing: BV.anim.ease, delay: placed.indexOf(p) * 90, fill: 'backwards' });
        }
      } else {
        setGeo(b.el, geo);
        b.inst.resize(geo);
      }
      b.geo = geo;
      const prio = settings.widgets.findIndex(w => w.id === p.id) + 1;
      b.badge.textContent = `${prio} · ${def.title} · ${p.w}×${p.h}`;
    });
  }

  function setGeo(el, g) {
    el.style.transform = `translate(${g.x}px, ${g.y}px)`;
    el.style.width = g.w + 'px';
    el.style.height = g.h + 'px';
  }

  function buildOverlay() {
    overlay.innerHTML = '';
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const g = cellGeo({ x: c, y: r, w: 1, h: 1 });
      const d = document.createElement('div');
      d.className = 'cell';
      d.style.cssText = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px`;
      overlay.appendChild(d);
    }
  }

  /* ---------- Toppfelt ---------- */
  function renderHeader(now) {
    const d = ctx.data;
    const name = (d && d.stop && d.stop.name) || settings.stop.stopName || '';
    const code = (d && d.stop && d.stop.quayCode) || settings.stop.quayCode || '';
    const nameEl = $('stopName');
    if (nameEl._name !== name) { BV.anim.swapText(nameEl, name, { instant: !nameEl._name }); nameEl._name = name; }
    const qb = $('quayBadge');
    qb.textContent = code;
    qb.hidden = !code;
    $('sourceBadge').hidden = !(d && d.source === 'demo');
    BV.anim.swapText($('clockText'), BV.fmt.hhmm(now), { distance: '0.5em' });
  }

  /* ---------- Data ---------- */
  let dataTimer = null, fetching = false;

  async function refreshData() {
    clearTimeout(dataTimer);
    if (fetching) return;
    fetching = true;
    const src = settings.source;
    const now = Date.now();
    let next = ENTUR_INTERVAL;
    try {
      if (src === 'demo') {
        ctx.raw = BV.data.demoData(now);
        BV.settings.setStatus('Viser demodata (fiktive avganger og stopp).');
        next = DEMO_INTERVAL;
      } else {
        if (!settings.stop.quayId) {
          const r = await BV.data.resolveDefaultQuay(settings.stop.stopName || 'Kvaleberg skole', settings.stop.quayCode || 'A');
          settings.stop = r;
          BV.settings.save(settings);
          BV.settings.refresh();
        }
        const d = await BV.data.fetchEntur(settings.stop.quayId, now);
        ctx.raw = d;
        BV.settings.setStatus(`Live fra Entur · oppdatert ${new Date(now).toLocaleTimeString('nb-NO')}` + (d.error ? ` · ${d.error}` : ''), !!d.error);
      }
    } catch (e) {
      console.warn('Datafeil:', e);
      if (src === 'auto') {
        ctx.raw = BV.data.demoData(now);
        BV.settings.setStatus(`Entur utilgjengelig (${e.message}). Viser demodata.`, true);
      } else {
        BV.settings.setStatus(`Feil fra Entur: ${e.message}`, true);
        if (!ctx.raw || ctx.raw.source !== 'entur') ctx.raw = { source: 'entur', stop: { name: settings.stop.stopName, quayCode: settings.stop.quayCode }, departures: [], situations: [], journeys: {}, fetchedAt: now };
      }
    } finally {
      fetching = false;
    }
    refreshEffective(Date.now());
    relayout();
    tick(true);
    dataTimer = setTimeout(refreshData, next);
  }

  /* ---------- Hovedløkke ---------- */
  function tick(skipLayout) {
    const now = Date.now();
    refreshEffective(now);
    if (!skipLayout) relayout();
    renderHeader(now);
    boxes.forEach(b => { try { b.inst.tick(now); } catch (e) { console.error(b.el.dataset.id, e); } });
  }

  function loop() {
    tick();
    setTimeout(loop, 1000 - (Date.now() % 1000) + 5);
  }

  /* ---------- Innstillinger ---------- */
  function onSettingsChange(what) {
    if (what === 'view') {
      applyTheme();
      BV.anim.applySpeed(settings.view.speed);
      document.body.classList.toggle('show-grid', settings.view.grid);
      overlay.hidden = !settings.view.grid;
      boxes.forEach(b => b.inst.restyle && b.inst.restyle());
    } else if (what === 'colors') {
      boxes.forEach(b => b.inst.restyle && b.inst.restyle());
    } else if (what === 'widgets' || what === 'preset' || what === 'manual') {
      relayout(true);
      tick(true);
    } else if (what === 'sim') {
      tick();
    } else if (what === 'source' || what === 'stop') {
      ctx.raw = null;
      refreshData();
    } else if (what === 'panel') {
      fitStage();
    }
  }

  // Bakgrunnsfarge på boksene; lysere varianter til piller og skilt avledes fra den
  function applyTheme() {
    const hex = settings.view.cardColor || BV.settings.DEFAULT_CARD;
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const lift = t => `rgb(${rgb.map(c => Math.round(c + (255 - c) * t)).join(',')})`;
    const root = document.documentElement.style;
    root.setProperty('--card', hex);
    root.setProperty('--card-2', lift(0.045));
    root.setProperty('--card-3', lift(0.1));
  }

  /* ---------- Inndata ---------- */
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 's' || k === ',') BV.settings.toggle();
    else if (k === 'escape') { if (BV.editor && BV.editor.active) BV.editor.toggle(false); else BV.settings.toggle(false); }
    else if (k === 'e') { BV.settings.toggle(false); BV.editor.toggle(); }
    else if (k === 't') { settings.sim.traffic = !settings.sim.traffic; BV.settings.changed('sim'); BV.settings.refresh(); }
    else if (k === 'g') { settings.view.grid = !settings.view.grid; BV.settings.changed('view'); BV.settings.refresh(); }
    else if (k === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { }); }
    else if (['1', '2', '3'].includes(k)) BV.settings.applyPreset('skisse' + k);
  });

  let idleTimer;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 3000);
  }
  document.addEventListener('mousemove', wake);
  document.addEventListener('pointerdown', wake);
  $('settingsButton').addEventListener('click', () => BV.settings.toggle());
  window.addEventListener('resize', fitStage);

  /* ---------- Start ---------- */
  BV.settings.init(settings, onSettingsChange);
  applyTheme();
  BV.anim.applySpeed(settings.view.speed);
  document.body.classList.toggle('show-grid', settings.view.grid);
  overlay.hidden = !settings.view.grid;
  buildOverlay();
  fitStage();
  wake();
  if (settings.source === 'demo') ctx.raw = BV.data.demoData(Date.now());
  refreshEffective(Date.now());
  relayout();
  tick(true);
  refreshData();
  setTimeout(loop, 1000 - (Date.now() % 1000) + 5);

  /* ---------- Automatisk oppdatering ----------
     Sjekker version.json hvert minutt. Er det publisert en ny versjon, lastes siden på nytt,
     slik at skjermene alltid viser siste utgave uten at noen trenger å gjøre noe. */
  function watchVersion() {
    if (!/^https?:/.test(location.protocol) || window.BV_VERSION === 'dev') return;
    setInterval(async () => {
      if (BV.editor && BV.editor.active) return;
      try {
        const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const { version } = await res.json();
        if (version && version !== window.BV_VERSION) location.reload();
      } catch (e) { /* offline: prøv igjen senere */ }
    }, 60000);
  }
  watchVersion();

  BV.app = {
    settings, ctx, relayout, boxes, cellGeo, setGeo, apply, fitStage,
    stage, grid,
    get current() { return current; },
    metrics: { PAD, GAP, GRID_TOP, COL_W, ROW_H, COLS, ROWS }
  };
})(window.BV);
