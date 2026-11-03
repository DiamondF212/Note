// Test della logica pura del lettore PDF. Esecuzione: node tests/pdf.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../pdf_view.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('fold: ignora maiuscole e accenti', () => {
  assert.strictEqual(L.fold('PERCHÉ è già Così'), 'perche e gia cosi');
  assert.strictEqual(L.fold('Città'), 'citta');
});
t('fold: non cambia mai la lunghezza del testo', () => {
  for (const s of ['Àèìòù ÇÑ', 'ﬁne', 'İstanbul', 'ß', 'Ǆ', 'é']) assert.strictEqual(L.fold(s).length, s.length, s);
});
t('fold: lo spazio unificato (non separabile) diventa uno spazio', () => assert.strictEqual(L.fold('a b'), 'a b'));
t('normQuery: comprime gli spazi e toglie quelli ai bordi', () => assert.strictEqual(L.normQuery('  Perché   NO  '), 'perche no'));
t('normQuery: stringa vuota resta vuota', () => assert.strictEqual(L.normQuery('   '), ''));

const items = [
  { str: 'Ciao ', transform: [1, 0, 0, 1, 0, 0], width: 20 },
  { str: 'mondo', hasEOL: true, transform: [1, 0, 0, 1, 20, 0], width: 25 },
  { str: 'Seconda riga', transform: [1, 0, 0, 1, 0, 12], width: 60 },
  { notAString: 1 }, null
];
t('buildPage: unisce le voci e tiene le posizioni', () => {
  const p = L.buildPage(items);
  assert.strictEqual(p.raw, 'Ciao mondo Seconda riga');
  assert.strictEqual(p.str, 'ciao mondo seconda riga');
  assert.strictEqual(p.ranges.length, 3);
  assert.deepStrictEqual([p.ranges[1].from, p.ranges[1].to], [5, 10]);
});
t('buildPage: input vuoto o nullo non rompe', () => { assert.strictEqual(L.buildPage([]).raw, ''); assert.strictEqual(L.buildPage(null).raw, ''); });
t('plainText: una riga per ogni «a capo»', () => assert.strictEqual(L.plainText(items), 'Ciao mondo\nSeconda riga'));
t('plainText: toglie righe vuote in eccesso', () => assert.strictEqual(L.plainText([{ str: 'a', hasEOL: true }, { str: '', hasEOL: true }, { str: '', hasEOL: true }, { str: 'b' }]), 'a\n\nb'));
t('findAll: trova tutte le occorrenze senza sovrapporle', () => {
  assert.deepStrictEqual(L.findAll('aaaa', 'aa'), [[0, 2], [2, 4]]);
  assert.deepStrictEqual(L.findAll('abcabc', 'bc'), [[1, 3], [4, 6]]);
});
t('findAll: ago vuoto = nessun risultato; max rispettato', () => {
  assert.deepStrictEqual(L.findAll('abc', ''), []);
  assert.strictEqual(L.findAll('aaaaaa', 'a', 3).length, 3);
});
t('partsFor: un risultato a cavallo di due voci dà due parti con le frazioni giuste', () => {
  const p = L.buildPage(items);
  const parts = L.partsFor(p.ranges, 3, 8); // «o mon»
  assert.strictEqual(parts.length, 2);
  assert.deepStrictEqual([parts[0].from, parts[0].to], [3, 5]);
  assert.deepStrictEqual([parts[1].from, parts[1].to], [0, 3]);
});
t('partsFor: risultato dentro una sola voce', () => {
  const p = L.buildPage(items);
  const parts = L.partsFor(p.ranges, 6, 9);
  assert.strictEqual(parts.length, 1);
  assert.deepStrictEqual([parts[0].from, parts[0].to], [1, 4]);
});
t('ricerca completa: accenti e maiuscole ignorati, posizioni giuste', () => {
  const p = L.buildPage([{ str: 'Perché il CAFFÈ è caldo' }]);
  const r = L.findAll(p.str, L.normQuery('caffe'));
  assert.strictEqual(r.length, 1);
  assert.strictEqual(p.raw.slice(r[0][0], r[0][1]), 'CAFFÈ');
  assert.strictEqual(L.findAll(p.str, L.normQuery('PERCHE')).length, 1);
});

