// Mappa dei muscoli: corpo stilizzato (fronte e retro) colorato in base alle serie, e equilibrio muscolare.
// Qui c'è solo logica pura e disegno SVG: i dati degli allenamenti li prepara workouts.js.
(function (N) {
  'use strict';

  // Le zone sono più fini dei gruppi della scheda: Gambe si divide in quadricipiti, femorali, polpacci, adduttori.
  const ZONES = [
    { id: 'spalle', label: 'Spalle', views: ['front', 'back'] },
    { id: 'petto', label: 'Petto', views: ['front'] },
    { id: 'bicipiti', label: 'Bicipiti', views: ['front'] },
    { id: 'addome', label: 'Addome', views: ['front'] },
    { id: 'quadricipiti', label: 'Quadricipiti', views: ['front'] },
    { id: 'adduttori', label: 'Adduttori', views: ['front'] },
    { id: 'trapezi', label: 'Trapezi', views: ['back'] },
    { id: 'dorso', label: 'Dorso', views: ['back'] },
    { id: 'lombari', label: 'Lombari', views: ['back'] },
    { id: 'tricipiti', label: 'Tricipiti', views: ['back'] },
    { id: 'glutei', label: 'Glutei', views: ['back'] },
    { id: 'femorali', label: 'Femorali', views: ['back'] },
    { id: 'polpacci', label: 'Polpacci', views: ['front', 'back'] }
  ];
  const ZONE_IDS = ZONES.map((z) => z.id);
  function zoneLabel(id) { const z = ZONES.find((x) => x.id === id); return z ? z.label : ''; }
  function isZone(id) { return ZONE_IDS.includes(id); }

  // Zona di partenza di ogni gruppo della scheda, quando l'esercizio non è nel catalogo.
  const GROUP_ZONE = { Petto: 'petto', Dorso: 'dorso', Spalle: 'spalle', Bicipiti: 'bicipiti', Tricipiti: 'tricipiti', Gambe: 'quadricipiti', Glutei: 'glutei', Addome: 'addome' };
  // Il «movimento» del catalogo precisa la zona dove il gruppo è troppo largo.
  const PATTERN_ZONE = {
    Dorso: { lombari: 'lombari' },
    Spalle: { trapezi: 'trapezi' },
    Gambe: { femorali: 'femorali', polpacci: 'polpacci', adduttori: 'adduttori' },
    Glutei: {}
  };
  // zoneFor('Gambe', 'femorali') → { zone: 'femorali', exact: true }.
  // `exact` è falso solo quando il gruppo è ambiguo e il movimento non è noto (es. un esercizio di Gambe scritto a mano).
  function zoneFor(group, pattern) {
    const base = GROUP_ZONE[group];
    if (!base) return { zone: null, exact: false };
    const byPattern = pattern && PATTERN_ZONE[group] && PATTERN_ZONE[group][pattern];
    if (byPattern) return { zone: byPattern, exact: true };
    return { zone: base, exact: group !== 'Gambe' || !!pattern };
  }

  // Da 0 (nessuna serie) a 4, in proporzione al massimo mostrato. Con lo stesso massimo due corpi si confrontano a colpo d'occhio.
  function level(sets, max) {
    const s = Number(sets) || 0, m = Number(max) || 0;
    if (s <= 0 || m <= 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil((s / m) * 4)));
  }

  /* ---------- Disegno ---------- */
  // Metà sinistra del corpo (x < 100) su una tela di 200 × 430; la destra è lo stesso disegno specchiato.
  const BASE = 'M100 58 L72 62 Q46 66 38 90 Q32 120 30 146 Q26 176 22 200 L20 214 Q24 222 34 216 L40 202 Q46 176 52 150 L56 120 L62 126 Q64 150 70 172 Q64 190 64 212 Q62 220 64 226 Q58 276 67 326 Q65 356 69 390 L68 410 Q66 418 76 420 L90 420 Q97 416 94 406 L93 390 Q92 356 94 326 Q96 276 98 236 L100 226 Z';
  const SHOULDER = 'M72 63 Q47 67 39 90 L38 106 L57 108 Q56 86 68 74 Z';
  const ARM = 'M36 108 L57 112 Q56 128 52 144 L32 144 Q31 126 36 108 Z';
  const SHAPES = {
    front: {
      spalle: SHOULDER,
      petto: 'M100 70 L74 70 Q60 74 60 92 Q64 110 82 112 L100 110 Z',
      bicipiti: ARM,
      addome: 'M78 116 L100 112 L100 178 L80 178 Q75 148 78 116 Z',
      quadricipiti: 'M66 234 L98 236 Q95 276 93 314 L68 314 Q60 276 66 234 Z',
      adduttori: 'M98 242 Q95 278 92 308 L80 308 Q84 272 86 244 Z',
      polpacci: 'M69 336 Q67 362 71 384 L90 384 Q93 362 92 336 Z'
    },
    back: {
      trapezi: 'M100 58 L72 63 L84 84 L100 104 Z',
      spalle: SHOULDER,
      dorso: 'M100 106 L84 88 L68 98 Q60 114 63 132 Q66 148 76 158 L100 158 Z',
      lombari: 'M78 160 L100 160 L100 196 L71 196 Q68 176 78 160 Z',
      tricipiti: ARM,
      glutei: 'M100 196 L68 196 Q62 212 65 236 Q80 250 100 246 Z',
      femorali: 'M65 242 L98 248 Q95 282 93 314 L68 314 Q60 280 65 242 Z',
      polpacci: 'M68 330 Q63 352 71 378 L91 378 Q97 352 93 330 Z'
    }
  };
  const MIRROR = ' transform="translate(200 0) scale(-1 1)"';
  const mirrored = (d) => '<path d="' + d + '"' + MIRROR + '/>';
  const both = (d) => '<path d="' + d + '"/>' + mirrored(d);

  // levels: { zoneId: 0..4 }, sets: { zoneId: serie } (solo per l'etichetta), selected: id della zona toccata.
  function svg(view, levels, opts) {
    const v = view === 'back' ? 'back' : 'front';
    const o = opts || {}, lv = levels || {}, sets = o.sets || {};
    const zones = ZONES.filter((z) => z.views.includes(v)).map((z) => {
      const n = Math.max(0, Math.min(4, Number(lv[z.id]) || 0));
      const count = Number(sets[z.id]) || 0;
      const label = z.label + ': ' + count + ' serie';
      return '<g class="bm-zone lv' + n + (o.selected === z.id ? ' sel' : '') + '" data-zone="' + z.id + '" role="button" tabindex="0" aria-pressed="' + (o.selected === z.id ? 'true' : 'false') + '" aria-label="' + label + '">'
        + '<title>' + label + '</title>' + both(SHAPES[v][z.id]) + '</g>';
    }).join('');
    return '<svg class="bm-svg" viewBox="0 0 200 430" role="group" aria-label="' + (v === 'front' ? 'Corpo visto da davanti' : 'Corpo visto da dietro') + '" data-bm-view="' + v + '" xmlns="http://www.w3.org/2000/svg">'
      + '<g class="bm-base">' + both(BASE) + '<ellipse cx="100" cy="26" rx="15" ry="18"/><rect x="92" y="42" width="16" height="18" rx="4"/></g>'
      + zones + '</svg>';
  }

  /* ---------- Equilibrio muscolare ---------- */
  const MIN_SETS = 6; // sotto questo totale il rapporto non dice niente
  const PAIRS = [
    { id: 'spinta-trazione', a: 'Spinta', b: 'Trazione', min: 0.7,
      lowA: 'Spingi poco rispetto a quanto tiri: aggiungi serie di petto, spalle o tricipiti.',
      lowB: 'Spingi molto più di quanto tiri: aggiungi rematori, trazioni o alzate posteriori.' },
    { id: 'quadricipiti-femorali', a: 'Quadricipiti', b: 'Femorali', min: 0.5,
      lowA: 'I quadricipiti restano indietro rispetto ai femorali: aggiungi squat, pressa o leg extension.',
      lowB: 'I femorali restano indietro rispetto ai quadricipiti: aggiungi leg curl o stacchi rumeni.' },
    { id: 'alto-basso', a: 'Parte alta', b: 'Parte bassa', min: 0.5,
      lowA: 'La parte alta resta indietro rispetto a gambe e glutei: aggiungi serie di petto, dorso o spalle.',
      lowB: 'Gambe e glutei restano indietro rispetto alla parte alta: aggiungi squat, stacchi o hip thrust.' }
  ];
  // status: 'few' (dati insufficienti), 'ok', 'low-a' (il lato A è sotto soglia), 'low-b'.
  function judge(pair, a, b) {
    const x = Math.max(0, Number(a) || 0), y = Math.max(0, Number(b) || 0), total = x + y;
    const share = total ? Math.round((x / total) * 100) : 0;
    let status = 'ok';
    if (total < MIN_SETS) status = 'few';
    else if (x < y * pair.min) status = 'low-a';
    else if (y < x * pair.min) status = 'low-b';
    const advice = status === 'low-a' ? pair.lowA : status === 'low-b' ? pair.lowB : '';
    return { id: pair.id, labelA: pair.a, labelB: pair.b, a: x, b: y, total, shareA: share, shareB: total ? 100 - share : 0, status, advice };
  }
  // sets: { push, pull, quad, ham, upper, lower } → una riga per coppia.
  function balance(sets) {
    const s = sets || {};
    return [judge(PAIRS[0], s.push, s.pull), judge(PAIRS[1], s.quad, s.ham), judge(PAIRS[2], s.upper, s.lower)];
  }

  const _logic = { ZONES, ZONE_IDS, GROUP_ZONE, PATTERN_ZONE, PAIRS, MIN_SETS, zoneFor, zoneLabel, isZone, level, judge, balance, SHAPES };
  N.bodyMap = { ZONES, zoneFor, zoneLabel, isZone, level, svg, balance, judge, PAIRS, MIN_SETS, _logic };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.bodyMap;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
