/* Felles hjelpere for formatering og små DOM-byggesteiner. */
window.BV = window.BV || {};
BV.widgets = BV.widgets || {};

(function (BV) {
  const pad = n => String(n).padStart(2, '0');

  const fmt = {
    hhmm(ms) { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); },

    // Minutter til avgang, slik det vises på skjerm. Over terskelen vises klokkeslett.
    departure(dep, now, threshold = 15) {
      const diff = dep.expected - now;
      if (diff < 60000) return 'Nå';
      const m = Math.floor(diff / 60000);
      if (m >= threshold) return fmt.hhmm(dep.expected);
      return m + ' min';
    },

    minutes(dep, now) { return Math.max(0, Math.floor((dep.expected - now) / 60000)); }
  };

  // Avganger som fortsatt er aktuelle (inkl. buss som går «nå»)
  function upcoming(data, now, includeCancelled = true) {
    if (!data) return [];
    return data.departures.filter(d => d.expected >= now - 20000 && (includeCancelled || !d.cancelled));
  }

  function lineChip(line, ctx, extraClass = '') {
    const el = document.createElement('span');
    el.className = 'line-chip ' + extraClass;
    setLineChip(el, line, ctx);
    return el;
  }

  function setLineChip(el, line, ctx) {
    el.textContent = line.code;
    el.classList.toggle('wide', String(line.code).length > 2);
    const st = ctx ? colors.chip(line, ctx) : null;
    el.style.background = st ? st.bg : '';
    el.style.color = st ? st.fg : '';
  }

  /* Fargemodus for linjer:
     neutral – grå skilt og grønn trasé (som skissene)
     line    – heldekkende linjefarge
     tint    – dempet: farget tekst på svak fargebakgrunn
     Fargen hentes fra egen overstyring i innstillingene, ellers Entur, ellers en fast palett. */
  const PALETTE = ['#e4002b', '#00843d', '#0072ce', '#f39200', '#8e44ad', '#00a3ad', '#d4145a', '#7ab800'];

  function hexToRgb(hex) {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(rgb, target, t) { return rgb.map((c, i) => Math.round(c + (target[i] - c) * t)); }
  function rgbStr(rgb, a) { return a == null ? `rgb(${rgb.join(',')})` : `rgba(${rgb.join(',')},${a})`; }
  function luminance(rgb) {
    const [r, g, b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const colors = {
    mode(ctx) { return (ctx && ctx.settings.view.colorMode) || 'neutral'; },
    base(code, color, ctx) {
      const o = ctx && ctx.settings.lineColors && ctx.settings.lineColors[code];
      if (o) return o;
      if (color) return color;
      let h = 0;
      for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      return PALETTE[h % PALETTE.length];
    },
    // { bg, fg } for linjeskilt, eller null i nøytral modus
    chip(line, ctx) {
      const mode = colors.mode(ctx);
      if (mode === 'neutral') return null;
      const rgb = hexToRgb(colors.base(line.code, line.color, ctx));
      if (!rgb) return null;
      if (mode === 'tint') return { bg: rgbStr(rgb, 0.24), fg: rgbStr(mix(rgb, [255, 255, 255], 0.45)) };
      return { bg: rgbStr(rgb), fg: luminance(rgb) > 0.45 ? '#111' : '#fff' };
    },
    // Strekfarge for trasé og markører
    stroke(code, color, ctx) {
      const mode = colors.mode(ctx);
      if (mode === 'neutral') return null;
      const rgb = hexToRgb(colors.base(code, color, ctx));
      if (!rgb) return null;
      return mode === 'tint' ? rgbStr(mix(rgb, [23, 23, 23], 0.35)) : rgbStr(rgb);
    }
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs = {}, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  BV.fmt = fmt;
  BV.colors = colors;
  BV.util = { upcoming, lineChip, setLineChip, el, svg };
})(window.BV);
