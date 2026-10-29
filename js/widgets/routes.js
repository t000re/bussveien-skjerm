/* Avganger per rute – én rad per linje/destinasjon med de neste tidene.
   Passer på holdeplasser med få ruter (Auto: vises når det er 3 eller færre). */
(function (BV) {
  const { el, upcoming, lineChip, setLineChip } = BV.util;
  const ROW_PX = 84;   // minste radhøyde

  function groups(data, now) {
    const map = new Map();
    upcoming(data, now, false).forEach(d => {
      const k = d.line.code + '|' + d.dest;
      if (!map.has(k)) map.set(k, { key: k, line: d.line, dest: d.dest, deps: [] });
      map.get(k).deps.push(d);
    });
    return Array.from(map.values()).sort((a, b) => a.deps[0].expected - b.deps[0].expected);
  }

  BV.widgets.routes = {
    title: 'Avganger per rute',
    description: 'Neste tider for hver linje',
    sizes: ['12x3', '12x4', '12x5', '6x5'],
    modes: [{ id: 'auto', label: 'Auto (≤ 3 ruter)' }, { id: 'always', label: 'Alltid' }],

    available(data, w, now) {
      if (!data || !data.departures.length) return { show: false };
      const n = groups(data, now).length;
      return { show: w.mode === 'always' || n <= 3, must: false };
    },

    create(root, ctx) {
      root.classList.add('w-routes');
      const list = el('div', 'route-list');
      root.append(list);
      let capacity = 2, nTimes = 3;

      let boxH = 0;
      function render(now) {
        const gs = groups(ctx.data, now).slice(0, capacity);
        // Radhøyde ut fra antall rader som faktisk vises, så radene fyller boksen
        if (boxH && gs.length) {
          const gap = Math.max(12, Math.min(36, boxH * 0.06));
          const rowH = (boxH - 32 - gap * (gs.length - 1)) / gs.length;
          root.style.setProperty('--rgap', gap + 'px');
          root.style.setProperty('--rowh', Math.min(rowH, 180) + 'px');
        }
        BV.anim.keyedList(list, gs, g => g.key,
          () => {
            const row = el('div', 'route-row');
            const pill = el('div', 'route-pill');
            pill.append(lineChip({ code: '' }, ctx, 'md'), el('span', 'route-dest'), el('span', 'route-first'));
            const more = el('div', 'route-more');
            row.append(pill, more);
            return row;
          },
          (g, row, isNew, i) => {
            row.classList.toggle('first', i === 0);
            const pill = row.children[0];
            setLineChip(pill.children[0], g.line, ctx);
            pill.children[1].textContent = g.dest;
            BV.anim.swapText(pill.children[2], BV.fmt.departure(g.deps[0], now, 60), { instant: isNew });
            const more = row.children[1];
            const rest = g.deps.slice(1, nTimes);
            while (more.children.length < rest.length) more.append(el('span', 'route-time'));
            while (more.children.length > rest.length) more.lastChild.remove();
            rest.forEach((d, i) => BV.anim.swapText(more.children[i], BV.fmt.departure(d, now, 60), { instant: isNew }));
          });
      }

      const ro = new ResizeObserver(entries => {
        // clientHeight/-Width tar med polstringen (contentRect gjør ikke det)
        boxH = root.clientHeight;
        const w = root.clientWidth;
        const cap = Math.max(1, Math.floor((boxH - 32 + 14) / (ROW_PX + 14)));
        const nt = w > 800 ? 3 : 2;
        root.classList.toggle('narrow', w <= 800);
        capacity = cap; nTimes = nt;
        render(Date.now());
      });
      ro.observe(root);

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { list.innerHTML = ''; list._bvMap = null; render(Date.now()); },
        resize() { },
        destroy() { ro.disconnect(); }
      };
    }
  };
})(window.BV);