const tops = [0, 110, 220, 330, 440], heights = [100, 100, 100, 100, 100];
t('pageAt: trova la pagina che contiene y', () => {
  assert.strictEqual(L.pageAt(tops, 0), 0);
  assert.strictEqual(L.pageAt(tops, 109), 0);
  assert.strictEqual(L.pageAt(tops, 110), 1);
  assert.strictEqual(L.pageAt(tops, 9999), 4);
  assert.strictEqual(L.pageAt(tops, -50), 0);
  assert.strictEqual(L.pageAt([], 10), 0);
});
t('visibleRange: pagine che toccano l’intervallo', () => {
  assert.deepStrictEqual(L.visibleRange(tops, heights, 0, 50), [0, 0]);
  assert.deepStrictEqual(L.visibleRange(tops, heights, 90, 230), [0, 2]);
  assert.deepStrictEqual(L.visibleRange(tops, heights, 105, 125), [1, 1]); // y0 nello spazio tra pagina 0 e 1
  assert.deepStrictEqual(L.visibleRange(tops, heights, -500, 9999), [0, 4]);
  assert.deepStrictEqual(L.visibleRange([], [], 0, 10), [0, -1]);
});
t('clampZoom: limiti 0,5–5 e arrotondamento a 2 decimali', () => {
  assert.strictEqual(L.clampZoom(0.1), 0.5);
  assert.strictEqual(L.clampZoom(99), 5);
  assert.strictEqual(L.clampZoom(1.2345), 1.23);
  assert.strictEqual(L.clampZoom(1), 1);
});
t('thinPoints: toglie i punti troppo vicini, tiene primo e punti lontani', () => {
  assert.deepStrictEqual(L.thinPoints([[0, 0], [0.1, 0], [0.2, 0], [5, 0], [5.1, 0], [10, 0]], 1), [[0, 0], [5, 0], [10, 0]]);
  assert.deepStrictEqual(L.thinPoints([], 1), []);
});
t('pathOf: percorso SVG; un solo punto diventa un puntino; y trasformabile', () => {
  assert.strictEqual(L.pathOf([[1, 2], [3, 4.567]]), 'M1 2 L3 4.57');
  assert.strictEqual(L.pathOf([[5, 6]]), 'M5 6 L5.01 6');
  assert.strictEqual(L.pathOf([[1, 2], [3, 4]], (y) => -y), 'M1 -2 L3 -4');
  assert.strictEqual(L.pathOf([]), '');
});
t('hexRgb: colori esadecimali in frazioni 0–1; valori strani = nero', () => {
  assert.deepStrictEqual(L.hexRgb('#ff0000'), [1, 0, 0]);
  assert.deepStrictEqual(L.hexRgb('00ff00'), [0, 1, 0]);
  assert.deepStrictEqual(L.hexRgb('rosso'), [0, 0, 0]);
});
t('strumenti: l’evidenziatore è largo e trasparente, la penna sottile e piena', () => {
  assert.ok(L.INK_TOOLS.hl.w > L.INK_TOOLS.pen.w * 3);
  assert.ok(L.INK_TOOLS.hl.op < 1 && L.INK_TOOLS.pen.op === 1);
  assert.ok(L.INK_COLORS.length >= 5);
});

