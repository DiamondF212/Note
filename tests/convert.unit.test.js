// Test delle conversioni note ↔ documenti. Esecuzione: node tests/convert.unit.test.js
const assert = require('assert');
const X = require('../xlsx_core.js');
const V = require('../convert.js');
const W = require('../word_core.js');
const ExcelJS = require('../vendor/exceljs.min.js');
const queue = []; const t = (n, f) => queue.push([n, f]);
const txt = { kind: 'text', title: 'Spesa', body: 'latte\n\npane  e burro\n\n' };
const lst = { kind: 'list', title: 'Da fare', items: [{ t: 'Chiamare', done: true }, { t: '', done: false }, { t: 'Scrivere', done: false }] };

t('nota di testo → Word: titolo T1 e un paragrafo per riga (righe vuote comprese, code tagliate)', () => {
  const m = V.noteToWord([txt]);
  assert.deepStrictEqual(m.map((b) => [b.t, b.style || '', b.runs.map((r) => r.text).join('')]), [['p', 'h1', 'Spesa'], ['p', 'n', 'latte'], ['p', 'n', ''], ['p', 'n', 'pane  e burro']]);
});
t('lista → Word: elenco puntato, voci fatte barrate, voci vuote saltate', () => {
  const m = V.noteToWord([lst]);
  assert.deepStrictEqual(m.map((b) => b.t), ['p', 'li', 'li']);
  assert.strictEqual(m[1].runs[0].s, true); assert.strictEqual(m[2].runs[0].s, undefined);
});
t('più note → un solo documento; senza titolo → «Nota N»; nessuna nota → un paragrafo vuoto', () => {
  const m = V.noteToWord([{ kind: 'text', title: '', body: 'a' }, lst]);
  assert.strictEqual(m[0].runs[0].text, 'Nota 1'); assert.strictEqual(m.filter((b) => b.style === 'h1').length, 2);
  assert.strictEqual(V.noteToWord([]).length, 1);
});
t('il modello Word delle note produce un .docx valido', () => {
  const files = W.buildDocxFiles(V.noteToWord([txt, lst]));
  const doc = files.find((f) => f.name === 'word/document.xml').data;
  assert.ok(/Spesa/.test(doc) && /Chiamare/.test(doc) && /<w:strike\/>/.test(doc));
});
t('note → Excel: lista in colonne Fatto/Voce, testo in colonna A, un foglio per nota con nomi unici', () => {
  const m = V.noteToSheets([txt, lst, { kind: 'list', title: 'Da fare', items: [] }], X);
  assert.deepStrictEqual(m.sheets.map((s) => s.name), ['Spesa', 'Da fare', 'Da fare (2)']);
  const g = (si, r, c) => (m.sheets[si].cells.get(X.key(r, c)) || {}).v;
  assert.deepStrictEqual([g(0, 0, 0), g(0, 1, 0), g(0, 2, 0), g(0, 3, 0)], ['Spesa', 'latte', undefined, 'pane  e burro']);
  assert.deepStrictEqual([g(1, 0, 0), g(1, 0, 1), g(1, 1, 0), g(1, 1, 1), g(1, 2, 0), g(1, 2, 1)], ['Fatto', 'Voce', 'Sì', 'Chiamare', 'No', 'Scrivere']);
  assert.strictEqual(m.sheets[1].cells.get(0).b, true);
});
t('Excel → lista: colonna sola (tutta o selezione), valori calcolati, vuoti saltati', () => {
  const m = X.newModel(); const s = m.sheets[0];
  [['A1', 'pane'], ['A2', '2'], ['A3', ''], ['A4', '=A2*1,5'], ['B1', 'x']].forEach(([a, v]) => { const p = X.parseRef(a), c = X.parseInput(v); if (c) s.cells.set(X.key(p.r, p.c), c); });
  assert.deepStrictEqual(V.itemsFromCells(m, 0, null, X).map((i) => i.t), ['pane', '2', '3']);
  assert.deepStrictEqual(V.itemsFromCells(m, 0, { r1: 1, r2: 3, c1: 0, c2: 0 }, X).map((i) => i.t), ['2', '3']);
});
t('Excel → lista: con due colonne, la prima come «Fatto» (Sì/No, VERO/FALSO, x) e intestazione saltata', () => {
  const m = X.newModel(); const s = m.sheets[0];
  [['A1', 'Fatto'], ['B1', 'Voce'], ['A2', 'Sì'], ['B2', 'Chiamare'], ['A3', 'No'], ['B3', 'Scrivere'], ['A4', 'vero'], ['B4', 'Pagare']].forEach(([a, v]) => { const p = X.parseRef(a); s.cells.set(X.key(p.r, p.c), X.parseInput(v)); });
  const it = V.itemsFromCells(m, 0, { r1: 0, r2: 3, c1: 0, c2: 1 }, X);
  assert.deepStrictEqual(it, [{ t: 'Chiamare', done: true }, { t: 'Scrivere', done: false }, { t: 'Pagare', done: true }]);
});
t('Excel → lista: due colonne di testo (la prima non è «Fatto») → si usa la prima colonna', () => {
  const m = X.newModel(); const s = m.sheets[0];
  [['A1', 'Mele'], ['B1', 'Rosse'], ['A2', 'Pere'], ['B2', 'Gialle']].forEach(([a, v]) => { const p = X.parseRef(a); s.cells.set(X.key(p.r, p.c), X.parseInput(v)); });
  assert.deepStrictEqual(V.itemsFromCells(m, 0, { r1: 0, r2: 1, c1: 0, c2: 1 }, X).map((i) => [i.t, i.done]), [['Mele', false], ['Pere', false]]);
});
t('andata e ritorno: lista → Excel → lista', async () => {
  const m = V.noteToSheets([lst], X);
  const buf = await X.buildXlsx(ExcelJS, m); const back = await X.readXlsx(ExcelJS, buf);
  assert.deepStrictEqual(V.itemsFromCells(back, 0, { r1: 0, r2: 5, c1: 0, c2: 1 }, X), [{ t: 'Chiamare', done: true }, { t: 'Scrivere', done: false }]);
});
(async () => { let n = 0; for (const [name, f] of queue) { try { await f(); n++; console.log('  ok  ' + name); } catch (e) { console.log(' FAIL ' + name + '\n       ' + String(e.stack).split('\n').slice(0, 6).join('\n       ')); process.exitCode = 1; } } console.log(n + '/' + queue.length + ' test unitari conversioni superati'); })();
