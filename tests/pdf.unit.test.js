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
console.log('\n' + n + ' test unitari PDF superati');
