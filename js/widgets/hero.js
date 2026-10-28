/* Neste buss – den dominerende, (tilnærmet) kvadratiske boksen. */
(function (BV) {
  const { el, upcoming, lineChip, setLineChip } = BV.util;

  BV.widgets.hero = {
    title: 'Neste buss',
    description: 'Stor nedtelling til neste avgang',
    sizes: ['12x12', '12x10', '12x8', '8x8'],
    defaultSizes: ['12x12', '12x10', '8x8'],
    required: true,

    available() { return { show: true, must: true }; },

    create(root, ctx) {
      root.classList.add('w-hero');
      const main = el('div', 'hero-main');
      const num = el('div', 'hero-num');
      const unit = el('div', 'hero-unit');
      main.append(num, unit);
      const sub = el('div', 'hero-sub');
      const chip = lineChip({ code: '' }, ctx, 'lg');
      const dest = el('span', 'hero-dest');
      sub.append(chip, dest);
      const empty = el('div', 'hero-empty', 'Ingen avganger de neste timene');
      root.append(main, sub, empty);

      let lastKey = null;
      let state = null;

      function render(now) {
        const list = upcoming(ctx.data, now, false);
        const dep = list[0];
        root.classList.toggle('is-loading', !ctx.data);
        root.classList.toggle('is-empty', !!ctx.data && !dep);
        if (!dep) return;
        const diff = dep.expected - now;
        let n, u, mode;
        if (diff < 60000) { n = 'Nå'; u = ''; mode = 'now'; }
        else if (diff < 60 * 60000) { n = String(Math.floor(diff / 60000)); u = 'min'; mode = 'min'; }
        else { n = BV.fmt.hhmm(dep.expected); u = ''; mode = 'time'; }
        if (state !== mode) {
          root.dataset.mode = mode;
          state = mode;
        }
        BV.anim.swapText(num, n, { distance: '0.28em', duration: 900 });
        BV.anim.swapText(unit, u, { distance: '0.5em' });
        if (dep.key !== lastKey) {
          const changed = lastKey !== null;
          lastKey = dep.key;
          const apply = () => { setLineChip(chip, dep.line, ctx); dest.textContent = dep.dest; };
          if (changed) {
            const a = sub.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-30%)' }],
              { duration: BV.anim.ms(350), easing: BV.anim.ease, fill: 'forwards' });
            a.onfinish = () => {
              apply();
              a.cancel();
              sub.animate([{ opacity: 0, transform: 'translateY(30%)' }, { opacity: 1, transform: 'translateY(0)' }],
                { duration: BV.anim.ms(600), easing: BV.anim.ease });
            };
          } else apply();
        }
      }

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { lastKey = null; render(Date.now()); },
        resize() { }
      };
    }
  };
})(window.BV);
