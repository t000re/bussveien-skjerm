/* Innstillinger: tilstand, lagring (localStorage) og innstillingspanelet. */
window.BV = window.BV || {};

(function (BV) {
  const KEY = 'bussveien.settings.v1';
  const DEFAULT_CARD = '#171717';

  // Rekkefølgen her er prioriteten. sizes = tillatte størrelser (største først).
  const PRESETS = {
    skisse1: {
      label: 'Skisse 1', hint: 'Liste, klokke og trafikk',
      widgets: [
        { id: 'hero', enabled: true },
        { id: 'departures', enabled: true },
        { id: 'clock', enabled: true },
        { id: 'traffic', enabled: true, mode: 'always' },
        { id: 'line', enabled: false },
        { id: 'routes', enabled: false }
      ]
    },
    skisse2: {
      label: 'Skisse 2', hint: 'Liste, klokke og trasé',
      widgets: [
        { id: 'hero', enabled: true },
        { id: 'departures', enabled: true },
        { id: 'clock', enabled: true },
        { id: 'traffic', enabled: true, mode: 'message' },
        { id: 'line', enabled: true },
        { id: 'routes', enabled: false }
      ]
    },
    skisse3: {
      label: 'Skisse 3', hint: 'Per rute, trafikk og klokke',
      widgets: [
        { id: 'hero', enabled: true },
        { id: 'routes', enabled: true, mode: 'auto' },
        { id: 'traffic', enabled: true, mode: 'always' },
        { id: 'clock', enabled: true },
        { id: 'departures', enabled: false },
        { id: 'line', enabled: false }
      ]
    }
  };

  function defaults() {
    return {
      v: 1,
      stop: { quayId: null, stopName: 'Kvaleberg skole', quayCode: 'A' },
      source: 'auto',
      preset: 'skisse2',
      widgets: clone(PRESETS.skisse2.widgets),
      sim: { traffic: false, autoTraffic: true },
      view: { grid: false, speed: 1, colorMode: 'neutral', busStops: 2, busStopsAfter: 2, labelAngle: 'flat', cardColor: null, labelFit: 'truncate', overview: 'off', overviewEvery: 2, overviewFor: 15, stopsBefore: 3, stopsAfter: 3, showOrigin: true, showTerminus: true },
      lineColors: {},
      manual: {}
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    let s = defaults();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.v === 1) s = Object.assign(s, saved, {
          stop: Object.assign(s.stop, saved.stop),
          sim: Object.assign(s.sim, saved.sim),
          view: Object.assign(s.view, saved.view),
          lineColors: Object.assign({}, saved.lineColors),
          manual: Object.assign({}, saved.manual)
        });
        // Eldre lagring: lineColors som av/på
        if (s.view.lineColors === true && !saved.view.colorMode) s.view.colorMode = 'line';
        delete s.view.lineColors;
      }
    } catch (e) { /* privat modus o.l. */ }
    // URL-parametre overstyrer: ?quay=NSR:Quay:123&source=demo&preset=skisse3
    try {
      const p = new URLSearchParams(location.search);
      if (p.get('quay')) s.stop = { quayId: p.get('quay'), stopName: '', quayCode: '' };
      if (p.get('source')) s.source = p.get('source');
      if (p.get('preset') && PRESETS[p.get('preset')]) { s.preset = p.get('preset'); s.widgets = clone(PRESETS[s.preset].widgets); }
    } catch (e) { }
    normalizeWidgets(s);
    return s;
  }

  function normalizeWidgets(s) {
    const reg = BV.widgets || {};
    const ids = Object.keys(reg);
    const have = new Set(s.widgets.map(w => w.id));
    ids.forEach(id => { if (!have.has(id)) s.widgets.push({ id, enabled: false }); });
    s.widgets = s.widgets.filter(w => reg[w.id] || !ids.length);
    s.widgets.forEach(w => {
      const def = reg[w.id];
      if (!def) return;
      if (!w.sizes || !w.sizes.length) w.sizes = (def.defaultSizes || def.sizes).slice();
      w.sizes = w.sizes.filter(x => def.sizes.includes(x));
      if (!w.sizes.length) w.sizes = def.sizes.slice();
      if (def.modes && !w.mode) w.mode = def.modes[0].id;
    });
  }

  let saveTimer = null;
  function save(s) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { }
    }, 150);
  }

  /* ---------- Panel ---------- */
  let panel, state, onChange, statusEl, open = false;

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    children.flat().forEach(c => { if (c != null) el.append(c.nodeType ? c : document.createTextNode(c)); });
    return el;
  }

  function changed(what) {
    state.preset = what === 'preset' ? state.preset : (what === 'widgets' ? null : state.preset);
    save(state);
    onChange && onChange(what);
  }

  function seg(options, value, onPick) {
    return h('div', { class: 'seg' }, options.map(o =>
      h('button', { class: 'seg-btn' + (o.id === value ? ' on' : ''), onclick: () => onPick(o.id) }, o.label)));
  }

  function toggle(checked, onFlip, label) {
    return h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', checked: !!checked, onchange: e => onFlip(e.target.checked) }),
      h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })),
      label ? h('span', { class: 'toggle-label' }, label) : null);
  }

  function render() {
    const reg = BV.widgets;
    const oldBody = panel.querySelector('.set-body');
    const scrollTop = oldBody ? oldBody.scrollTop : 0;
    const active = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.focusKey : null;
    panel.innerHTML = '';
    const body = h('div', { class: 'set-body' });
    panel.append(
      h('div', { class: 'set-head' },
        h('h2', {}, 'Innstillinger'),
        h('button', { class: 'icon-btn', title: 'Lukk (Esc)', onclick: () => toggleOpen(false) }, '✕')),
      body);

    // Holdeplass
    const results = h('div', { class: 'search-results' });
    let searchTimer;
    const input = h('input', {
      class: 'text-input', type: 'search', placeholder: 'Søk etter holdeplass …', 'data-focus-key': 'search',
      oninput: e => {
        clearTimeout(searchTimer);
        const q = e.target.value.trim();
        if (q.length < 2) { results.innerHTML = ''; return; }
        searchTimer = setTimeout(() => doSearch(q, results), 300);
      }
    });
    body.append(section('Holdeplass',
      h('div', { class: 'current-stop' },
        h('span', { class: 'cs-name' }, state.stop.stopName || state.stop.quayId || '—'),
        state.stop.quayCode ? h('span', { class: 'quay-badge sm' }, state.stop.quayCode) : null,
        h('span', { class: 'cs-id' }, state.stop.quayId || 'finnes automatisk')),
      input, results));

    // Datakilde
    statusEl = h('div', { class: 'status-line' });
    body.append(section('Datakilde',
      seg([{ id: 'auto', label: 'Auto' }, { id: 'entur', label: 'Entur' }, { id: 'demo', label: 'Demo' }], state.source, v => { state.source = v; changed('source'); render(); }),
      statusEl));
    setStatus(lastStatus, lastErr);

    // Layout
    const manualCount = Object.keys(state.manual || {}).length;
    body.append(section('Layout',
      h('button', { class: 'primary-btn', onclick: () => { toggleOpen(false); BV.editor && BV.editor.toggle(true); } }, 'Rediger layout (E)'),
      manualCount ? h('div', { class: 'manual-row' },
        h('span', {}, manualCount === 1 ? '1 egen layout' : manualCount + ' egne layouter'),
        h('button', { class: 'link-btn', onclick: () => { state.manual = {}; changed('manual'); render(); } }, 'Tilbake til automatisk')) : null));

    // Infobokser
    const list = h('ol', { class: 'wlist' });
    state.widgets.forEach((w, i) => {
      const def = reg[w.id];
      if (!def) return;
      const li = h('li', { class: 'witem' + (w.enabled ? '' : ' off'), draggable: 'true', 'data-i': i },
        h('div', { class: 'wtop' },
          h('span', { class: 'wnum' }, String(i + 1)),
          h('span', { class: 'wgrip', title: 'Dra for å endre prioritet' }, '⋮⋮'),
          h('div', { class: 'wname' }, h('strong', {}, def.title)),
          h('div', { class: 'warrows' },
            h('button', { class: 'icon-btn sm', title: 'Høyere prioritet', disabled: i === 0, onclick: () => move(i, i - 1) }, '↑'),
            h('button', { class: 'icon-btn sm', title: 'Lavere prioritet', disabled: i === state.widgets.length - 1, onclick: () => move(i, i + 1) }, '↓')),
          def.required ? h('span', { class: 'req' }, 'Alltid') : toggle(w.enabled, v => { w.enabled = v; changed('widgets'); render(); })),
        def.modes ? h('div', { class: 'wsizes' },
          h('span', { class: 'wlabel' }, 'Vises'),
          seg(def.modes, w.mode, v => { w.mode = v; changed('widgets'); render(); })) : null);
      li.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('dragover'); });
      li.addEventListener('dragleave', () => li.classList.remove('dragover'));
      li.addEventListener('drop', e => { e.preventDefault(); li.classList.remove('dragover'); move(+e.dataTransfer.getData('text/plain'), i); });
      list.append(li);
    });
    body.append(section('Infobokser etter prioritet', list));

    // Simulering
    body.append(section('Simulering',
      toggle(state.sim.traffic, v => { state.sim.traffic = v; changed('sim'); }, 'Trafikkmelding (T)'),
      toggle(state.sim.autoTraffic, v => { state.sim.autoTraffic = v; changed('sim'); }, 'Veksle trafikkmelding automatisk i demo')));

    // Visning
    const speedVal = h('span', { class: 'range-val' }, state.view.speed + '×');
    const card = state.view.cardColor || DEFAULT_CARD;
    body.append(section('Visning',
      toggle(state.view.showStopName !== false, v => { state.view.showStopName = v; changed('view'); }, 'Vis holdeplassnavn'),
      toggle(state.view.grid, v => { state.view.grid = v; changed('view'); }, 'Vis rutenett (G)'),
      h('div', { class: 'color-row' },
        h('span', { class: 'field-label' }, 'Bakgrunn på boksene'),
        h('input', { type: 'color', id: 'cardColor', value: card, oninput: e => { state.view.cardColor = e.target.value; changed('view'); } }),
        state.view.cardColor ? h('button', { class: 'link-btn muted', onclick: () => { state.view.cardColor = null; changed('view'); render(); } }, 'Standard') : null),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Linjefarger'),
        seg([{ id: 'neutral', label: 'Nøytral' }, { id: 'line', label: 'Linjefarger' }, { id: 'tint', label: 'Dempet' }],
          state.view.colorMode, v => { state.view.colorMode = v; changed('view'); render(); })),
      lineColorList(),
      h('label', { class: 'range' },
        h('span', {}, 'Animasjonstempo'),
        h('input', {
          type: 'range', min: '0.25', max: '2', step: '0.25', value: String(state.view.speed),
          oninput: e => { state.view.speed = +e.target.value; speedVal.textContent = state.view.speed + '×'; changed('view'); }
        }),
        speedVal)));

    // Trasé
    const nums = max => [1, 2, 3, 4, 5].filter(n => n <= max).map(n => ({ id: n, label: String(n) }));
    body.append(section('Trasé',
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Stoppnavn'),
        seg([{ id: 'flat', label: 'Rett' }, { id: 'angled', label: 'Skrå 45°' }],
          state.view.labelAngle, v => { state.view.labelAngle = v; changed('view'); render(); })),
      toggle(state.view.simplify !== false, v => { state.view.simplify = v; changed('view'); }, 'Forenkle ved mange linjer'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Lange navn'),
        seg([{ id: 'truncate', label: 'Forkort' }, { id: 'shrink', label: 'Mindre skrift' }],
          state.view.labelFit || 'truncate', v => { state.view.labelFit = v; changed('view'); render(); })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Oversikt over hele linjen'),
        seg([{ id: 'off', label: 'Av' }, { id: 'on', label: 'Alltid' }, { id: 'cycle', label: 'Veksle' }],
          state.view.overview || 'off', v => { state.view.overview = v; changed('view'); render(); })),
      state.view.overview === 'cycle' ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Vis oversikt hvert'),
        seg([1, 2, 5, 10].map(n => ({ id: n, label: n + ' min' })),
          state.view.overviewEvery || 2, v => { state.view.overviewEvery = v; changed('view'); render(); })) : null,
      state.view.overview === 'cycle' ? h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'i'),
        seg([10, 15, 30, 60].map(n => ({ id: n, label: n + ' s' })),
          state.view.overviewFor || 15, v => { state.view.overviewFor = v; changed('view'); render(); })) : null,
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Stopp før'),
        seg(nums(5), state.view.stopsBefore, v => { state.view.stopsBefore = v; changed('view'); render(); })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Stopp etter'),
        seg(nums(5), state.view.stopsAfter, v => { state.view.stopsAfter = v; changed('view'); render(); })),
      toggle(state.view.showOrigin, v => { state.view.showOrigin = v; changed('view'); }, 'Startholdeplass'),
      toggle(state.view.showTerminus, v => { state.view.showTerminus = v; changed('view'); }, 'Endeholdeplass'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Busser før holdeplassen (stopp)'),
        seg(nums(5), state.view.busStops || 2, v => { state.view.busStops = v; changed('view'); render(); })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Busser etter holdeplassen (stopp)'),
        seg(nums(5), state.view.busStopsAfter || 2, v => { state.view.busStopsAfter = v; changed('view'); render(); }))));

    body.append(section('Snarveier', keysList(),
      h('button', {
        class: 'link-btn', onclick: e => {
          const b = e.currentTarget;
          if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Klikk igjen for å tilbakestille alt'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Tilbakestill alt'; }, 4000); return; }
          try { localStorage.removeItem(KEY); } catch (err) { }
          location.reload();
        }
      }, 'Tilbakestill alt')));
    body.scrollTop = scrollTop;
    if (active) { const f = panel.querySelector(`[data-focus-key="${active}"]`); if (f) f.focus(); }
  }

  // Liste over linjene på holdeplassen med fargevelger for å overstyre fargen
  function lineColorList() {
    if (state.view.colorMode === 'neutral') return null;
    const data = BV.app && BV.app.ctx.data;
    const lines = new Map();
    if (data) data.departures.forEach(d => { if (!lines.has(d.line.code)) lines.set(d.line.code, d.line); });
    if (!lines.size) return null;
    const wrap = h('div', { class: 'line-colors' });
    [...lines.values()].sort((a, b) => String(a.code).localeCompare(String(b.code), 'nb', { numeric: true })).forEach(line => {
      const chip = BV.util.lineChip(line, BV.app.ctx);
      const cur = BV.colors.base(line.code, line.color, BV.app.ctx);
      const overridden = !!state.lineColors[line.code];
      const input = h('input', {
        type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888', title: 'Velg farge for linje ' + line.code,
        oninput: e => { state.lineColors[line.code] = e.target.value; BV.util.setLineChip(chip, line, BV.app.ctx); changed('colors'); }
      });
      wrap.append(h('div', { class: 'lc-row' }, chip, input,
        overridden ? h('button', { class: 'link-btn muted', onclick: () => { delete state.lineColors[line.code]; changed('colors'); render(); } }, 'Standard') : null));
    });
    return wrap;
  }

  function keysList() {
    const dl = h('dl', { class: 'keys' });
    [['S', 'Innstillinger'], ['E', 'Rediger layout (dra og skaler bokser)'], ['T', 'Trafikkmelding av/på'], ['G', 'Rutenett og prioritet'], ['F', 'Fullskjerm'], ['Esc', 'Lukk innstillinger']]
      .forEach(([k, v]) => dl.append(h('dt', {}, h('kbd', {}, k)), h('dd', {}, v)));
    return dl;
  }

  function section(title, ...children) {
    return h('section', { class: 'set-sec' }, h('h3', {}, title), ...children);
  }

  function move(from, to) {
    if (from === to || to < 0 || to >= state.widgets.length) return;
    const [w] = state.widgets.splice(from, 1);
    state.widgets.splice(to, 0, w);
    changed('widgets');
    render();
  }

  function applyPreset(id) {
    state.preset = id;
    state.widgets = clone(PRESETS[id].widgets);
    normalizeWidgets(state);
    changed('preset');
    if (open) render();
  }

  async function doSearch(q, results) {
    results.innerHTML = '<div class="hint">Søker …</div>';
    try {
      const stops = await BV.data.searchStops(q);
      results.innerHTML = '';
      if (!stops.length) { results.innerHTML = '<div class="hint">Ingen treff</div>'; return; }
      stops.forEach(s => {
        const row = h('div', { class: 'sr' },
          h('button', { class: 'sr-stop', onclick: async () => {
            quays.innerHTML = '<div class="hint">Henter plattformer …</div>';
            try {
              const qs = await BV.data.getQuays(s.id);
              quays.innerHTML = '';
              qs.forEach(q => quays.append(h('button', {
                class: 'quay-pick', onclick: () => {
                  state.stop = { quayId: q.id, stopName: s.name, quayCode: q.code };
                  changed('stop'); render();
                }
              }, h('span', { class: 'quay-badge sm' }, q.code || '–'),
                h('span', { class: 'qp-lines' }, q.lines.length ? q.lines.slice(0, 4).join(' · ') : (q.description || 'Ingen avganger nå')))));
            } catch (e) { quays.innerHTML = `<div class="hint err">${e.message}</div>`; }
          } }, h('strong', {}, s.name), h('span', {}, s.locality)));
        const quays = h('div', { class: 'quays' });
        row.append(quays);
        results.append(row);
      });
    } catch (e) {
      results.innerHTML = `<div class="hint err">Søk feilet: ${e.message}. Søket krever tilgang til api.entur.io.</div>`;
    }
  }

  let lastStatus = '', lastErr = false;
  function setStatus(text, isErr) {
    lastStatus = text; lastErr = !!isErr;
    if (statusEl) { statusEl.textContent = text; statusEl.classList.toggle('err', !!isErr); }
  }

  function toggleOpen(v) {
    open = v === undefined ? !open : v;
    if (open) render();
    document.body.classList.toggle('settings-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    onChange && onChange('panel');
  }

  BV.settings = {
    PRESETS, DEFAULT_CARD,
    load, save, normalizeWidgets, applyPreset, setStatus,
    get isOpen() { return open; },
    init(s, cb) { state = s; onChange = cb; panel = document.getElementById('settings'); },
    toggle: toggleOpen,
    refresh() { if (open) render(); },
    changed,
    render: () => { if (open) render(); }
  };
})(window.BV);
