/* Datakilder: Entur Journey Planner v3 (GraphQL) og en realistisk demokilde.
   Begge leverer samme normaliserte struktur:
   {
     source: 'entur' | 'demo',
     stop: { name, quayCode, quayId, stopPlaceId },
     departures: [{ key, journeyId, line: { code, color, textColor }, dest, aimed, expected, realtime, cancelled, date }],
     situations: [{ id, title, text, severity }],
     journeys: { [journeyId]: { journeyId, lineCode, dest, calls: [{ stopId, name, quayId, time }] } },
     fetchedAt, error
   } */
window.BV = window.BV || {};

(function (BV) {
  const CLIENT_NAME = 'bussveien-skjerm-prototype';
  const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
  const GEO_URL = 'https://api.entur.io/geocoder/v1/autocomplete';
  const HEADERS = { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME };

  async function gql(query, variables, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(JP_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }), signal: ctrl.signal });
      if (!res.ok) throw new Error('Entur svarte ' + res.status);
      const json = await res.json();
      if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
      return json.data;
    } finally { clearTimeout(t); }
  }

  const SITUATION_FIELDS = `
    id severity reportType
    summary { value language }
    description { value language }
    validityPeriod { startTime endTime }`;

  const DEPARTURES_QUERY = `
    query ($id: String!, $n: Int!) {
      quay(id: $id) {
        id name publicCode
        stopPlace { id name }
        situations { ${SITUATION_FIELDS} }
        estimatedCalls(numberOfDepartures: $n, timeRange: 10800, includeCancelledTrips: true) {
          date aimedDepartureTime expectedDepartureTime realtime cancellation
          destinationDisplay { frontText }
          situations { ${SITUATION_FIELDS} }
          serviceJourney {
            id
            line { id publicCode transportMode presentation { colour textColour } }
          }
        }
      }
    }`;

  function pickLang(list) {
    if (!list || !list.length) return '';
    const pref = ['nob', 'no', 'nb', 'nor', 'nno', 'nn'];
    for (const p of pref) { const m = list.find(x => (x.language || '').toLowerCase() === p); if (m) return m.value; }
    return list[0].value;
  }

  function normSituation(s) {
    return {
      id: s.id,
      title: pickLang(s.summary),
      text: pickLang(s.description),
      severity: s.severity || 'normal',
      start: s.validityPeriod && s.validityPeriod.startTime ? Date.parse(s.validityPeriod.startTime) : null,
      end: s.validityPeriod && s.validityPeriod.endTime ? Date.parse(s.validityPeriod.endTime) : null
    };
  }

  /* ---------- Entur ---------- */
  const journeyCache = new Map(); // journeyId -> { data, fetchedAt }

  async function fetchJourneys(departures, quayId, now) {
    // Hent stoppmønster for første avgang per linje/destinasjon + avganger de neste 20 min (for bussmarkører)
    const wanted = [];
    const seen = new Set();
    for (const d of departures) {
      const k = d.line.code + '|' + d.dest;
      const soon = d.expected - now < 20 * 60000;
      if (!seen.has(k) || soon) { wanted.push(d); seen.add(k); }
      if (wanted.length >= 10) break;
    }
    const stale = wanted.filter(d => {
      const c = journeyCache.get(d.journeyId);
      return !c || now - c.fetchedAt > 45000;
    });
    if (stale.length) {
      const parts = stale.map((d, i) => `
        j${i}: serviceJourney(id: ${JSON.stringify(d.journeyId)}) {
          id
          estimatedCalls(date: ${JSON.stringify(d.date)}) {
            aimedDepartureTime expectedDepartureTime aimedArrivalTime expectedArrivalTime
            quay { id name stopPlace { id name } }
          }
        }`);
      const data = await gql(`query { ${parts.join('\n')} }`, {});
      stale.forEach((d, i) => {
        const sj = data['j' + i];
        if (!sj || !sj.estimatedCalls) return;
        journeyCache.set(d.journeyId, {
          fetchedAt: now,
          data: {
            journeyId: d.journeyId,
            lineCode: d.line.code,
            line: d.line,
            dest: d.dest,
            calls: sj.estimatedCalls.map(c => ({
              stopId: c.quay && c.quay.stopPlace ? c.quay.stopPlace.id : (c.quay && c.quay.id),
              quayId: c.quay && c.quay.id,
              name: c.quay && c.quay.stopPlace ? c.quay.stopPlace.name : (c.quay && c.quay.name),
              time: Date.parse(c.expectedDepartureTime || c.expectedArrivalTime || c.aimedDepartureTime || c.aimedArrivalTime)
            }))
          }
        });
      });
    }
    // Rydd bort reiser som er godt forbi
    const journeys = {};
    journeyCache.forEach((v, id) => {
      const last = v.data.calls.length ? v.data.calls[v.data.calls.length - 1].time : 0;
      if (last < now - 5 * 60000) { journeyCache.delete(id); return; }
      journeys[id] = v.data;
    });
    return journeys;
  }

  async function fetchEntur(quayId, now) {
    const data = await gql(DEPARTURES_QUERY, { id: quayId, n: 40 });
    const q = data.quay;
    if (!q) throw new Error('Fant ikke plattform ' + quayId);
    const sitMap = new Map();
    (q.situations || []).forEach(s => sitMap.set(s.id, normSituation(s)));
    const departures = (q.estimatedCalls || []).map(c => {
      (c.situations || []).forEach(s => sitMap.set(s.id, normSituation(s)));
      const line = c.serviceJourney.line;
      return {
        key: c.serviceJourney.id + '|' + c.date,
        journeyId: c.serviceJourney.id,
        date: c.date,
        line: {
          code: line.publicCode || '?',
          color: line.presentation && line.presentation.colour ? '#' + line.presentation.colour : null,
          textColor: line.presentation && line.presentation.textColour ? '#' + line.presentation.textColour : null
        },
        dest: c.destinationDisplay ? c.destinationDisplay.frontText : '',
        aimed: Date.parse(c.aimedDepartureTime),
        expected: Date.parse(c.expectedDepartureTime || c.aimedDepartureTime),
        realtime: !!c.realtime,
        cancelled: !!c.cancellation
      };
    }).sort((a, b) => a.expected - b.expected);

    const situations = Array.from(sitMap.values()).filter(s =>
      (s.title || s.text) && (!s.start || s.start <= now) && (!s.end || s.end >= now));

    let journeys = {};
    let journeyError = null;
    try { journeys = await fetchJourneys(departures, q.id, now); }
    catch (e) { journeyError = e.message; }

    return {
      source: 'entur',
      stop: { name: q.stopPlace ? q.stopPlace.name : q.name, quayCode: q.publicCode || '', quayId: q.id, stopPlaceId: q.stopPlace && q.stopPlace.id },
      departures, situations, journeys,
      fetchedAt: now,
      error: journeyError ? 'Trasé: ' + journeyError : null
    };
  }

  async function searchStops(text) {
    const url = `${GEO_URL}?text=${encodeURIComponent(text)}&size=10&layers=venue&lang=no&focus.point.lat=58.90&focus.point.lon=5.73`;
    const res = await fetch(url, { headers: { 'ET-Client-Name': CLIENT_NAME } });
    if (!res.ok) throw new Error('Søk feilet (' + res.status + ')');
    const json = await res.json();
    return (json.features || [])
      .filter(f => /^NSR:StopPlace/.test(f.properties.id))
      .map(f => ({ id: f.properties.id, name: f.properties.name, locality: f.properties.locality || f.properties.county || '' }));
  }

  async function getQuays(stopPlaceId) {
    const data = await gql(`
      query ($id: String!) {
        stopPlace(id: $id) {
          id name
          quays {
            id publicCode name description
            estimatedCalls(numberOfDepartures: 6, timeRange: 14400) {
              destinationDisplay { frontText }
              serviceJourney { line { publicCode } }
            }
          }
        }
      }`, { id: stopPlaceId });
    const sp = data.stopPlace;
    if (!sp) return [];
    return sp.quays.map(q => {
      const lines = new Map();
      (q.estimatedCalls || []).forEach(c => lines.set(c.serviceJourney.line.publicCode + ' ' + (c.destinationDisplay ? c.destinationDisplay.frontText : ''), true));
      return { id: q.id, code: q.publicCode || '', name: sp.name, description: q.description || '', lines: Array.from(lines.keys()) };
    }).sort((a, b) => a.code.localeCompare(b.code, 'nb'));
  }

  async function resolveDefaultQuay(name, code) {
    const stops = await searchStops(name);
    if (!stops.length) throw new Error('Fant ikke «' + name + '»');
    const quays = await getQuays(stops[0].id);
    const q = quays.find(q => q.code.toUpperCase() === (code || '').toUpperCase()) || quays[0];
    if (!q) throw new Error('Ingen plattformer på ' + stops[0].name);
    return { quayId: q.id, stopName: stops[0].name, quayCode: q.code };
  }

  /* ---------- Demo ---------- */
  // Fiktive, men realistiske holdeplasser langs bussveien. Linjene deler seg etter Hinnasvingen.
  const DEMO_PATTERNS = [
    {
      lineCode: '2', dest: 'Forus', headway: 8, offset: 3,
      stops: [
        ['Stavanger byterminal', -11], ['Paradis', -7], ['Hillevåg', -4.6], ['Mariero', -2.2],
        ['Kvaleberg skole', 0],
        ['Hinnasvingen', 2.1], ['Jåttåvågen', 4.4], ['Forus øst', 7], ['Forus', 10]
      ]
    },
    {
      lineCode: '1', dest: 'Sandnes', headway: 12, offset: 7,
      stops: [
        ['Stavanger byterminal', -11], ['Paradis', -7], ['Hillevåg', -4.6], ['Mariero', -2.2],
        ['Kvaleberg skole', 0],
        ['Hinnasvingen', 2.1], ['Gausel stasjon', 4.8], ['Sandnes øst', 9], ['Sandnes', 13]
      ]
    }
  ];

  const DEMO_SITUATIONS = [
    { id: 'demo-1', severity: 'normal', title: 'Forsinkelser ved Hinna', text: 'Vegarbeid i bussveien ved Hinnasvingen gir 5–10 minutter forsinkelse på linje 1 og 2 i retning Sandnes og Forus. Beregn ekstra reisetid.' },
    { id: 'demo-2', severity: 'severe', title: 'Holdeplass Jåttåvågen stengt', text: 'Linje 2 stopper ikke ved Jåttåvågen fram til kl. 18. Bruk midlertidig holdeplass i Jåttåvågveien.' },
    { id: 'demo-3', severity: 'normal', title: 'Ekstra avganger til Forus', text: 'På grunn av arrangement i Jåttåvågen settes det inn ekstra busser på linje 2 i ettermiddag.' }
  ];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }

  function slug(s) { return s.toLowerCase().replace(/[^a-zæøå0-9]+/g, '-'); }

  function demoData(now, opts = {}) {
    const departures = [];
    const journeys = {};
    const minute = 60000;
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const date = dayStart.toISOString().slice(0, 10);
    for (const p of DEMO_PATTERNS) {
      // Avganger fra 20 min tilbake (for busser som har passert) til 3 timer fram
      const startMin = Math.floor((now - dayStart.getTime()) / minute) - 20;
      const first = Math.ceil((startMin - p.offset) / p.headway) * p.headway + p.offset;
      for (let m = first; m < startMin + 200; m += p.headway) {
        const aimed = dayStart.getTime() + m * minute;
        const id = `DEMO:ServiceJourney:${p.lineCode}-${m}`;
        // Stabil, deterministisk forsinkelse per tur (0–2,5 min), noe tidlig/presis
        const r = hash(id);
        const delay = r < 0.35 ? 0 : Math.round((r - 0.35) * 230) * 1000;
        const expected = aimed + delay;
        const cancelled = hash(id + 'c') < 0.015;
        journeys[id] = {
          journeyId: id, lineCode: p.lineCode, dest: p.dest,
          line: { code: p.lineCode, color: p.lineCode === '1' ? '#e4002b' : '#00843d', textColor: '#ffffff' },
          calls: p.stops.map(([name, off]) => ({ stopId: 'DEMO:' + slug(name), quayId: 'DEMO:' + slug(name), name, time: expected + off * minute }))
        };
        if (expected < now - 30000) continue;
        departures.push({
          key: id, journeyId: id, date,
          line: journeys[id].line,
          dest: p.dest, aimed, expected, realtime: true, cancelled
        });
      }
    }
    departures.sort((a, b) => a.expected - b.expected);

    // Fjern journeys langt utenfor synsfeltet
    Object.keys(journeys).forEach(id => {
      const c = journeys[id].calls;
      const here = c.find(x => x.name === 'Kvaleberg skole').time;
      if (here > now + 25 * minute || here < now - 15 * minute) delete journeys[id];
    });

    const situations = [];
    if (opts.traffic) {
      const n = Math.max(1, Math.min(3, opts.trafficCount || 1));
      const startIdx = opts.trafficIndex || 0;
      for (let i = 0; i < n; i++) situations.push(DEMO_SITUATIONS[(startIdx + i) % DEMO_SITUATIONS.length]);
    }

    return {
      source: 'demo',
      stop: { name: 'Kvaleberg skole', quayCode: 'A', quayId: 'DEMO:kvaleberg-skole', stopPlaceId: 'DEMO:kvaleberg-skole' },
      departures: departures.slice(0, 40), situations, journeys,
      fetchedAt: now, error: null
    };
  }

  BV.data = { fetchEntur, demoData, searchStops, getQuays, resolveDefaultQuay, DEMO_SITUATIONS };
})(window.BV);
