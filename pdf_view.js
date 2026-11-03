/* Lettore PDF (offline) — pagine scorrevoli, zoom, ricerca nel testo, ultima pagina ricordata.
   Usa pdf.js dalla cartella vendor/. Le pagine vengono disegnate solo quando servono (vicino allo schermo)
   e liberate quando si allontanano, così anche i PDF lunghi non saturano la memoria del telefono.
   Ogni pagina ha già un livello "sopra" per le annotazioni (si aggiungono nei passi successivi). */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA (testabile da sola, senza browser)
     ===================================================================== */

  // Normalizza un carattere per la ricerca (maiuscole e accenti ignorati) SENZA cambiare la lunghezza del testo,
  // così le posizioni trovate coincidono con quelle del testo originale.
  function foldChar(c) {
    if (c.length !== 1) return c;
    if (c === ' ' || c === ' ') return ' ';
    const d = c.normalize('NFD').charAt(0) || c;
    const l = d.toLowerCase();
    return l.length === 1 ? l : d;
  }
  function fold(s) {
    let o = '';
    for (const c of String(s)) o += foldChar(c);
    return o;
  }
  function normQuery(q) { return fold(q).replace(/\s+/g, ' ').trim(); }

  // Testo di una pagina a partire dalle "voci" di pdf.js: stringa unica + posizione di ogni voce.
  function buildPage(items) {
    let raw = '';
    const ranges = [];
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      const from = raw.length;
      raw += it.str;
      ranges.push({ it, from, to: raw.length });
      if (it.hasEOL) raw += ' ';
    }
    return { raw, str: fold(raw), ranges };
  }

  // Testo semplice per una nota: una riga per ogni "a capo" del PDF.
  function plainText(items) {
    let o = '';
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      o += it.str;
      if (it.hasEOL) o += '\n';
    }
    return o.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function findAll(hay, needle, max) {
    const out = [];
    if (!needle) return out;
    let i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) {
      out.push([i, i + needle.length]);
      i += needle.length;
      if (out.length >= (max || 1e9)) break;
    }
    return out;
  }

  // Quali voci di testo copre un risultato [s, e) e quale frazione di ciascuna.
  function partsFor(ranges, s, e) {
    const out = [];
    for (const r of ranges) {
      if (r.to <= r.from || r.to <= s || r.from >= e) continue;
      out.push({ item: r.it, from: Math.max(s, r.from) - r.from, to: Math.min(e, r.to) - r.from });
    }
    return out;
  }

  // Indice della pagina che contiene la posizione y (tops = bordo superiore di ogni pagina, crescente).
  function pageAt(tops, y) {
    let lo = 0, hi = tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid] <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  // Pagine da disegnare: quelle che toccano [y0, y1].
  function visibleRange(tops, heights, y0, y1) {
    const n = tops.length;
    if (!n) return [0, -1];
    let a = pageAt(tops, y0);
    while (a < n - 1 && tops[a] + heights[a] < y0) a++;
    let b = a;
    while (b + 1 < n && tops[b + 1] <= y1) b++;
    return [a, b];
  }

  // Tratto a mano libera: toglie i punti troppo vicini (alleggerisce) e lo trasforma in un percorso SVG.
  function thinPoints(pts, minD) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) >= minD) out.push([p[0], p[1]]);
    }
    return out;
  }
  function pathOf(pts, fy, prec) {
    if (!pts || !pts.length) return '';
    const f = fy || ((y) => y), k = prec || 100, r = (v) => Math.round(v * k) / k;
    const q = pts.length === 1 ? [pts[0], [pts[0][0] + 0.01, pts[0][1]]] : pts; // un tocco solo = un puntino
    return q.map((p, i) => (i ? 'L' : 'M') + r(p[0]) + ' ' + r(f(p[1]))).join(' ');
  }
  function hexRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  const INK_TOOLS = { pen: { w: 2.2, op: 1 }, hl: { w: 14, op: 0.4 }, txt: { w: 0, op: 0.4 } };

  // ---- Evidenziazione che segue il testo ----
  // Ogni voce di testo di pdf.js viene trasformata in una "scatola" con origine, direzione di scrittura (d),
  // direzione "verso l'alto" (u), larghezza e altezza del carattere, tutto in coordinate della pagina a zoom 1.
  // `tf(item)` restituisce la matrice (già moltiplicata per la vista) della voce.
  const HL_BELOW = 0.22, HL_ABOVE = 0.92;     // quanto la fascia scende sotto / sale sopra la linea di base (in corpi)
  function buildBoxes(items, tf) {
    const out = [];
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string' || !it.str.length) continue;
      const m = tf(it), fh = Math.hypot(m[2], m[3]) || 10, dl = Math.hypot(m[0], m[1]) || 1;
      const w = Math.max(0, +it.width || 0);
      if (!(w > 0)) continue;
      out.push({ it, str: it.str, len: it.str.length, ox: m[4], oy: m[5], dx: m[0] / dl, dy: m[1] / dl, ux: m[2] / fh, uy: m[3] / fh, w, fh });
    }
    return out;
  }
  // Punto (x, y) della pagina → voce più vicina e posizione del carattere al suo interno.
  function locate(boxes, x, y) {
    let best = -1, bd = Infinity, bl = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], px = x - b.ox, py = y - b.oy;
      const lx = px * b.dx + py * b.dy, ly = px * b.ux + py * b.uy;
      const ex = Math.max(0, -lx, lx - b.w), ey = Math.max(0, -ly - HL_BELOW * b.fh, ly - HL_ABOVE * b.fh);
      const dd = Math.hypot(ex, ey * 1.5);       // una riga sbagliata pesa più di una colonna sbagliata
      if (dd < bd) { bd = dd; best = i; bl = lx; }
    }
    if (best < 0) return null;
    const b = boxes[best];
    return { bi: best, off: clamp(Math.round(bl / b.w * b.len), 0, b.len) };
  }
  // Dal punto A al punto B (in ordine di lettura): i rettangoli (4 angoli ciascuno) da colorare.
  // Gli estremi si allargano alla parola intera, così si evidenzia sempre "pulito".
  function selectQuads(boxes, a, b) {
    const p = locate(boxes, a[0], a[1]), q = locate(boxes, b[0], b[1]);
    if (!p || !q) return [];
    let lo = p, hi = q;
    if (p.bi > q.bi || (p.bi === q.bi && p.off > q.off)) { lo = q; hi = p; }
    const quads = [];
    for (let bi = lo.bi; bi <= hi.bi; bi++) {
      const bx = boxes[bi];
      let from = bi === lo.bi ? lo.off : 0, to = bi === hi.bi ? hi.off : bx.len;
      if (bi === lo.bi) while (from > 0 && bx.str[from - 1] !== ' ') from--;
      if (bi === hi.bi) while (to < bx.len && bx.str[to] !== ' ') to++;
      if (to <= from || !bx.str.slice(from, to).trim()) continue;
      const s = bx.w * from / bx.len, e = bx.w * to / bx.len, r = (v) => Math.round(v * 100) / 100;
      const pt = (along, up) => [r(bx.ox + bx.dx * along + bx.ux * up * bx.fh), r(bx.oy + bx.dy * along + bx.uy * up * bx.fh)];
      quads.push([pt(s, -HL_BELOW), pt(e, -HL_BELOW), pt(e, HL_ABOVE), pt(s, HL_ABOVE)]);
    }
    return quads;
  }
  const quadsPath = (quads, fy) => quads.map((qd) => qd.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + (fy ? fy(p[1]) : p[1])).join(' ') + ' Z').join(' ');
  const INK_COLORS = ['#ffeb3b', '#69f0ae', '#ff80ab', '#e53935', '#1e66f5', '#111111'];

  // Firma: i tratti disegnati nel riquadro vengono normalizzati (altezza = 1, larghezza = ar) così si possono
  // ridimensionare a piacere. Restituisce null se non c'è nulla di disegnato.
  function normSignature(strokes) {
    const ss = (strokes || []).filter((s) => s && s.length);
    if (!ss.length) return null;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of ss) for (const p of s) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    const bh = Math.max(1, y1 - y0), bw = Math.max(1, x1 - x0);
    const r = (v) => Math.round(v * 1e4) / 1e4;
    return { ar: r(bw / bh), strokes: ss.map((s) => s.map((p) => [r((p[0] - x0) / bh), r((p[1] - y0) / bh)])) };
  }
  // Testo nuovo: l'altezza di riga e la posizione della linea di base (in frazioni del corpo) sono quelle del font
  // Liberation Sans con interlinea 1,2, uguali nell'anteprima sullo schermo e nel PDF salvato.
  const TEXT_LINE = 1.2, TEXT_BASE = 0.9465;
  const TEXT_COLORS = ['#111111', '#1e66f5', '#e53935', '#2e7d32', '#6d6d6d'];
  const textLines = (t) => String(t == null ? '' : t).replace(/\r/g, '').split('\n');
  // Posizione (sullo schermo, in unità pagina) della linea di base di ogni riga.
  function textBaselines(o) { return textLines(o.text).map((_, i) => o.y + o.size * (i * TEXT_LINE + TEXT_BASE)); }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ---- Correzione del testo esistente («copri e riscrivi») ----
  // Si tocca una riga: le voci di testo di pdf.js sulla stessa linea di base vengono unite in una riga sola,
  // la riga viene coperta con un riquadro del colore dello sfondo e sopra si scrive il testo nuovo.
  const FIX_BELOW = 0.22, FIX_ABOVE = 0.85;   // quanto il riquadro scende sotto / sale sopra la linea di base (in corpi)
  const FIX_REACH = 0.8;                      // distanza massima del tocco dal testo (in corpi)
  const FIX_GAP = 0.8;                        // spazio massimo tra due voci della stessa riga (in corpi)
  // Voce di testo più vicina al punto (x, y) e distanza in corpi.
  function nearBox(boxes, x, y) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], px = x - b.ox, py = y - b.oy;
      const lx = px * b.dx + py * b.dy, ly = px * b.ux + py * b.uy;
      const ex = Math.max(0, -lx, lx - b.w), ey = Math.max(0, -ly - HL_BELOW * b.fh, ly - HL_ABOVE * b.fh);
      const dd = Math.hypot(ex, ey * 1.5) / b.fh;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best < 0 ? null : { bi: best, d: bd };
  }
  // Riga di testo che contiene (o è subito sotto/sopra) il punto toccato; null se non c'è testo vicino.
  function lineAt(boxes, x, y) {
    const s = nearBox(boxes, x, y);
    if (!s || s.d > FIX_REACH) return null;
    const a = boxes[s.bi], fh = a.fh;
    const L = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.dx * a.dx + b.dy * a.dy < 0.995) continue;                         // altra direzione di scrittura
      const rx = b.ox - a.ox, ry = b.oy - a.oy;
      if (Math.abs(rx * a.ux + ry * a.uy) > 0.3 * fh) continue;                // altra linea di base
      const st = rx * a.dx + ry * a.dy;
      L.push({ b, st, en: st + b.w, me: i === s.bi });
    }
    L.sort((p, q) => p.st - q.st || p.en - q.en);
    const dup = (p, q) => Math.abs(p.st - q.st) < 0.5 && p.b.str === q.b.str; // stesso testo disegnato due volte (finto grassetto)
    const U = [];
    for (const p of L) {
      const q = U[U.length - 1];
      if (q && dup(q, p)) { if (p.me) q.me = true; } else U.push(p);
    }
    const k = Math.max(0, U.findIndex((p) => p.me));
    let lo = k, hi = k, end = U[k].en, start = U[k].st;
    for (let j = k + 1; j < U.length && U[j].st - end <= FIX_GAP * fh; j++) { hi = j; end = Math.max(end, U[j].en); }
    for (let j = k - 1; j >= 0 && start - U[j].en <= FIX_GAP * fh; j--) { lo = j; start = Math.min(start, U[j].st); }
    let text = '', prevEnd = null;
    for (let j = lo; j <= hi; j++) {
      const p = U[j];
      if (prevEnd !== null && p.st - prevEnd > 0.12 * fh && !/\s$/.test(text) && !/^\s/.test(p.b.str)) text += ' ';
      text += p.b.str;
      prevEnd = Math.max(prevEnd === null ? -Infinity : prevEnd, p.en);
    }
    const r = (v) => Math.round(v * 100) / 100;
    return { text: text.replace(/\s+$/, '').replace(/^\s+/, ''), ox: r(a.ox + a.dx * start), oy: r(a.oy + a.dy * start), dx: a.dx, dy: a.dy, ux: a.ux, uy: a.uy, w: r(end - start), fh, n: hi - lo + 1 };
  }
  // Solo le righe orizzontali (come appaiono sullo schermo) si possono correggere.
  const isUpright = (ln) => !!ln && ln.dx > 0.995 && Math.abs(ln.dy) < 0.05 && ln.uy < -0.995 && Math.abs(ln.ux) < 0.05;
  // Riquadro che copre la riga (unità pagina, zoom 1).
  function coverRect(ln) {
    const pad = Math.max(0.6, 0.06 * ln.fh), r = (v) => Math.round(v * 100) / 100;
    return { x: r(ln.ox - pad), y: r(ln.oy - FIX_ABOVE * ln.fh), w: r(ln.w + 2 * pad), h: r((FIX_ABOVE + FIX_BELOW) * ln.fh) };
  }
  // Testo nuovo che prende il posto della riga: stesso punto di partenza e stessa altezza.
  function fixDraft(ln) {
    const size = clamp(Math.round(ln.fh * 10) / 10, 6, 120);
    return { text: ln.text, size, x: ln.ox, y: Math.round((ln.oy - size * TEXT_BASE) * 100) / 100, rect: coverRect(ln) };
  }
  const toHex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  // Colori letti dal rendering: sfondo = colore prevalente attorno al riquadro `r` (px, coordinate dell'immagine),
  // testo = colore medio dei pixel più lontani dallo sfondo dentro il riquadro (null se non se ne trovano).
  function sampleColors(img, r) {
    const W = img.width, H = img.height, D = img.data, T = 3;
    const bins = new Map();
    const x0 = Math.floor(r.x), y0 = Math.floor(r.y), x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
    const add = (x, y) => {
      const k = (y * W + x) * 4, key = (D[k] >> 4) << 8 | (D[k + 1] >> 4) << 4 | (D[k + 2] >> 4);
      const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += D[k]; e.g += D[k + 1]; e.b += D[k + 2];
      bins.set(key, e);
    };
    for (let y = Math.max(0, y0 - T); y < Math.min(H, y1 + T); y++) {
      const inY = y >= y0 && y < y1;
      for (let x = Math.max(0, x0 - T); x < Math.min(W, x1 + T); x++) if (!(inY && x >= x0 && x < x1)) add(x, y);
    }
    if (!bins.size) {                          // riquadro che occupa tutta l'immagine: vale il colore prevalente al suo interno
      for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) add(x, y);
    }
    let bg = [255, 255, 255], top = 0;
    for (const e of bins.values()) if (e.n > top) { top = e.n; bg = [e.r / e.n, e.g / e.n, e.b / e.n]; }
    const far = [];
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        const k = (y * W + x) * 4, dr = D[k] - bg[0], dg = D[k + 1] - bg[1], db = D[k + 2] - bg[2], dd = dr * dr + dg * dg + db * db;
        if (dd > 90 * 90) far.push([dd, D[k], D[k + 1], D[k + 2]]);
      }
    }
    let fg = null;
    if (far.length >= 3) {
      far.sort((p, q) => q[0] - p[0]);
      const m = Math.max(3, Math.ceil(far.length / 4));
      let sr = 0, sg = 0, sb = 0;
      for (let i = 0; i < m; i++) { sr += far[i][1]; sg += far[i][2]; sb += far[i][3]; }
      fg = toHex([sr / m, sg / m, sb / m]);
    }
    return { bg: toHex(bg), fg };
  }

  const ZMIN = 0.5, ZMAX = 5;
  const clampZoom = (z) => Math.min(ZMAX, Math.max(ZMIN, Math.round(z * 100) / 100));

  /* =====================================================================
     2) LETTORE
     ===================================================================== */

  const SV = {
    search: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M5 12h14"/></svg>',
    up: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 14l6-6 6 6"/></svg>',
    down: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 10l6 6 6-6"/></svg>',
    pen: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z"/></svg>',
    undo: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M9 7L4 12l5 5M4 12h10a6 6 0 010 12"/></svg>',
    x: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ins: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><path d="M4 7V5h10v2M9 5v9M7 14h4"/><path d="M13 20c2-3 3-6 5-6s0 5 3 2"/></svg>',
    sign: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M3 17c2-6 4-9 5-9s0 6 2 6 3-4 4-4 1 3 3 3 2-1 3-2M3 21h18"/></svg>',
    text: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    form: '<svg class="i" viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
    trash: '<svg class="i" viewBox="0 0 24 24" width="18" height="18"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
    edit: '<svg class="i" viewBox="0 0 24 24" width="18" height="18"><path d="M4 20l1-4L16.5 4.5a2 2 0 013 3L8 19l-4 1z"/></svg>'
  };

  async function openPdf(d, A) {
    const h = A.h;
    await A.lib('pdfjs');
    const pdfjs = window.pdfjsLib;

    // pdf.js "consuma" i dati che riceve: gliene diamo una copia, l'originale resta intatto.
    const task = pdfjs.getDocument({
      data: new Uint8Array(d.data.slice(0)),
      cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: 'vendor/pdfjs/standard_fonts/',
      isEvalSupported: false
    });
    task.onPassword = (update, reason) => {
      const wrong = reason === (pdfjs.PasswordResponses || {}).INCORRECT_PASSWORD;
      const pw = prompt(wrong ? 'Password errata. Riprova:' : 'Questo PDF è protetto da password. Inseriscila:');
      if (pw === null) task.destroy(); else update(pw);
    };
    let pdf;
    try { pdf = await task.promise; } catch (e) {
      throw new Error(e && e.name === 'PasswordException' ? 'password non inserita' : (e && e.message) || e);
    }

    const n = pdf.numPages;
    let dead = false;

    /* ---------- schermata ---------- */
    const scr = A.screen(d.name, { onClose: () => cleanup() });
    const body = scr.body;
    body.classList.add('pdf-body');
    const inner = h('div', { class: 'pdf-pages' });
    const status = h('p', { class: 'pdf-status' }, 'Apertura del PDF…');
    body.append(status);

    const pill = h('button', { class: 'pdf-pill', 'aria-label': 'Vai a una pagina', 'data-pill': '1' }, '– / ' + n);
    scr.el.append(pill);

    // barra di ricerca
    const sInput = h('input', { type: 'search', placeholder: 'Cerca nel documento', 'aria-label': 'Cerca nel documento', 'data-pdf-q': '1', enterkeyhint: 'search' });
    const sCount = h('span', { class: 'pdf-count', 'data-pdf-count': '1' }, '');
    const sBar = h('div', { class: 'pdf-search' }, sInput, sCount,
      h('button', { class: 'ibtn', 'aria-label': 'Risultato precedente', 'data-pdf-prev': '1', html: SV.up }),
      h('button', { class: 'ibtn', 'aria-label': 'Risultato successivo', 'data-pdf-next': '1', html: SV.down }),
      h('button', { class: 'ibtn', 'aria-label': 'Chiudi la ricerca', 'data-pdf-close': '1', html: SV.x }));
    scr.el.insertBefore(sBar, body);

    const btn = (svg, fn, label, attr) => h('button', Object.assign({ class: 'ibtn', 'aria-label': label, title: label, onclick: fn, html: svg }, attr || {}));
    scr.actions.append(
      btn(SV.search, () => toggleSearch(), 'Cerca', { 'data-pdf-search': '1' }),
      btn(SV.minus, () => zoomBy(1 / 1.25), 'Riduci', { 'data-pdf-zoomout': '1' }),
      btn(SV.plus, () => zoomBy(1.25), 'Ingrandisci', { 'data-pdf-zoomin': '1' }),
      A.ibtn('more', () => moreMenu(), 'Altro', 'pdf-more'));

    /* ---------- misure delle pagine ---------- */
    const pageObjs = new Array(n), base = new Array(n);
    for (let s = 0; s < n && !dead; s += 40) {
      await Promise.all(Array.from({ length: Math.min(40, n - s) }, async (_, k) => {
        const i = s + k;
        const p = await pdf.getPage(i + 1);
        pageObjs[i] = p;
        const v = p.getViewport({ scale: 1 });
        base[i] = { w: v.width, h: v.height };
      }));
    }
    if (dead) return;
    status.remove();
    body.append(inner);

    /* ---------- struttura delle pagine ---------- */
    let zoom = 1, fitW = 300, zKey = '';
    const pages = [];
    for (let i = 0; i < n; i++) {
      const hl = h('div', { class: 'pdf-hl' });
      const ink = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      ink.setAttribute('class', 'pdf-ink');
      ink.setAttribute('viewBox', '0 0 ' + base[i].w + ' ' + base[i].h);
      ink.setAttribute('preserveAspectRatio', 'none');
      ink.dataset.page = String(i);
      const ol = h('div', { class: 'pdf-objs' });
      const fl = h('div', { class: 'pdf-form' });
      const el = h('div', { class: 'pdf-page', 'data-page': String(i + 1), role: 'img', 'aria-label': 'Pagina ' + (i + 1) + ' di ' + n }, hl, ink, ol, fl);
      pages.push({ el, hl, ink, ol, fl, canvas: null, key: null, busy: false, gen: 0, task: null, cs: 1, err: false });
      inner.append(el);
    }
    let tops = [], heights = [];
    const want = new Set();
    let cur = 0, active = 0;

    function layout() {
      fitW = Math.max(200, body.clientWidth - 16);
      zKey = zoom + '/' + fitW;
      for (let i = 0; i < n; i++) {
        const p = pages[i];
        p.cs = (fitW / base[i].w) * zoom;
        p.el.style.width = Math.round(base[i].w * p.cs) + 'px';
        p.el.style.height = Math.round(base[i].h * p.cs) + 'px';
        p.el.style.setProperty('--cs', String(p.cs));
        p.hl.replaceChildren();
      }
      tops = pages.map((p) => p.el.offsetTop);
      heights = pages.map((p) => p.el.offsetHeight);
    }

    /* ---------- disegno delle pagine ---------- */
    async function renderPage(i) {
      const p = pages[i];
      p.busy = true;
      const my = ++p.gen;
      const key = zKey;
      try {
        const page = pageObjs[i];
        let out = Math.min(window.devicePixelRatio || 1, 2);
        let vp = page.getViewport({ scale: p.cs * out });
        while (vp.width * vp.height > 12e6 && out > 0.3) { out *= 0.85; vp = page.getViewport({ scale: p.cs * out }); }
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.floor(vp.width));
        c.height = Math.max(1, Math.floor(vp.height));
        const rt = page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' });
        p.task = rt;
        await rt.promise;
        if (dead || p.gen !== my) return;
        if (p.canvas) p.canvas.remove();
        p.canvas = c;
        p.el.insertBefore(c, p.hl);
        p.key = key;
        p.err = false;
        drawHighlights(i);
      } catch (e) {
        if (!e || e.name !== 'RenderingCancelledException') {
          console.error(e);
          if (!dead && p.gen === my) { p.err = true; p.key = key; p.el.dataset.err = '1'; }
        }
      } finally {
        p.busy = false;
        p.task = null;
      }
    }

    function pump() {
      while (!dead && active < 2) {
        let best = -1, bd = 1e9;
        for (const i of want) {
          const p = pages[i];
          if (p.busy || p.key === zKey) continue;
          const dist = Math.abs(i - cur);
          if (dist < bd) { bd = dist; best = i; }
        }
        if (best < 0) return;
        active++;
        renderPage(best).finally(() => { active--; pump(); });
      }
    }

    function release(i) {
      const p = pages[i];
      p.gen++;
      if (p.task) { try { p.task.cancel(); } catch (e) { /* già finito */ } }
      if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; }
      p.key = null;
      delete p.el.dataset.err;
    }

    function refresh() {
      if (dead || !tops.length) return;
      const y = body.scrollTop, ch = body.clientHeight;
      const [a, b] = visibleRange(tops, heights, y - ch, y + ch * 2);
      want.clear();
      for (let i = a; i <= b; i++) want.add(i);
      // libera le pagine lontane (oltre ~3 schermi dal punto in cui si legge)
      const [ka, kb] = visibleRange(tops, heights, y - ch * 3, y + ch * 4);
      for (let i = 0; i < n; i++) if ((i < ka || i > kb) && (pages[i].canvas || pages[i].task)) release(i);
      cur = pageAt(tops, y + ch * 0.4);
      lastPos = calcPos() || lastPos;
      pill.textContent = (cur + 1) + ' / ' + n;
      pump();
      savePosSoon();
    }
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); };
    body.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- zoom ---------- */
    function setZoom(z) {
      z = clampZoom(z);
      if (z === zoom && zKey === zoom + '/' + Math.max(200, body.clientWidth - 16)) return;
      const fy = (body.scrollTop + body.clientHeight / 2) / Math.max(1, body.scrollHeight);
      const fx = (body.scrollLeft + body.clientWidth / 2) / Math.max(1, body.scrollWidth);
      zoom = z;
      layout();
      body.scrollTop = fy * body.scrollHeight - body.clientHeight / 2;
      body.scrollLeft = fx * body.scrollWidth - body.clientWidth / 2;
      refresh();
      redrawAllHighlights();
    }
    function zoomBy(f) { setZoom(zoom * f); }

    // pizzico con due dita + doppio tocco
    let pinch = null, lastTap = 0, tapPos = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    body.addEventListener('touchstart', (e) => {
      if (e.target.closest && e.target.closest('.pdf-obj')) { tapPos = null; if (e.touches.length < 2) return; }
      if (e.touches.length === 2) { pinch = { d0: dist(e.touches), z0: zoom, r: 1 }; tapPos = null; }
      else if (e.touches.length === 1) tapPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    body.addEventListener('touchmove', (e) => {
      if (tapPos && e.touches.length === 1 && Math.hypot(e.touches[0].clientX - tapPos.x, e.touches[0].clientY - tapPos.y) > 10) tapPos = null;
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      pinch.r = Math.min(ZMAX / pinch.z0, Math.max(ZMIN / pinch.z0, dist(e.touches) / pinch.d0));
      inner.style.transformOrigin = (body.scrollLeft + body.clientWidth / 2) + 'px ' + (body.scrollTop + body.clientHeight / 2) + 'px';
      inner.style.transform = 'scale(' + pinch.r + ')';
    }, { passive: false });
    body.addEventListener('touchend', (e) => {
      if (pinch) {
        if (e.touches.length < 2) {
          const r = pinch.r, z0 = pinch.z0;
          pinch = null;
          inner.style.transform = ''; inner.style.transformOrigin = '';
          setZoom(z0 * r);
        }
        return;
      }
      if (tapPos && e.touches.length === 0) {
        const now = Date.now();
        if (now - lastTap < 320) { lastTap = 0; setZoom(zoom < 1.5 ? 2.5 : 1); }
        else lastTap = now;
      }
    }, { passive: true });
    const onResize = () => { clearTimeout(onResize.t); onResize.t = setTimeout(() => { if (!dead) { zKey = ''; setZoom(zoom); } }, 200); };
    window.addEventListener('resize', onResize);

    /* ---------- ricerca ---------- */
    const S = { q: '', matches: [], byPage: new Map(), idx: -1, token: 0, texts: new Map(), hasText: null };

    async function getText(i) {
      if (S.texts.has(i)) return S.texts.get(i);
      const tc = await pageObjs[i].getTextContent();
      const t = { items: tc.items, page: buildPage(tc.items) };
      S.texts.set(i, t);
      return t;
    }

    function rectsFor(i, part) {
      const p = pages[i];
      const vp = pageObjs[i].getViewport({ scale: p.cs });
      const it = part.item;
      const tx = pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(tx[2], tx[3]) || 10;
      const ang = Math.atan2(tx[1], tx[0]);
      const len = Math.max(1, it.str.length);
      const wpx = it.width * p.cs;
      const off = wpx * part.from / len;
      const w = Math.max(2, wpx * (part.to - part.from) / len);
      return { x: tx[4] + off * Math.cos(ang), y: tx[5] + off * Math.sin(ang) - fh, w, h: fh, ang };
    }

    function drawHighlights(i) {
      const p = pages[i];
      p.hl.replaceChildren();
      const list = S.byPage.get(i);
      if (!list) return;
      for (const m of list) for (const part of m.parts) {
        const r = rectsFor(i, part);
        const e = document.createElement('i');
        if (m.k === S.idx) e.className = 'cur';
        e.style.cssText = 'left:' + r.x.toFixed(1) + 'px;top:' + r.y.toFixed(1) + 'px;width:' + r.w.toFixed(1) + 'px;height:' + r.h.toFixed(1) + 'px;' + (r.ang ? 'transform:rotate(' + r.ang.toFixed(4) + 'rad);' : '');
        p.hl.append(e);
      }
    }
    function redrawAllHighlights() { for (let i = 0; i < n; i++) { if (pages[i].canvas) drawHighlights(i); else pages[i].hl.replaceChildren(); } }

    function setCount() {
      if (!S.q) sCount.textContent = '';
      else if (S.searching) sCount.textContent = S.searching;
      else if (!S.matches.length) sCount.textContent = S.hasText === false ? 'Nessun testo' : '0';
      else sCount.textContent = (S.idx + 1) + '/' + S.matches.length;
    }

    async function doSearch(raw) {
      const token = ++S.token;
      const q = normQuery(raw);
      S.q = q; S.matches = []; S.byPage = new Map(); S.idx = -1; S.searching = '';
      if (!q) { setCount(); redrawAllHighlights(); return; }
      let anyText = false;
      for (let i = 0; i < n; i++) {
        if (S.token !== token || dead) return;
        const t = await getText(i);
        if (S.token !== token || dead) return; // la ricerca è cambiata o chiusa mentre leggevo la pagina
        if (t.page.raw.trim()) anyText = true;
        for (const [s, e] of findAll(t.page.str, q, 500)) {
          if (S.matches.length >= 2000) break;
          const m = { page: i, k: S.matches.length, parts: partsFor(t.page.ranges, s, e) };
          if (!m.parts.length) continue;
          S.matches.push(m);
          if (!S.byPage.has(i)) S.byPage.set(i, []);
          S.byPage.get(i).push(m);
        }
        if (i % 8 === 7) {
          S.searching = 'Cerco… ' + Math.round(((i + 1) / n) * 100) + '%';
          setCount();
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (S.token !== token || dead) return;
      S.searching = '';
      S.hasText = anyText ? true : (S.hasText === true ? true : false);
      const first = S.matches.findIndex((m) => m.page >= cur);
      if (S.matches.length) goMatch(first < 0 ? 0 : first); else { setCount(); redrawAllHighlights(); }
    }

    function goMatch(k) {
      if (!S.matches.length) return;
      S.idx = (k + S.matches.length) % S.matches.length;
      const m = S.matches[S.idx];
      setCount();
      redrawAllHighlights();
      const r = rectsFor(m.page, m.parts[0]);
      const ty = tops[m.page] + r.y - body.clientHeight / 3;
      body.scrollTop = Math.max(0, ty);
      if (zoom > 1) body.scrollLeft = Math.max(0, r.x - body.clientWidth / 3);
      refresh();
    }

    let sTimer = 0;
    function toggleSearch(force) {
      const on = force === undefined ? !sBar.classList.contains('on') : force;
      sBar.classList.toggle('on', on);
      if (on && I.on) toggleInk(false);
      if (on) { toggleIns(false); toggleForm(false); }
      if (on) { sInput.focus(); sInput.select(); }
      else { sInput.blur(); S.token++; S.q = ''; S.matches = []; S.byPage = new Map(); S.idx = -1; S.searching = ''; setCount(); redrawAllHighlights(); }
    }
    sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => doSearch(sInput.value), 280); });
    sInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      clearTimeout(sTimer);
      if (normQuery(sInput.value) !== S.q) doSearch(sInput.value); else goMatch(S.idx + (e.shiftKey ? -1 : 1));
    });
    sBar.querySelector('[data-pdf-next]').addEventListener('click', () => goMatch(S.idx + 1));
    sBar.querySelector('[data-pdf-prev]').addEventListener('click', () => goMatch(S.idx - 1));
    sBar.querySelector('[data-pdf-close]').addEventListener('click', () => toggleSearch(false));

    /* ---------- navigazione ---------- */
    function goPage(i, frac) {
      i = Math.max(0, Math.min(n - 1, i));
      body.scrollTop = tops[i] + (frac || 0) * heights[i] - 8;
      refresh();
    }
    function askPage() {
      const v = prompt('Vai alla pagina (1–' + n + '):', String(cur + 1));
      const num = parseInt(v, 10);
      if (num >= 1 && num <= n) goPage(num - 1);
    }
    pill.addEventListener('click', askPage);

    function moreMenu() {
      A.openSheet(d.name, h('div', null,
        h('button', { class: 'item', 'data-act': 'goto', onclick: async () => { await A.back(); askPage(); } }, h('span', { html: A.I('file', 22) }), 'Vai a pagina…'),
        h('button', { class: 'item', 'data-act': 'pages', onclick: async () => {
          await A.back();
          if (hasChanges()) return A.toast('Prima salva le annotazioni (pulsante «Salva»), poi gestisci le pagine', 4200);
          if (!N.pdfPages) return A.toast('Gestione pagine non disponibile');
          N.pdfPages.open(d, A, async () => { // a lavoro finito: chiude questo lettore e lo riapre sul file nuovo
            await A.back();
            openPdf(d, A).catch((e) => A.toast('Impossibile riaprire: ' + (e.message || e), 4500));
          });
        } }, h('span', { html: A.I('copy', 22) }), 'Gestisci pagine'),
        h('button', { class: 'item', 'data-act': 'tonote', onclick: async () => { await A.back(); toNote(); } }, h('span', { html: A.I('notes', 22) }), 'Salva il testo come nota'),
        h('button', { class: 'item', 'data-act': 'export', onclick: async () => { await A.back(); A.exportFile(d); } }, h('span', { html: A.I('share', 22) }), 'Esporta / condividi')));
    }

    async function toNote() {
      A.toast('Estraggo il testo…', 1500);
      const parts = [];
      for (let i = 0; i < n; i++) {
        if (dead) return;
        const t = await getText(i);
        const s = plainText(t.items);
        if (s) parts.push(s);
      }
      const text = parts.join('\n\n');
      if (!text.trim()) return A.toast('Questo PDF non contiene testo selezionabile (forse è una scansione)', 4200);
      A.saveAsNote(d.name, text);
      A.toast('Nota creata dal testo del PDF');
    }

    /* ---------- annotazioni a mano libera (penna ed evidenziatore) ---------- */
    const ann = pages.map(() => []);          // tratti per pagina, in coordinate della pagina a zoom 1
    const hist = [];                          // ordine di disegno, per «Annulla»
    const I = { on: false, tool: 'txt', color: INK_COLORS[0], saving: false };
    const formCh = new Map();                 // campi del modulo cambiati: nome → nuovo valore
    let fSave = null;
    const NS = 'http://www.w3.org/2000/svg';
    const pathEl = (st) => {
      const e = document.createElementNS(NS, 'path');
      e.setAttribute('d', pathOf(st.pts, null, st.prec));
      e.setAttribute('fill', 'none');
      e.setAttribute('stroke', st.color);
      e.setAttribute('stroke-width', st.w);
      e.setAttribute('stroke-opacity', st.op);
      e.setAttribute('stroke-linecap', 'round');
      e.setAttribute('stroke-linejoin', 'round');
      return e;
    };
    // evidenziazione sul testo: un solo tracciato con più rettangoli (le sovrapposizioni non si scuriscono)
    const quadEl = (st) => {
      const e = document.createElementNS(NS, 'path');
      e.setAttribute('d', quadsPath(st.quads));
      e.setAttribute('fill', st.color);
      e.setAttribute('fill-opacity', st.op);
      e.setAttribute('stroke', 'none');
      e.setAttribute('class', 'pdf-txthl');
      return e;
    };
    const tBtn = (attr, label, html, fn) => h('button', Object.assign({ class: 'ibtn pdf-tb', 'aria-label': label, title: label, html, onclick: fn }, attr));
    const colorBtns = INK_COLORS.map((c) => h('button', { class: 'pdf-col', 'data-ink-color': c, 'aria-label': 'Colore ' + c, style: { background: c }, onclick: () => { I.color = c; paintBar(); } }));
    const penBtn = tBtn({ 'data-ink-pen': '1' }, 'Penna', SV.pen, () => { I.tool = 'pen'; if (I.color === INK_COLORS[0]) I.color = INK_COLORS[4]; paintBar(); });
    const hlBtn = h('button', { class: 'pdf-tb pdf-hlbtn', 'data-ink-hl': '1', 'aria-label': 'Evidenziatore a mano libera', onclick: () => { I.tool = 'hl'; if (I.color === INK_COLORS[4] || I.color === INK_COLORS[5]) I.color = INK_COLORS[0]; paintBar(); } }, 'A mano');
    const txtBtn = h('button', { class: 'pdf-tb pdf-hlbtn', 'data-ink-txt': '1', 'aria-label': 'Evidenzia il testo', onclick: () => { I.tool = 'txt'; if (I.color === INK_COLORS[4] || I.color === INK_COLORS[5]) I.color = INK_COLORS[0]; paintBar(); } }, 'Evidenzia');
    const undoBtn = tBtn({ 'data-ink-undo': '1' }, 'Annulla ultimo tratto', SV.undo, () => undoInk());
    const saveBtn = h('button', { class: 'pdf-savebtn', 'data-ink-save': '1', onclick: () => saveInk() }, 'Salva');
    const tBar = h('div', { class: 'pdf-tools' }, txtBtn, hlBtn, penBtn, ...colorBtns, undoBtn, saveBtn,
      h('button', { class: 'ibtn pdf-tb', 'data-ink-close': '1', 'aria-label': 'Chiudi le annotazioni', html: SV.x, onclick: () => toggleInk(false) }));
    scr.el.insertBefore(tBar, body);
    function paintBar() {
      penBtn.classList.toggle('on', I.tool === 'pen');
      hlBtn.classList.toggle('on', I.tool === 'hl');
      txtBtn.classList.toggle('on', I.tool === 'txt');
      colorBtns.forEach((b) => b.classList.toggle('on', b.dataset.inkColor === I.color));
      undoBtn.disabled = !hist.length;
      saveBtn.disabled = !hasChanges() || I.saving;
      insSave.disabled = !hasChanges() || I.saving;
      if (fSave) fSave.disabled = !hasChanges() || I.saving;
    }
    function hasChanges() { return hist.length > 0 || objs.length > 0 || formCh.size > 0; }
    function toggleInk(force) {
      I.on = force === undefined ? !I.on : force;
      tBar.classList.toggle('on', I.on);
      body.classList.toggle('inking', I.on);
      if (I.on) { toggleSearch(false); toggleIns(false); toggleForm(false); }
      paintBar();
    }
    function drawInk(i) {
      const svg = pages[i].ink;
      svg.replaceChildren();
      for (const st of ann[i]) svg.append(st.tool === 'txt' ? quadEl(st) : pathEl(st));
    }
    function undoInk() {
      const last = hist.pop();
      if (!last) return;
      const k = ann[last.page].indexOf(last.st);
      if (k >= 0) ann[last.page].splice(k, 1);
      drawInk(last.page);
      paintBar();
    }

    // disegno con il dito (o il mouse): un solo dito disegna, due dita = zoom (il tratto in corso viene scartato)
    const ptrs = new Set();
    let cur_ = null;
    function toBase(e, svg, i) {
      const r = svg.getBoundingClientRect();
      return [(e.clientX - r.left) / Math.max(1, r.width) * base[i].w, (e.clientY - r.top) / Math.max(1, r.height) * base[i].h];
    }
    function dropStroke() { if (cur_) { cur_.el.remove(); cur_ = null; } }
    // evidenziazione che segue il testo: si trascina il dito dal primo all'ultimo carattere
    const geo = new Map();                    // pagina → "scatole" del testo (calcolate una volta sola)
    async function boxesOf(i) {
      if (geo.has(i)) return geo.get(i);
      const t = await getText(i);
      const vp = pageObjs[i].getViewport({ scale: 1 });
      const bx = buildBoxes(t.items, (it) => pdfjs.Util.transform(vp.transform, it.transform));
      geo.set(i, bx);
      return bx;
    }
    let sel_ = null, noTextToast = 0;
    function dropSel() { if (sel_) { sel_.el.remove(); sel_ = null; } }
    function paintSel() {
      if (!sel_ || !sel_.boxes) return;
      sel_.quads = selectQuads(sel_.boxes, sel_.a, sel_.b);
      sel_.el.setAttribute('d', quadsPath(sel_.quads));
    }
    function startSel(e, svg, i) {
      const el = document.createElementNS(NS, 'path');
      el.setAttribute('fill', I.color); el.setAttribute('fill-opacity', INK_TOOLS.txt.op); el.setAttribute('class', 'pdf-txthl');
      svg.append(el);
      const a = toBase(e, svg, i);
      const s = { i, svg, el, a, b: a, id: e.pointerId, boxes: null, quads: [], color: I.color };
      sel_ = s;
      ptrs.add(e.pointerId);
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* non fondamentale */ }
      e.preventDefault();
      boxesOf(i).then((bx) => { s.boxes = bx; if (sel_ === s) paintSel(); }).catch(() => { s.boxes = []; });
    }
    function moveSel(e) { sel_.b = toBase(e, sel_.svg, sel_.i); paintSel(); }
    async function endSel(e) {
      const s = sel_;
      if (e.type === 'pointercancel') { dropSel(); return; }
      s.b = toBase(e, s.svg, s.i);
      if (!s.boxes) { try { s.boxes = await boxesOf(s.i); } catch (x) { s.boxes = []; } }
      if (sel_ !== s || dead) return;               // nel frattempo l'azione è stata annullata o il lettore chiuso
      sel_ = null;
      s.el.remove();
      const quads = selectQuads(s.boxes, s.a, s.b);
      if (!quads.length) {
        if (!s.boxes.length && Date.now() - noTextToast > 4000) { noTextToast = Date.now(); A.toast('Qui non c’è testo da evidenziare (forse è una scansione): usa «A mano»', 4200); }
        return;
      }
      const st = { tool: 'txt', color: s.color, w: 0, op: INK_TOOLS.txt.op, quads };
      ann[s.i].push(st);
      hist.push({ page: s.i, st });
      drawInk(s.i);
      paintBar();
    }
    inner.addEventListener('pointerdown', (e) => {
      const svg = e.target.closest && e.target.closest('.pdf-ink');
      if (!I.on || !svg) return;
      ptrs.add(e.pointerId);
      if (ptrs.size > 1) { dropStroke(); dropSel(); return; }
      const i = +svg.dataset.page, t = INK_TOOLS[I.tool];
      if (I.tool === 'txt') { startSel(e, svg, i); return; }
      const st = { tool: I.tool, color: I.color, w: t.w, op: t.op, pts: [toBase(e, svg, i)] };
      cur_ = { i, st, svg, el: pathEl(st), id: e.pointerId };
      svg.append(cur_.el);
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* non fondamentale */ }
      e.preventDefault();
    });
    inner.addEventListener('pointermove', (e) => {
      if (sel_ && e.pointerId === sel_.id) { if (ptrs.size > 1) dropSel(); else moveSel(e); return; }
      if (!cur_ || e.pointerId !== cur_.id || ptrs.size > 1) return;
      const p = toBase(e, cur_.svg, cur_.i), l = cur_.st.pts[cur_.st.pts.length - 1];
      if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 0.6) return;
      cur_.st.pts.push(p);
      cur_.el.setAttribute('d', pathOf(cur_.st.pts));
    });
    const endPtr = (e) => {
      ptrs.delete(e.pointerId);
      if (sel_ && e.pointerId === sel_.id) { endSel(e); return; }
      if (!cur_ || e.pointerId !== cur_.id) return;
      const c = cur_; cur_ = null;
      if (e.type === 'pointercancel') { c.el.remove(); return; }
      c.st.pts = thinPoints(c.st.pts, 0.5);
      ann[c.i].push(c.st);
      hist.push({ page: c.i, st: c.st });
      c.el.setAttribute('d', pathOf(c.st.pts));
      paintBar();
    };
    inner.addEventListener('pointerup', endPtr);
    inner.addEventListener('pointercancel', endPtr);

    // scrive tratti, firme e testi dentro il PDF (restano visibili in qualsiasi lettore) e sostituisce il file nell'archivio
    async function bake() {
      await A.lib('pdflib');
      const { PDFDocument, rgb, LineCapStyle, degrees } = window.PDFLib;
      const doc = await PDFDocument.load(d.data.slice(0), { ignoreEncryption: true });
      const ps = doc.getPages();
      if (formCh.size) {
        const form = doc.getForm(), F = window.PDFLib, bad = [];
        for (const [name, v] of formCh) {
          let f = null;
          try { f = form.getField(name); } catch (e) { bad.push(name); continue; }
          try {
            if (f instanceof F.PDFTextField) { if (v) f.setText(String(v)); else f.setText(undefined); }
            else if (f instanceof F.PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
            else if (f instanceof F.PDFRadioGroup) {
              // alcuni programmi nominano gli stati con l'indice (0, 1…) e tengono i nomi veri in /Opt
              const opts = f.getOptions(), sv = String(v);
              if (v) f.select(opts.includes(sv) ? sv : (opts[parseInt(sv, 10)] != null ? opts[parseInt(sv, 10)] : sv)); else f.clear();
            }
            else if (f instanceof F.PDFDropdown || f instanceof F.PDFOptionList) { if (v) f.select(String(v)); else f.clear(); }
          } catch (e) { bad.push(name); }
        }
        if (bad.length) throw new Error('campo «' + bad[0] + '» non compilabile (caratteri non supportati?)');
      }
      for (let i = 0; i < n; i++) {
        if (!ann[i].length || !ps[i]) continue;
        const vp = pageObjs[i].getViewport({ scale: 1 });
        for (const st of ann[i]) {
          if (st.tool === 'txt') {
            const c = hexRgb(st.color);
            const qs = st.quads.map((qd) => qd.map(([x, y]) => vp.convertToPdfPoint(x, y)));
            ps[i].drawSvgPath(quadsPath(qs, (y) => -y), { x: 0, y: 0, color: rgb(c[0], c[1], c[2]), opacity: st.op, borderWidth: 0 });
            continue;
          }
          const pts = st.pts.map(([x, y]) => vp.convertToPdfPoint(x, y));
          const c = hexRgb(st.color);
          ps[i].drawSvgPath(pathOf(pts, (y) => -y), { x: 0, y: 0, borderColor: rgb(c[0], c[1], c[2]), borderWidth: st.w, borderOpacity: st.op, borderLineCap: LineCapStyle.Round });
        }
      }
      // riquadri che coprono le righe corrette: prima di tutti i testi, così non nascondono mai un testo nuovo
      for (const o of objs) {
        if (!o.cover || !ps[o.page]) continue;
        const vp = pageObjs[o.page].getViewport({ scale: 1 }), { x, y, w, h: hh } = o.cover.rect, c = hexRgb(o.cover.color);
        const qs = [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]].map(([px, py]) => vp.convertToPdfPoint(px, py));
        ps[o.page].drawSvgPath(quadsPath([qs], (yy) => -yy), { x: 0, y: 0, color: rgb(c[0], c[1], c[2]), opacity: 1, borderWidth: 0 });
      }
      // firme (tratti scalati nel rettangolo scelto) e testi (font Liberation Sans incorporato, accenti compresi)
      const fonts = {};
      const fontFor = async (bold) => {
        const k = bold ? 'b' : 'r';
        if (fonts[k]) return fonts[k];
        doc.registerFontkit(window.fontkit);
        const r = await fetch('vendor/pdfjs/standard_fonts/LiberationSans-' + (bold ? 'Bold' : 'Regular') + '.ttf');
        if (!r.ok) throw new Error('font non trovato');
        const f = await doc.embedFont(await r.arrayBuffer(), { subset: true });
        fonts[k] = { f, set: new Set(f.getCharacterSet()) };
        return fonts[k];
      };
      for (const o of objs) {
        const pg = ps[o.page];
        if (!pg) continue;
        const vp = pageObjs[o.page].getViewport({ scale: 1 });
        if (o.kind === 'sig') {
          const sc = o.w / o.ar, c = hexRgb(o.color);
          for (const stk of o.strokes) {
            const pts = stk.map(([x, y]) => vp.convertToPdfPoint(o.x + x * sc, o.y + y * sc));
            pg.drawSvgPath(pathOf(pts, (y) => -y), { x: 0, y: 0, borderColor: rgb(c[0], c[1], c[2]), borderWidth: Math.max(0.6, o.w * SIG_STROKE), borderLineCap: LineCapStyle.Round });
          }
        } else {
          const { f, set } = await fontFor(o.bold);
          const c = hexRgb(o.color), bl = textBaselines(o);
          textLines(o.text).forEach((line, k) => {
            let ln = '';
            for (const ch of line) ln += set.has(ch.codePointAt(0)) ? ch : '?';
            if (!ln.trim()) return;
            const [px, py] = vp.convertToPdfPoint(o.x, bl[k]);
            pg.drawText(ln, { x: px, y: py, size: o.size, font: f, color: rgb(c[0], c[1], c[2]), rotate: degrees(vp.rotation || 0) });
          });
        }
      }
      // campi del modulo: aspetto ridisegnato con il font incorporato (accenti e lettere europee), non con l'Helvetica base
      if (formCh.size) doc.getForm().updateFieldAppearances((await fontFor(false)).f);
      const out = await doc.save({ updateFieldAppearances: false });
      d.data = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      await A.save(d);
    }
    async function saveInk() {
      if (I.saving || !hasChanges()) return;
      I.saving = true; paintBar();
      try {
        await bake();
        hist.length = 0; ann.forEach((x) => { x.length = 0; });
        objs.length = 0; selId = null;
        A.toast('Annotazioni salvate nel PDF');
        await A.back();       // chiude questo lettore (la posizione viene ricordata)…
        openPdf(d, A).catch((e) => A.toast('Impossibile riaprire: ' + (e.message || e), 4500)); // …e lo riapre sul file aggiornato
      } catch (e) {
        console.error(e);
        A.toast('Impossibile salvare le annotazioni: ' + (e.message || e), 5000);
        I.saving = false; paintBar();
      }
    }
    scr.actions.insertBefore(btn(SV.pen, () => toggleInk(), 'Annota', { 'data-pdf-annot': '1' }), scr.actions.lastChild);

    /* ---------- firma e testo nuovo ---------- */
    const SIG_STROKE = 0.014;                 // spessore della firma in rapporto alla sua larghezza
    const objs = [];                          // oggetti ancora da scrivere nel PDF
    let selId = null, oid = 0, sigSaved = null;
    try { sigSaved = await N.db.getMeta('signature'); } catch (e) { sigSaved = null; }
    if (dead) return;
    if (!sigSaved || !sigSaved.strokes || !sigSaved.ar) sigSaved = null;

    const svgOf = (sig, color, sw) => {
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + sig.ar + ' 1');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('class', 'pdf-sigsvg');
      for (const stk of sig.strokes) {
        const e = pathEl({ pts: stk, color, w: sw, op: 1, prec: 1e4 });
        e.setAttribute('vector-effect', 'none');
        svg.append(e);
      }
      return svg;
    };
    const objById = (id) => objs.find((o) => o.id === id);

    // posizione e misure dell'oggetto sulla pagina (in percentuale: seguono lo zoom da sole)
    function placeObj(o) {
      const el = o.el, b = base[o.page];
      el.style.left = (o.x / b.w * 100) + '%';
      el.style.top = (o.y / b.h * 100) + '%';
      if (o.kind === 'sig') {
        el.style.width = (o.w / b.w * 100) + '%';
        el.style.aspectRatio = String(o.ar);
      } else {
        el.style.fontSize = 'calc(var(--cs) * ' + o.size + 'px)';
      }
    }
    function fillObj(o) {
      const el = o.el;
      el.dataset.obj = o.kind;
      const keep = el.querySelector('.pdf-octl');
      if (o.kind === 'sig') {
        el.replaceChildren(svgOf(o, o.color, 0.014 * o.ar));
      } else {
        el.style.color = o.color;
        el.style.fontWeight = o.bold ? '700' : '400';
        el.replaceChildren(h('span', { class: 'pdf-otext' }, o.text));
      }
      if (keep) el.append(keep);
      placeObj(o);
    }
    function bindObj(o) {
      const el = o.el;
      el.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.pdf-octl button')) return;
        e.stopPropagation();
        select(o.id);
        const p = pages[o.page];
        const st = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, moved: false };
        const rz = e.target.closest('.pdf-orz');
        if (rz) { st.rz = true; st.w0 = o.w; st.s0 = o.size; st.pw0 = el.offsetWidth; }
        try { el.setPointerCapture(e.pointerId); } catch (x) { /* non fondamentale */ }
        const mv = (ev) => {
          if (ev.pointerId !== st.id) return;
          const dx = (ev.clientX - st.sx) / p.cs, dy = (ev.clientY - st.sy) / p.cs;
          if (Math.abs(dx) + Math.abs(dy) > 0.5) st.moved = true;
          const b = base[o.page];
          if (st.rz) {
            if (o.kind === 'sig') o.w = clamp(st.w0 + dx, 24, b.w - o.x);
            else o.size = clamp(Math.round(st.s0 * (1 + (dx * p.cs) / Math.max(20, st.pw0)) * 10) / 10, 6, 120);
          } else {
            const wBase = el.offsetWidth / p.cs, hBase = el.offsetHeight / p.cs;
            o.x = clamp(st.ox + dx, 0, Math.max(0, b.w - wBase));
            o.y = clamp(st.oy + dy, 0, Math.max(0, b.h - hBase));
          }
          placeObj(o);
        };
        const up = (ev) => {
          if (ev.pointerId !== st.id) return;
          el.removeEventListener('pointermove', mv);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
        e.preventDefault();
      });
    }
    function select(id) {
      selId = id;
      for (const o of objs) {
        const on = o.id === id;
        o.el.classList.toggle('sel', on);
        const old = o.el.querySelector('.pdf-octl');
        if (old) old.remove();
        if (on) {
          const ctl = h('div', { class: 'pdf-octl' },
            o.kind === 'text' ? h('button', { 'data-obj-edit': '1', 'aria-label': 'Modifica il testo', html: SV.edit, onclick: () => textSheet(o) }) : null,
            h('button', { 'data-obj-del': '1', 'aria-label': 'Elimina', html: SV.trash, onclick: () => removeObj(o) }),
            h('span', { class: 'pdf-orz', 'data-obj-resize': '1', 'aria-label': 'Ridimensiona' }));
          o.el.append(ctl);
        }
      }
    }
    function removeObj(o) {
      const k = objs.indexOf(o);
      if (k >= 0) objs.splice(k, 1);
      o.el.remove();
      if (o.cover && o.cover.el) o.cover.el.remove();
      if (selId === o.id) selId = null;
      paintBar();
    }
    // tocco su un punto qualsiasi della pagina che non sia un oggetto: deseleziona
    inner.addEventListener('pointerdown', (e) => { if (selId !== null && !(e.target.closest && e.target.closest('.pdf-obj'))) select(null); });

    // dove mettere un oggetto nuovo: al centro di quello che si vede, sulla pagina in vista
    function centerSpot() {
      const i = pageAt(tops, body.scrollTop + body.clientHeight / 2), p = pages[i];
      const cx = (body.scrollLeft + body.clientWidth / 2 - p.el.offsetLeft) / p.cs;
      const cy = (body.scrollTop + body.clientHeight / 2 - tops[i]) / p.cs;
      return { i, cx: clamp(cx, 0, base[i].w), cy: clamp(cy, 0, base[i].h) };
    }
    // riquadro che copre la riga corretta: sta fermo sul testo originale (in percentuale, segue lo zoom)
    function paintCover(o) {
      const c = o.cover, b = base[o.page];
      if (!c.el) { c.el = h('div', { class: 'pdf-cover', 'data-cover': '1' }); pages[o.page].ol.prepend(c.el); }
      c.el.style.left = (c.rect.x / b.w * 100) + '%';
      c.el.style.top = (c.rect.y / b.h * 100) + '%';
      c.el.style.width = (c.rect.w / b.w * 100) + '%';
      c.el.style.height = (c.rect.h / b.h * 100) + '%';
      c.el.style.background = c.color;
    }
    function addObj(o) {
      o.id = ++oid;
      const p = pages[o.page];
      o.el = h('div', { class: 'pdf-obj' });
      p.ol.append(o.el);
      objs.push(o);
      bindObj(o);
      fillObj(o);
      if (o.cover) paintCover(o);
      if (o.x == null) {
        // centra l'oggetto sul punto scelto (misurato davvero, per il testo)
        const b = base[o.page], wB = o.el.offsetWidth / p.cs, hB = o.el.offsetHeight / p.cs;
        o.x = clamp(o.cx - wB / 2, 0, Math.max(0, b.w - wB));
        o.y = clamp(o.cy - hB / 2, 0, Math.max(0, b.h - hB));
      }
      placeObj(o);
      select(o.id);
      paintBar();
    }

    /* firma */
    function placeSignature(sig) {
      const sp = centerSpot(), w = Math.min(base[sp.i].w * 0.4, 220);
      addObj({ kind: 'sig', page: sp.i, cx: sp.cx, cy: sp.cy, w, ar: sig.ar, strokes: sig.strokes, color: '#0b1f6b' });
      A.toast('Firma inserita: trascinala dove serve, poi premi «Salva»', 3200);
    }
    function signaturePad() {
      const W = 600, H = 220;
      const strokes = [];
      let curS = null;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('class', 'pdf-pad');
      svg.setAttribute('data-sig-pad', '1');
      const guide = document.createElementNS(NS, 'path');
      guide.setAttribute('d', 'M30 ' + (H - 50) + ' H' + (W - 30));
      guide.setAttribute('class', 'pdf-padline');
      svg.append(guide);
      const useBtn = h('button', { class: 'pdf-savebtn pdf-wide', 'data-sig-use': '1', disabled: true }, 'Usa questa firma');
      const clearBtn = h('button', { class: 'pdf-ghost', 'data-sig-clear': '1' }, 'Cancella');
      const upd = () => { useBtn.disabled = !strokes.length; };
      const pt = (e) => { const r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / Math.max(1, r.width) * W, (e.clientY - r.top) / Math.max(1, r.height) * H]; };
      svg.addEventListener('pointerdown', (e) => {
        const s = [pt(e)];
        const el = pathEl({ pts: s, color: '#0b1f6b', w: 3.2, op: 1 });
        svg.append(el);
        curS = { s, el, id: e.pointerId };
        try { svg.setPointerCapture(e.pointerId); } catch (x) { /* non fondamentale */ }
        e.preventDefault();
      });
      svg.addEventListener('pointermove', (e) => {
        if (!curS || e.pointerId !== curS.id) return;
        curS.s.push(pt(e));
        curS.el.setAttribute('d', pathOf(curS.s));
      });
      const end = (e) => {
        if (!curS || e.pointerId !== curS.id) return;
        const c = curS; curS = null;
        c.s = thinPoints(c.s, 1);
        strokes.push(c.s);
        c.el.setAttribute('d', pathOf(c.s));
        upd();
      };
      svg.addEventListener('pointerup', end);
      svg.addEventListener('pointercancel', end);
      clearBtn.addEventListener('click', () => { strokes.length = 0; svg.querySelectorAll('path:not(.pdf-padline)').forEach((x) => x.remove()); upd(); });
      useBtn.addEventListener('click', async () => {
        const sig = normSignature(strokes);
        if (!sig) return;
        sigSaved = sig;
        try { await N.db.setMeta('signature', sig); } catch (e) { /* la firma resta usabile in questa sessione */ }
        await A.back();
        placeSignature(sig);
      });
      A.openSheet('Disegna la tua firma', h('div', null,
        h('p', { class: 'pdf-hint' }, 'Firma con il dito nel riquadro. Resta salvata solo su questo telefono.'),
        svg, h('div', { class: 'pdf-padbtns' }, clearBtn, useBtn)));
    }
    function signatureMenu() {
      if (!sigSaved) return signaturePad();
      const prev = h('div', { class: 'pdf-sigprev', 'data-sig-prev': '1' }, svgOf(sigSaved, '#0b1f6b', 0.02 * sigSaved.ar));
      prev.style.aspectRatio = String(sigSaved.ar);
      A.openSheet('Firma', h('div', null, prev,
        h('button', { class: 'item', 'data-sig-place': '1', onclick: async () => { await A.back(); placeSignature(sigSaved); } }, h('span', { html: SV.sign }), 'Usa la firma salvata'),
        h('button', { class: 'item', 'data-sig-new': '1', onclick: async () => { await A.back(); signaturePad(); } }, h('span', { html: SV.pen }), 'Disegna una nuova firma'),
        h('button', { class: 'item danger', 'data-sig-del': '1', onclick: async () => { sigSaved = null; try { await N.db.setMeta('signature', null); } catch (e) { /* ignora */ } await A.back(); A.toast('Firma eliminata'); } }, h('span', { html: SV.trash }), 'Elimina la firma salvata')));
    }

    /* testo (nuovo, modificato, o riscritto al posto di una riga esistente) */
    function textSheet(existing, fix) {
      const cv = existing ? existing.cover : fix ? { auto: fix.bg, color: fix.bg } : null;
      const dr = existing ? { text: existing.text, size: existing.size, color: existing.color, bold: existing.bold }
        : fix ? { text: fix.draft.text, size: fix.draft.size, color: fix.fg || TEXT_COLORS[0], bold: false }
        : { text: '', size: 14, color: TEXT_COLORS[0], bold: false };
      const palette = TEXT_COLORS.includes(dr.color) ? TEXT_COLORS : [dr.color, ...TEXT_COLORS];
      const bgNow = { c: cv ? cv.color : null };
      const ta = h('textarea', { class: 'pdf-ta', rows: 3, placeholder: 'Scrivi qui il testo', 'data-txt-input': '1', 'aria-label': 'Testo da aggiungere' });
      ta.value = dr.text;
      const sizeLbl = h('span', { class: 'pdf-sizelbl', 'data-txt-size': '1' }, String(dr.size));
      const boldBtn = h('button', { class: 'pdf-tb pdf-hlbtn', 'data-txt-bold': '1', 'aria-label': 'Grassetto', style: { fontWeight: '800' } }, 'G');
      const cols = palette.map((c) => h('button', { class: 'pdf-col', 'data-txt-color': c, 'aria-label': 'Colore ' + c, style: { background: c } }));
      const bgOpts = cv ? [...new Set([cv.auto, '#ffffff'])] : [];
      const bgBtns = bgOpts.map((c) => h('button', { class: 'pdf-col', 'data-fix-bg': c, 'aria-label': 'Sfondo ' + c, style: { background: c } }));
      const done = h('button', { class: 'pdf-savebtn pdf-wide', 'data-txt-done': '1' }, existing ? 'Fatto' : fix ? 'Applica' : 'Aggiungi');
      const paint = () => {
        sizeLbl.textContent = String(dr.size);
        boldBtn.classList.toggle('on', dr.bold);
        cols.forEach((b) => b.classList.toggle('on', b.dataset.txtColor === dr.color));
        bgBtns.forEach((b) => b.classList.toggle('on', b.dataset.fixBg === bgNow.c));
        ta.style.fontWeight = dr.bold ? '700' : '400';
        ta.style.color = dr.color;
      };
      const setSize = (v) => { dr.size = clamp(Math.round(v), 6, 120); paint(); };
      boldBtn.addEventListener('click', () => { dr.bold = !dr.bold; paint(); });
      cols.forEach((b) => b.addEventListener('click', () => { dr.color = b.dataset.txtColor; paint(); }));
      bgBtns.forEach((b) => b.addEventListener('click', () => { bgNow.c = b.dataset.fixBg; paint(); }));
      done.addEventListener('click', async () => {
        dr.text = ta.value;
        if (!dr.text.trim()) { ta.focus(); return; }
        await A.back();
        if (existing) {
          Object.assign(existing, dr);
          if (existing.cover && bgNow.c) { existing.cover.color = bgNow.c; paintCover(existing); }
          fillObj(existing);
          select(existing.id);
        } else if (fix) {
          addObj({ kind: 'text', page: fix.page, x: fix.draft.x, y: fix.draft.y, text: dr.text, size: dr.size, color: dr.color, bold: dr.bold, cover: { rect: fix.draft.rect, color: bgNow.c, auto: fix.bg } });
          A.toast('Riga corretta: sposta il testo se serve, poi premi «Salva»', 3600);
        } else {
          const sp = centerSpot();
          addObj({ kind: 'text', page: sp.i, cx: sp.cx, cy: sp.cy, text: dr.text, size: dr.size, color: dr.color, bold: dr.bold });
        }
      });
      A.openSheet(existing ? 'Modifica il testo' : fix ? 'Correggi il testo' : 'Testo nuovo', h('div', null,
        fix ? h('p', { class: 'pdf-hint', 'data-fix-hint': '1' }, 'Il testo vecchio viene coperto, ma resta nel file sotto il riquadro: non è una cancellazione sicura.') : null,
        ta,
        h('div', { class: 'pdf-txtrow' },
          h('button', { class: 'pdf-tb pdf-hlbtn', 'data-txt-smaller': '1', 'aria-label': 'Più piccolo', onclick: () => setSize(dr.size - 2) }, 'A−'),
          sizeLbl,
          h('button', { class: 'pdf-tb pdf-hlbtn', 'data-txt-bigger': '1', 'aria-label': 'Più grande', onclick: () => setSize(dr.size + 2) }, 'A+'),
          boldBtn, ...cols),
        cv ? h('div', { class: 'pdf-txtrow' }, h('span', { class: 'pdf-hint', style: { margin: 0 } }, 'Sfondo che copre il testo vecchio'), ...bgBtns) : null,
        done));
      paint();
      setTimeout(() => { try { ta.focus(); } catch (e) { /* ignora */ } }, 60);
    }

    /* correzione del testo esistente: si tocca una riga, si riscrive */
    let fixOn = false, fixBusy = false, fixToast = 0;
    const fixBtn = h('button', { class: 'pdf-hlbtn', 'data-ins-fix': '1', 'aria-label': 'Correggi il testo esistente', onclick: () => toggleFix() }, 'Correggi');
    function toggleFix(force) {
      fixOn = force === undefined ? !fixOn : force;
      fixBtn.classList.toggle('on', fixOn);
      body.classList.toggle('fixing', fixOn);
      if (fixOn) A.toast('Tocca la riga di testo da correggere', 3000);
    }
    // colori di sfondo e di testo letti dalla pagina disegnata (se non è disponibile: bianco e nero)
    function pageColors(i, rect) {
      const c = pages[i].canvas, none = { bg: '#ffffff', fg: null };
      if (!c) return none;
      try {
        const f = c.width / base[i].w, m = 4;
        const sx = Math.max(0, Math.floor(rect.x * f) - m), sy = Math.max(0, Math.floor(rect.y * f) - m);
        const ex = Math.min(c.width, Math.ceil((rect.x + rect.w) * f) + m), ey = Math.min(c.height, Math.ceil((rect.y + rect.h) * f) + m);
        if (ex <= sx || ey <= sy) return none;
        const img = c.getContext('2d').getImageData(sx, sy, ex - sx, ey - sy);
        return sampleColors(img, { x: rect.x * f - sx, y: rect.y * f - sy, w: rect.w * f, h: rect.h * f });
      } catch (e) { return none; }
    }
    inner.addEventListener('click', async (e) => {
      if (!fixOn || fixBusy || !e.target.closest || e.target.closest('.pdf-obj')) return;
      const pg = e.target.closest('.pdf-page');
      const i = pg ? +pg.dataset.page - 1 : -1;
      if (!(i >= 0 && pages[i])) return;
      const r = pages[i].el.getBoundingClientRect();
      const x = (e.clientX - r.left) / Math.max(1, r.width) * base[i].w, y = (e.clientY - r.top) / Math.max(1, r.height) * base[i].h;
      const say = (m) => { if (Date.now() - fixToast > 2500) { fixToast = Date.now(); A.toast(m, 4200); } };
      fixBusy = true;
      try {
        const bx = await boxesOf(i);
        if (dead || !fixOn) return;
        const ln = lineAt(bx, x, y);
        if (!ln || !ln.text) { say(bx.length ? 'Qui non c’è testo: tocca più vicino a una riga' : 'Questa pagina non ha testo da correggere (forse è una scansione)'); return; }
        if (!isUpright(ln)) { say('Questa riga è inclinata o verticale: si correggono solo righe orizzontali'); return; }
        const draft = fixDraft(ln), col = pageColors(i, draft.rect);
        toggleFix(false);
        textSheet(null, { page: i, draft, bg: col.bg, fg: col.fg });
      } catch (err) {
        console.error(err);
        A.toast('Impossibile leggere il testo di questa pagina', 3500);
      } finally { fixBusy = false; }
    });

    // barra «Inserisci»
    const insSave = h('button', { class: 'pdf-savebtn', 'data-ins-save': '1', onclick: () => saveInk() }, 'Salva');
    const insBar = h('div', { class: 'pdf-tools pdf-ins' },
      h('button', { class: 'pdf-hlbtn', 'data-ins-sig': '1', 'aria-label': 'Firma', onclick: () => signatureMenu() }, 'Firma'),
      h('button', { class: 'pdf-hlbtn', 'data-ins-text': '1', 'aria-label': 'Aggiungi testo', onclick: () => textSheet(null) }, 'Testo'),
      fixBtn,
      insSave,
      h('button', { class: 'ibtn pdf-tb', 'data-ins-close': '1', 'aria-label': 'Chiudi', html: SV.x, onclick: () => toggleIns(false) }));
    scr.el.insertBefore(insBar, body);
    function toggleIns(force) {
      const on = force === undefined ? !insBar.classList.contains('on') : force;
      insBar.classList.toggle('on', on);
      if (on) { toggleSearch(false); toggleForm(false); if (I.on) toggleInk(false); }
      else { if (selId !== null) select(null); toggleFix(false); }
      paintBar();
    }
    scr.actions.insertBefore(btn(SV.ins, () => toggleIns(), 'Firma e testo', { 'data-pdf-insert': '1' }), scr.actions.lastChild);
    paintBar();

    /* ---------- moduli (campi da compilare) ---------- */
    const fields = [];                        // per pagina: campi compilabili trovati da pdf.js
    const formInit = new Map(), radios = new Map();
    let formBuilt = false, formCount = 0;
    const isFillable = (a) => a && a.subtype === 'Widget' && a.fieldName && !a.readOnly && (a.fieldType === 'Tx' || a.fieldType === 'Ch' || (a.fieldType === 'Btn' && !a.pushButton));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    function setField(name, v) { if (same(v, formInit.get(name))) formCh.delete(name); else formCh.set(name, v); paintBar(); }
    function mkField(i, a) {
      const vp = pageObjs[i].getViewport({ scale: 1 }), b = base[i];
      const r = vp.convertToViewportRectangle(a.rect);
      const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), hh = Math.abs(r[3] - r[1]);
      const place = (el) => { el.style.left = (x / b.w * 100) + '%'; el.style.top = (y / b.h * 100) + '%'; el.style.width = (w / b.w * 100) + '%'; el.style.height = (hh / b.h * 100) + '%'; return el; };
      const name = a.fieldName, fv = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
      if (a.fieldType === 'Tx') {
        const multi = !!a.multiLine;
        const el = h(multi ? 'textarea' : 'input', { class: 'pdf-fld', 'data-fld': name, 'aria-label': name });
        if (!multi) el.type = 'text';
        el.value = fv == null ? '' : String(fv);
        if (a.maxLen) el.maxLength = a.maxLen;
        el.style.fontSize = 'calc(var(--cs) * ' + (multi ? 12 : Math.max(6, Math.min(16, hh * 0.62))) + 'px)';
        if (!formInit.has(name)) formInit.set(name, el.value);
        el.addEventListener('input', () => setField(name, el.value));
        return place(el);
      }
      if (a.fieldType === 'Ch') {
        const el = h('select', { class: 'pdf-fld', 'data-fld': name, 'aria-label': name });
        const opts = (a.options || []).map((o) => ({ ex: String(o.exportValue), dv: String(o.displayValue != null ? o.displayValue : o.exportValue) }));
        el.append(h('option', { value: '' }, ''));
        for (const o of opts) el.append(h('option', { value: o.dv }, o.dv));
        const cur = opts.find((o) => o.ex === String(fv) || o.dv === String(fv));
        el.value = cur ? cur.dv : '';
        el.style.fontSize = 'calc(var(--cs) * ' + Math.max(6, Math.min(16, hh * 0.62)) + 'px)';
        if (!formInit.has(name)) formInit.set(name, el.value);
        el.addEventListener('change', () => setField(name, el.value));
        return place(el);
      }
      if (a.radioButton) {
        const val = String(a.buttonValue);
        const el = h('button', { class: 'pdf-fchk rad', 'data-fld': name, 'data-val': val, 'aria-label': name + ': ' + val, 'aria-pressed': 'false' });
        if (!radios.has(name)) radios.set(name, []);
        radios.get(name).push({ el, val });
        if (!formInit.has(name)) formInit.set(name, fv && fv !== 'Off' ? String(fv) : '');
        const paintR = (cur) => radios.get(name).forEach((q) => { q.el.classList.toggle('on', q.val === cur); q.el.setAttribute('aria-pressed', q.val === cur ? 'true' : 'false'); });
        el.addEventListener('click', () => { const cur = formCh.has(name) ? formCh.get(name) : formInit.get(name); const nv = cur === val ? '' : val; paintR(nv); setField(name, nv); });
        place(el);
        return el;
      }
      const el = h('button', { class: 'pdf-fchk', 'data-fld': name, 'aria-label': name, 'aria-pressed': 'false' });
      const on0 = !!fv && fv !== 'Off';
      if (!formInit.has(name)) formInit.set(name, on0);
      el.classList.toggle('on', on0); el.setAttribute('aria-pressed', on0 ? 'true' : 'false');
      el.addEventListener('click', () => { const nv = !el.classList.contains('on'); el.classList.toggle('on', nv); el.setAttribute('aria-pressed', nv ? 'true' : 'false'); setField(name, nv); });
      return place(el);
    }
    function buildForm() {
      if (formBuilt) return;
      formBuilt = true;
      // i pulsanti di scelta (radio) vanno dipinti dopo che tutto il gruppo esiste
      fields.forEach((list, i) => { if (list) for (const a of list) pages[i].fl.append(mkField(i, a)); });
      for (const [name, rs] of radios) { const cur = formInit.get(name); rs.forEach((q) => { q.el.classList.toggle('on', q.val === cur); q.el.setAttribute('aria-pressed', q.val === cur ? 'true' : 'false'); }); }
    }
    const fSaveBtn = h('button', { class: 'pdf-savebtn', 'data-form-save': '1', onclick: () => saveInk() });
    fSaveBtn.textContent = 'Salva';
    fSave = fSaveBtn;
    const fBar = h('div', { class: 'pdf-tools pdf-ins' },
      h('span', { class: 'pdf-hint pdf-fhint', 'data-form-hint': '1' }, 'Tocca i campi per compilarli'),
      fSaveBtn,
      h('button', { class: 'ibtn pdf-tb', 'data-form-close': '1', 'aria-label': 'Chiudi', html: SV.x, onclick: () => toggleForm(false) }));
    scr.el.insertBefore(fBar, body);
    function toggleForm(force) {
      const on = force === undefined ? !fBar.classList.contains('on') : force;
      if (on && !formCount) return;
      fBar.classList.toggle('on', on);
      body.classList.toggle('forming', on);
      if (on) { buildForm(); toggleSearch(false); if (I.on) toggleInk(false); toggleIns(false); }
      paintBar();
    }
    const formBtn = btn(SV.form, () => toggleForm(), 'Compila il modulo', { 'data-pdf-form': '1', hidden: true });
    scr.actions.insertBefore(formBtn, scr.actions.lastChild);
    async function scanForms() {
      for (let i = 0; i < n && !dead; i++) {
        try {
          const an = await pageObjs[i].getAnnotations({ intent: 'display' });
          const list = an.filter(isFillable);
          if (list.length) { fields[i] = list; formCount += list.length; }
        } catch (e) { /* pagina senza annotazioni leggibili */ }
        if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0));
      }
      if (!dead && formCount) { formBtn.hidden = false; formBtn.removeAttribute('hidden'); }
    }

    /* ---------- ricorda dove eri arrivato ---------- */
    let saveT = 0, lastPos = null;
    // Quando la schermata si chiude è già staccata dalla pagina (scrollTop = 0): in quel caso vale l'ultima posizione letta.
    function calcPos() {
      if (!tops.length || !body.isConnected) return null;
      const i = pageAt(tops, body.scrollTop + body.clientHeight * 0.4);
      const frac = Math.max(0, Math.min(1, (body.scrollTop - tops[i]) / Math.max(1, heights[i])));
      return { page: i, frac, zoom };
    }
    function savePosNow() {
      lastPos = calcPos() || (lastPos && Object.assign({}, lastPos, { zoom }));
      if (!lastPos) return;
      return N.db.setMeta('pdfpos:' + d.id, lastPos).catch(() => {});
    }
    function savePosSoon() { clearTimeout(saveT); saveT = setTimeout(savePosNow, 700); }

    function cleanup() {
      if (dead) return;
      try { savePosNow(); } catch (e) { /* ignora */ }
      if (hasChanges() && !I.saving) { // uscita senza aver premuto «Salva»: le annotazioni non si perdono
        I.saving = true;
        bake().then(() => A.toast('Annotazioni salvate nel PDF')).catch((e) => { console.error(e); A.toast('Annotazioni NON salvate: ' + (e.message || e), 5000); });
      }
      dead = true;
      clearTimeout(saveT); clearTimeout(sTimer); clearTimeout(onResize.t);
      window.removeEventListener('resize', onResize);
      for (let i = 0; i < n; i++) if (pages[i] && (pages[i].task || pages[i].canvas)) release(i);
      S.texts.clear();
      try { pdf.destroy(); } catch (e) { /* già chiuso */ }
    }

    /* ---------- avvio ---------- */
    let saved = null;
    try { saved = await N.db.getMeta('pdfpos:' + d.id); } catch (e) { saved = null; }
    if (dead) return;
    if (saved && saved.zoom) zoom = clampZoom(saved.zoom);
    layout();
    if (saved && saved.page > 0) body.scrollTop = tops[Math.min(n - 1, saved.page)] + (saved.frac || 0) * heights[Math.min(n - 1, saved.page)];
    refresh();
    scanForms();
    return { goPage, setZoom, search: doSearch };
  }

  /* =====================================================================
     3) COLLEGAMENTO ALLA SEZIONE DOCUMENTI
     ===================================================================== */

  if (N.docs && N.docs.register) {
    N.docs.register('pdf', { open: (d, A) => openPdf(d, A) });
  }

  N.pdfView = { _logic: { buildBoxes, locate, selectQuads, quadsPath, fold, normQuery, buildPage, plainText, findAll, partsFor, pageAt, visibleRange, clampZoom, thinPoints, pathOf, hexRgb, INK_TOOLS, INK_COLORS, normSignature, textLines, textBaselines, clamp, TEXT_LINE, TEXT_BASE, TEXT_COLORS, nearBox, lineAt, isUpright, coverRect, fixDraft, sampleColors, toHex } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.pdfView;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
