/* Trafikkinformasjon fra Entur (situations). Flere meldinger veksler med myk overgang. */
(function (BV) {
  const { el } = BV.util;
  const ROTATE_MS = 9000;

  const ICON_WARN = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.8c.7 0 1.3.4 1.7 1l8.6 15a2 2 0 0 1-1.7 3H3.4a2 2 0 0 1-1.7-3l8.6-15c.4-.6 1-1 1.7-1zm0 13.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6zm0-8.3c-.8 0-1.3.6-1.2 1.4l.4 5c0 .5.4.8.8.8s.8-.3.8-.8l.4-5c.1-.8-.4-1.4-1.2-1.4z"/></svg>';
  const ICON_OK = '<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  BV.widgets.traffic = {
    title: 'Trafikkinformasjon',
    description: 'Avvik og meldinger fra Entur',
    sizes: ['12x3', '12x2', '12x4', '6x5', '6x4'],
    modes: [{ id: 'message', label: 'Kun ved melding' }, { id: 'always', label: 'Alltid' }],

    available(data, w) {
      const has = !!(data && data.situations && data.situations.length);
      return { show: has || w.mode === 'always', must: has };
    },

    create(root, ctx) {
      root.classList.add('w-traffic');
      const icon = el('div', 'tr-icon');
      const body = el('div', 'tr-body');
      const dots = el('div', 'tr-dots');
      root.append(icon, body, dots);

      let idx = 0, lastSwitch = 0, shownId = null, lastIds = '';

      function show(sit, animate) {
        const content = el('div', 'tr-content');
        if (sit) {
          content.append(el('div', 'tr-title', sit.title || 'Trafikkmelding'));
          if (sit.text && sit.text !== sit.title) content.append(el('div', 'tr-text', sit.text));
        } else {
          content.append(el('div', 'tr-title', 'Ingen trafikkmeldinger'), el('div', 'tr-text', 'Bussene går som normalt.'));
        }
        const old = Array.from(body.children);
        body.append(content);
        if (animate) {
          old.forEach(o => {
            o.classList.add('leaving');
            const a = o.animate([{ opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-16px)', filter: 'blur(4px)' }],
              { duration: BV.anim.ms(450), easing: BV.anim.ease, fill: 'forwards' });
            a.onfinish = () => o.remove();
          });
          content.animate([{ opacity: 0, transform: 'translateY(18px)', filter: 'blur(4px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }],
            { duration: BV.anim.ms(700), easing: BV.anim.ease, delay: BV.anim.ms(150), fill: 'backwards' });
        } else old.forEach(o => o.remove());
      }

      function render(now) {
        const sits = (ctx.data && ctx.data.situations) || [];
        const ids = sits.map(s => s.id).join(',');
        if (ids !== lastIds) { lastIds = ids; idx = 0; lastSwitch = now; }
        if (sits.length > 1 && now - lastSwitch > ROTATE_MS) { idx = (idx + 1) % sits.length; lastSwitch = now; }
        const sit = sits[idx] || null;
        const sev = sit ? (sit.severity === 'severe' || sit.severity === 'verySevere' ? 'severe' : 'normal') : 'none';
        root.dataset.severity = sev;
        const box = root.parentElement;
        if (box) { box.classList.toggle('tr-normal', sev === 'normal'); box.classList.toggle('tr-severe', sev === 'severe'); }
        const ic = sit ? ICON_WARN : ICON_OK;
        if (icon._ic !== ic) { icon.innerHTML = ic; icon._ic = ic; }
        const id = sit ? sit.id : '__none';
        if (id !== shownId) { show(sit, shownId !== null); shownId = id; }
        // Prikker for flere meldinger
        if (dots.children.length !== (sits.length > 1 ? sits.length : 0)) {
          dots.innerHTML = '';
          if (sits.length > 1) sits.forEach(() => dots.append(el('span', 'tr-dot')));
        }
        Array.from(dots.children).forEach((d, i) => d.classList.toggle('on', i === idx));
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { },
        resize(geo) {
          root.classList.toggle('compact', geo.h < 200);
          root.classList.toggle('tall', geo.w < 700);
        }
      };
    }
  };
})(window.BV);
