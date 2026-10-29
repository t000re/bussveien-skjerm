/* Neste avganger – liste over kommende busser. Antall rader følger boksens høyde. */
(function (BV) {
  const { el, upcoming, lineChip, setLineChip } = BV.util;
  const ROW_PX = 76;   // radhøyde i skjermpiksler (1080-bredde)
  const PAD_PX = 14;

  BV.widgets.departures = {
    title: 'Neste avganger',
    description: 'Liste over de neste bussene',
    sizes: ['6x5', '6x8', '6x4', '12x4'],

    available(data) { return { show: !!(data && data.departures.length), must: false }; },

    create(root, ctx) {
      root.classList.add('w-departures');
      const list = el('ol', 'dep-list');
      root.append(list);
      let capacity = 5;

      function render(now) {
        const deps = upcoming(ctx.data, now).slice(0, capacity);
        BV.anim.keyedList(list, deps, d => d.key,
          () => {
            const li = el('li', 'dep-row');
            const chip = lineChip({ code: '' }, ctx);
            li.append(chip, el('span', 'dep-dest'), el('span', 'dep-time'));
            return li;
          },
          (d, li, isNew, i) => {
            setLineChip(li.children[0], d.line, ctx);
            li.children[1].textContent = d.dest;
            li.classList.toggle('first', i === 0 && !d.cancelled);
            li.classList.toggle('cancelled', d.cancelled);
            const t = d.cancelled ? 'Innstilt' : BV.fmt.departure(d, now);
            BV.anim.swapText(li.children[2], t, { instant: isNew });
          });
      }

      // Antall rader følger boksens faktiske høyde mens den animerer, så rader kommer og går mykt
      const ro = new ResizeObserver(entries => {
        const h = root.clientHeight;   // med polstring
        const cap = Math.max(1, Math.floor((h - PAD_PX * 2) / ROW_PX));
        if (cap === capacity && root.style.getPropertyValue('--cap')) return;
        capacity = cap;
        root.style.setProperty('--cap', capacity);
        render(Date.now());
      });
      ro.observe(root);

      return {
        update(now) { render(now); },
        tick(now) { render(now); },
        restyle() { list.querySelectorAll('.line-chip').forEach(c => c.remove()); list.innerHTML = ''; list._bvMap = null; render(Date.now()); },
        resize() { },
        destroy() { ro.disconnect(); }
      };
    }
  };
})(window.BV);
