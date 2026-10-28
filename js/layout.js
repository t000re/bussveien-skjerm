/* Bento-layoutmotor.
   Rutenettet er 12 kolonner × 20 rader under toppfeltet. Hver infoboks har en liste med tillatte
   størrelser (bredde×høyde i celler). Motoren prøver alle kombinasjoner av størrelser og
   av/på for boksene (i prioritert rekkefølge), plasserer dem med «first fit» ovenfra og ned,
   strekker bokser for å fylle hull, og velger kombinasjonen med høyest poengsum.

   Poengsum: prioritet teller mest (å vise en boks er viktigere enn at en annen er stor),
   deretter størrelse, og tomme celler trekker ned. */
window.BV = window.BV || {};

(function (BV) {
  const COLS = 12;
  const ROWS = 20;

  const W = {
    INCLUDE: 1,      // verdi for å vise en boks (× prioritetsvekt)
    SIZE: 0.06,      // verdi for største tillatte størrelse (× prioritetsvekt)
    HOLE: 0.3,       // straff per tom celle
    STRETCH: 0.004   // liten straff per celle en boks er strukket utover sin naturlige størrelse
  };

  function parseSize(s) {
    if (Array.isArray(s)) return s;
    const [w, h] = String(s).split('x').map(Number);
    return [w, h];
  }

  function makeGrid() { return new Uint8Array(COLS * ROWS); }

  function fits(grid, x, y, w, h) {
    if (x + w > COLS || y + h > ROWS) return false;
    for (let r = y; r < y + h; r++)
      for (let c = x; c < x + w; c++)
        if (grid[r * COLS + c]) return false;
    return true;
  }

  function fill(grid, x, y, w, h, v) {
    for (let r = y; r < y + h; r++)
      for (let c = x; c < x + w; c++)
        grid[r * COLS + c] = v;
  }

  function firstFit(grid, w, h) {
    for (let y = 0; y <= ROWS - h; y++)
      for (let x = 0; x <= COLS - w; x++)
        if (fits(grid, x, y, w, h)) return { x, y };
    return null;
  }

  // Strekk bokser nedover og så sidelengs inn i tomme celler.
  function stretch(placed, grid) {
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (const p of placed) {
        if (p.noStretch) continue;
        if (p.y + p.h < ROWS && fits(grid, p.x, p.y + p.h, p.w, 1)) {
          fill(grid, p.x, p.y + p.h, p.w, 1, 1); p.h++; changed = true;
        }
      }
      if (changed) continue;
      for (const p of placed) {
        if (p.noStretch) continue;
        if (p.x + p.w < COLS && fits(grid, p.x + p.w, p.y, 1, p.h)) {
          fill(grid, p.x + p.w, p.y, 1, p.h, 1); p.w++; changed = true;
        } else if (p.x > 0 && fits(grid, p.x - 1, p.y, 1, p.h)) {
          fill(grid, p.x - 1, p.y, 1, p.h, 1); p.x--; p.w++; changed = true;
        }
      }
    }
  }

  /* items: [{ id, sizes: [[w,h],...] (største først), must: bool, noStretch: bool }] i prioritert rekkefølge */
  function compute(items) {
    const N = items.length;
    const weights = items.map((_, i) => Math.pow(2, N - 1 - i));
    const maxRest = [];
    let acc = 0;
    for (let i = N - 1; i >= 0; i--) { acc += weights[i] * (W.INCLUDE + W.SIZE); maxRest[i] = acc; }
    maxRest[N] = 0;

    let best = null;
    const grid = makeGrid();
    const placed = [];

    function evaluate(score) {
      const g = grid.slice();
      const ps = placed.map(p => ({ ...p }));
      const natural = ps.reduce((s, p) => s + p.w * p.h, 0);
      stretch(ps, g);
      let holes = 0;
      for (let i = 0; i < g.length; i++) if (!g[i]) holes++;
      const stretched = ps.reduce((s, p) => s + p.w * p.h, 0) - natural;
      const total = score - holes * W.HOLE - stretched * W.STRETCH;
      if (!best || total > best.score + 1e-9) best = { score: total, placed: ps, holes };
    }

    function dfs(i, score) {
      if (best && score + maxRest[i] <= best.score) return;
      if (i === N) { evaluate(score); return; }
      const it = items[i];
      const n = it.sizes.length;
      for (let s = 0; s < n; s++) {
        const [w, h] = it.sizes[s];
        const pos = firstFit(grid, w, h);
        if (!pos) continue;
        fill(grid, pos.x, pos.y, w, h, 1);
        placed.push({ id: it.id, x: pos.x, y: pos.y, w, h, sizeIndex: s, noStretch: !!it.noStretch });
        const f = n > 1 ? 1 - s / (n - 1) : 1;
        dfs(i + 1, score + weights[i] * (W.INCLUDE + W.SIZE * f));
        placed.pop();
        fill(grid, pos.x, pos.y, w, h, 0);
      }
      if (!it.must) dfs(i + 1, score);
    }

    dfs(0, 0);
    return best ? best.placed : [];
  }

  BV.layout = { COLS, ROWS, compute, parseSize, weights: W };
})(window.BV);