t('normSignature: altezza = 1, larghezza = rapporto; vuoto = null', () => {
  assert.strictEqual(L.normSignature([]), null);
  assert.strictEqual(L.normSignature([[]]), null);
  const s = L.normSignature([[[10, 20], [110, 20], [60, 70]]]);
  assert.strictEqual(s.ar, 2);
  assert.deepStrictEqual(s.strokes[0][0], [0, 0]);
  assert.deepStrictEqual(s.strokes[0][1], [2, 0]);
  assert.deepStrictEqual(s.strokes[0][2], [1, 1]);
});
t('normSignature: un solo puntino non fa dividere per zero', () => {
  const s = L.normSignature([[[5, 5]]]);
  assert.ok(isFinite(s.ar) && s.ar > 0);
});
t('textBaselines: una linea di base per ogni riga, distanti 1,2 volte il corpo', () => {
  const b = L.textBaselines({ y: 100, size: 10, text: 'a\nb\nc' });
  assert.strictEqual(b.length, 3);
  assert.ok(Math.abs(b[0] - (100 + 9.465)) < 1e-9);
  assert.ok(Math.abs(b[1] - b[0] - 12) < 1e-9);
});
t('textLines: gestisce a capo di Windows e testo vuoto', () => {
  assert.deepStrictEqual(L.textLines('a\r\nb'), ['a', 'b']);
  assert.deepStrictEqual(L.textLines(''), ['']);
  assert.deepStrictEqual(L.textLines(null), ['']);
});
t('clamp: tiene un numero tra due limiti', () => {
  assert.strictEqual(L.clamp(5, 0, 3), 3); assert.strictEqual(L.clamp(-1, 0, 3), 0); assert.strictEqual(L.clamp(2, 0, 3), 2);
});
t('pathOf: precisione scelta (le firme normalizzate hanno bisogno di più decimali)', () => {
  assert.strictEqual(L.pathOf([[0.12345, 0.5]], null, 1e4).split(' ')[0], 'M0.1235');
  assert.strictEqual(L.pathOf([[0.12345, 0.5]]).split(' ')[0], 'M0.12');
});
// ---- evidenziazione che segue il testo ----
// Due righe di corpo 10 su una pagina "a schermo": la matrice ha già l'asse y capovolto (come in pdf.js).
const mk = (str, x, y, w) => ({ str, width: w, transform: [10, 0, 0, -10, x, y] });
const hlItems = [mk('Alfa beta gamma', 10, 50, 90), mk('Delta epsilon', 10, 80, 78), mk('', 0, 0, 0), mk('Zeta', 10, 110, 24)];
const boxes = L.buildBoxes(hlItems, (it) => it.transform);
t('buildBoxes: salta le voci vuote e senza larghezza', () => assert.strictEqual(boxes.length, 3));
t('locate: un punto dentro la voce dà la posizione del carattere', () => {
  const p = L.locate(boxes, 55, 47);          // a metà della prima riga
  assert.strictEqual(p.bi, 0); assert.strictEqual(p.off, 8);
});
t('locate: un punto sotto la riga 2 sceglie la riga 2, non la 3', () => assert.strictEqual(L.locate(boxes, 20, 86).bi, 1));
t('locate: fuori dalla pagina si aggancia comunque alla voce più vicina', () => {
  assert.strictEqual(L.locate(boxes, -50, 49).off, 0);
  assert.strictEqual(L.locate(boxes, 999, 49).off, 15);
});
t('selectQuads: dentro una riga si allarga alla parola intera', () => {
  const q = L.selectQuads(boxes, [40, 47], [60, 47]);   // dentro «beta» fino a metà di «beta»/«gamma»
  assert.strictEqual(q.length, 1);
  const xs = q[0].map((p) => p[0]);
  assert.ok(Math.min(...xs) >= 10 + 90 * 5 / 15 - 0.01 && Math.min(...xs) <= 40, 'inizio sulla parola «beta»');
  assert.ok(Math.max(...xs) >= 60, 'fine oltre il punto di rilascio');
});
t('selectQuads: la fascia sta intorno alla linea di base (sale ~0,92 e scende ~0,22 del corpo)', () => {
  const q = L.selectQuads(boxes, [12, 47], [90, 47])[0], ys = q.map((p) => p[1]);
  assert.ok(Math.abs(Math.min(...ys) - (50 - 9.2)) < 0.05); assert.ok(Math.abs(Math.max(...ys) - (50 + 2.2)) < 0.05);
});
t('selectQuads: da una riga a un’altra colora la coda della prima e l’inizio della seconda', () => {
  const q = L.selectQuads(boxes, [60, 47], [30, 77]);
  assert.strictEqual(q.length, 2);
});
t('selectQuads: l’ordine dei due punti non conta', () => {
  assert.deepStrictEqual(L.selectQuads(boxes, [60, 47], [30, 77]), L.selectQuads(boxes, [30, 77], [60, 47]));
});
t('selectQuads: tre righe → tre fasce; la riga di mezzo è intera', () => {
  const q = L.selectQuads(boxes, [12, 47], [20, 107]);
  assert.strictEqual(q.length, 3);
  const w = (qd) => Math.max(...qd.map((p) => p[0])) - Math.min(...qd.map((p) => p[0]));
  assert.ok(Math.abs(w(q[1]) - 78) < 0.05);
});
t('selectQuads: senza testo non produce nulla', () => assert.deepStrictEqual(L.selectQuads([], [0, 0], [5, 5]), []));
t('selectQuads: testo ruotato di 90° (colonna verticale) resta lungo la scrittura', () => {
  const rot = [{ str: 'Verticale', width: 45, transform: [0, -10, 10, 0, 100, 200] }];   // scrive verso l'alto
  const q = L.selectQuads(L.buildBoxes(rot, (it) => it.transform), [100, 190], [100, 170]);
  assert.strictEqual(q.length, 1);
  const ys = q[0].map((p) => p[1]), xs = q[0].map((p) => p[0]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 4, 'estesa in verticale');
  assert.ok(Math.max(...xs) - Math.min(...xs) < 15, 'stretta in orizzontale');
});
t('quadsPath: un tracciato chiuso per ogni rettangolo', () => {
  const p = L.quadsPath([[[0, 0], [1, 0], [1, 1], [0, 1]], [[2, 2], [3, 2], [3, 3], [2, 3]]]);
  assert.strictEqual((p.match(/Z/g) || []).length, 2); assert.ok(p.startsWith('M0 0 L1 0'));
});

// ---- correzione del testo (copri e riscrivi) ----
// trasformazione "schermo": [corpo, 0, 0, -corpo, x, y] (y verso il basso, come dopo la vista di pdf.js)
const fx = (str, x, y, width, fs) => ({ str, width, transform: [fs || 10, 0, 0, -(fs || 10), x, y] });
const fixBoxes = L.buildBoxes([
  fx('Totale', 50, 100, 30), fx('da pagare:', 84, 100, 45), fx('120,00', 133, 100, 28),     // una riga in tre voci
  fx('Colonna lontana', 300, 100, 70),                                                        // stessa linea ma troppo distante
  fx('Seconda riga', 50, 118, 55)
], (it) => it.transform);
t('lineAt: unisce le voci della stessa riga e lascia fuori quelle lontane', () => {
  const ln = L.lineAt(fixBoxes, 90, 97);
  assert.strictEqual(ln.text, 'Totale da pagare: 120,00');
  assert.strictEqual(ln.n, 3);
  assert.strictEqual(ln.ox, 50); assert.strictEqual(ln.oy, 100); assert.strictEqual(ln.w, 111);
});
t('lineAt: toccando la riga sotto prende quella, non la vicina', () => {
  assert.strictEqual(L.lineAt(fixBoxes, 70, 116).text, 'Seconda riga');
});
t('lineAt: lontano da ogni testo → null; nessun testo → null', () => {
  assert.strictEqual(L.lineAt(fixBoxes, 200, 300), null);
  assert.strictEqual(L.lineAt([], 10, 10), null);
});
t('lineAt: due voci identiche sovrapposte (finto grassetto) contano una volta', () => {
  const bx = L.buildBoxes([fx('Titolo', 20, 50, 40, 12), fx('Titolo', 20.2, 50, 40, 12)], (it) => it.transform);
  assert.strictEqual(L.lineAt(bx, 30, 48).text, 'Titolo');
});
t('lineAt: spazio tra voci inserito solo se c’è distanza e non c’è già', () => {
  const bx = L.buildBoxes([fx('ab', 10, 20, 10), fx('cd', 22, 20, 10), fx('ef ', 32, 20, 10), fx('gh', 46, 20, 10)], (it) => it.transform);
  assert.strictEqual(L.lineAt(bx, 15, 18).text, 'ab cdef gh');
});
t('isUpright: orizzontale sì; ruotata o verticale no', () => {
  assert.ok(L.isUpright(L.lineAt(fixBoxes, 90, 97)));
  const rot = L.buildBoxes([{ str: 'Verticale', width: 40, transform: [0, 10, -10, 0, 100, 200] }], (it) => it.transform);
  assert.ok(!L.isUpright(L.lineAt(rot, 95, 190)));
  assert.ok(!L.isUpright(null));
});
t('coverRect e fixDraft: il riquadro copre la riga; il testo nuovo parte dallo stesso punto e corpo', () => {
  const ln = L.lineAt(fixBoxes, 90, 97), r = L.coverRect(ln), d = L.fixDraft(ln);
  assert.ok(r.x < 50 && r.x + r.w > 161, 'copre in larghezza');
  assert.ok(r.y <= 100 - 0.85 * 10 + 0.01 && r.y + r.h >= 100 + 0.22 * 10 - 0.01, 'copre in altezza');
  assert.strictEqual(d.size, 10); assert.strictEqual(d.x, 50);
  assert.ok(Math.abs(d.y + d.size * L.TEXT_BASE - 100) < 0.01, 'la linea di base coincide');
  assert.strictEqual(d.text, 'Totale da pagare: 120,00');
});
const mkImg = (w, h, bg, fgBox, fg) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inF = fgBox && x >= fgBox[0] && x < fgBox[2] && y >= fgBox[1] && y < fgBox[3], c = inF ? fg : bg, k = (y * w + x) * 4;
    data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
  }
  return { data, width: w, height: h };
};
t('sampleColors: sfondo giallo e testo blu letti dall’immagine', () => {
  const img = mkImg(100, 40, [255, 249, 196], [30, 15, 70, 25], [30, 102, 245]);
  const c = L.sampleColors(img, { x: 10, y: 8, w: 80, h: 24 });
  assert.strictEqual(c.bg, '#fff9c4'); assert.strictEqual(c.fg, '#1e66f5');
});
t('sampleColors: pagina bianca senza testo → sfondo bianco, testo null', () => {
  const c = L.sampleColors(mkImg(60, 30, [255, 255, 255]), { x: 5, y: 5, w: 50, h: 20 });
  assert.strictEqual(c.bg, '#ffffff'); assert.strictEqual(c.fg, null);
});
t('sampleColors: sfondo scuro con testo chiaro; riquadro ai bordi dell’immagine non va in errore', () => {
  const c = L.sampleColors(mkImg(60, 30, [20, 20, 20], [10, 10, 50, 20], [240, 240, 240]), { x: 0, y: 0, w: 60, h: 30 });
  assert.strictEqual(c.bg, '#141414'); assert.strictEqual(c.fg, '#f0f0f0');
});

console.log('\n' + n + ' test unitari PDF superati');
