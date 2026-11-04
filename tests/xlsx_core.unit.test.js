// Test della logica pura di Excel (formule, formati, righe/colonne, lettura e scrittura .xlsx). Esecuzione: node tests/xlsx_core.unit.test.js
const assert = require('assert');
const C = require('../xlsx_core.js');
const L = C._logic;
const ExcelJS = require('../vendor/exceljs.min.js');
let n = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);

// foglio di prova: celle scritte come le scriverebbe l'utente
function mk(obj, extraSheets) {
  const m = C.newModel(); const sh = m.sheets[0];
  for (const [a, txt] of Object.entries(obj)) { const p = C.parseRef(a), c = C.parseInput(txt); if (c) sh.cells.set(C.key(p.r, p.c), c); }
  for (const [name, o2] of Object.entries(extraSheets || {})) {
    const s2 = C.newSheet(name); m.sheets.push(s2);
    for (const [a, txt] of Object.entries(o2)) { const p = C.parseRef(a); s2.cells.set(C.key(p.r, p.c), C.parseInput(txt)); }
  }
  return m;
}
const val = (m, a, si) => { const p = C.parseRef(a); return C.createCalc(m).get(si || 0, p.r, p.c); };
const show = (m, a, si) => { const p = C.parseRef(a), c = m.sheets[si || 0].cells.get(C.key(p.r, p.c)); return C.formatValue(val(m, a, si), c && c.nf); };

t('colonne: A, Z, AA, AZ, XFD e ritorno', () => {
  assert.deepStrictEqual([0, 25, 26, 51, 16383].map(C.colName), ['A', 'Z', 'AA', 'AZ', 'XFD']);
  assert.deepStrictEqual(['A', 'Z', 'AA', 'AZ'].map(C.colIndex), [0, 25, 26, 51]);
  assert.deepStrictEqual(C.parseRef('$B$3'), { r: 2, c: 1 });
  assert.strictEqual(C.parseRef('A0'), null);
  assert.strictEqual(C.refName(9, 27), 'AB10');
});
t('parseInput: numeri con virgola, migliaia, percentuale, data, booleani, testo, apostrofo', () => {
  assert.deepStrictEqual(C.parseInput('12,5'), { v: 12.5 });
  assert.deepStrictEqual(C.parseInput('1.234,5'), { v: 1234.5 });
  assert.deepStrictEqual(C.parseInput('-3'), { v: -3 });
  assert.deepStrictEqual(C.parseInput('12%'), { v: 0.12, nf: '0%' });
  assert.deepStrictEqual(C.parseInput('12,5%'), { v: 0.125, nf: '0.0%' });
  assert.deepStrictEqual(C.parseInput('03/11/2026'), { v: 46329, nf: 'dd/mm/yyyy' });
  assert.strictEqual(C.parseInput('31/02/2026').v, '31/02/2026');
  assert.deepStrictEqual(C.parseInput('vero'), { v: true });
  assert.deepStrictEqual(C.parseInput('FALSE'), { v: false });
  assert.deepStrictEqual(C.parseInput('Ciao'), { v: 'Ciao' });
  assert.deepStrictEqual(C.parseInput("'123"), { v: '123' });
  assert.strictEqual(C.parseInput('   '), null);
  assert.strictEqual(C.parseInput(''), null);
});
t('formule: forma italiana ↔ inglese', () => {
  assert.strictEqual(C.canon('=SOMMA(A1:A3;2,5)'), 'SUM(A1:A3,2.5)');
  assert.strictEqual(C.canon('=se(a1>0;"sì";"no")'), 'IF(A1>0,"sì","no")');
  assert.strictEqual(C.canon('=SUM(A1,B2)'), 'SUM(A1,B2)');
  assert.strictEqual(C.canon("=Foglio2!A1+'Mio foglio'!B2"), "Foglio2!A1+'Mio foglio'!B2");
  assert.strictEqual(C.canon('=CONTA.SE(A1:A9;">3")'), 'COUNTIF(A1:A9,">3")');
  assert.strictEqual(C.display('IF(A1>0,"sì","no")'), 'SE(A1>0;"sì";"no")');
  assert.strictEqual(C.display('SUM(A1:A3,2.5)'), 'SOMMA(A1:A3;2,5)');
  assert.strictEqual(C.display('A1&" x"'), 'A1&" x"');
});
t('formule non valide lanciano un errore', () => {
  ['=SOMMA(A1', '=1+', '="aperto', '=A1 B1', '=1,5+', '=)', '=Pippo', '=SOMMA(1;2;)x'].forEach((f) => assert.throws(() => C.canon(f), f));
});
t('aritmetica e precedenze', () => {
  const m = mk({ A1: '=2+3*4', A2: '=(2+3)*4', A3: '=-2^2', A4: '=2^3^2', A5: '=10/4', A6: '=50%', A8: '=7-2-1' });
  assert.strictEqual(val(m, 'A1'), 14); assert.strictEqual(val(m, 'A2'), 20); assert.strictEqual(val(m, 'A3'), 4);
  assert.strictEqual(val(m, 'A4'), 64); assert.strictEqual(val(m, 'A5'), 2.5); assert.strictEqual(val(m, 'A6'), 0.5); assert.strictEqual(val(m, 'A8'), 4);
});
t('numeri con virgola nelle formule italiane (con «;» o senza funzioni) e punto in quelle inglesi', () => {
  const m = mk({ A1: '=SOMMA(1,5;2,25)', A2: '=SUM(1.5,2.25)', A3: '=2*1,5', A4: '=A3*0,5' });
  assert.strictEqual(val(m, 'A1'), 3.75); assert.strictEqual(val(m, 'A2'), 3.75); assert.strictEqual(val(m, 'A3'), 3); assert.strictEqual(val(m, 'A4'), 1.5);
});
t('riferimenti, intervalli, $ e celle vuote', () => {
  const m = mk({ A1: '5', A2: '7', A3: '=A1+A2+A9', B1: '=SOMMA(A1:A3)', B2: '=$A$1*2', B3: '=A1:A2' });
  assert.strictEqual(val(m, 'A3'), 12); assert.strictEqual(val(m, 'B1'), 24); assert.strictEqual(val(m, 'B2'), 10);
  assert.deepStrictEqual(val(m, 'B3'), { err: '#VALUE!' });
});
t('errori: divisione per zero, testo in somma, propagazione, riferimento circolare', () => {
  const m = mk({ A1: '=1/0', A2: '=A1+1', A3: '="a"+1', A4: '=SOMMA(A1;2)', B1: '=B2', B2: '=B1', C1: '=C1+1' });
  assert.deepStrictEqual(val(m, 'A1'), { err: '#DIV/0!' }); assert.deepStrictEqual(val(m, 'A2'), { err: '#DIV/0!' });
  assert.deepStrictEqual(val(m, 'A3'), { err: '#VALUE!' }); assert.deepStrictEqual(val(m, 'A4'), { err: '#DIV/0!' });
  assert.deepStrictEqual(val(m, 'B1'), { err: '#CIRC!' }); assert.deepStrictEqual(val(m, 'B2'), { err: '#CIRC!' }); assert.deepStrictEqual(val(m, 'C1'), { err: '#CIRC!' });
  assert.strictEqual(show(m, 'A1'), '#DIV/0!');
});
t('funzioni di aggregazione: ignorano testo negli intervalli', () => {
  const m = mk({ A1: '4', A2: 'ciao', A3: '6', A4: '', A5: 'vero', B1: '=SOMMA(A1:A5)', B2: '=MEDIA(A1:A5)', B3: '=MIN(A1:A5)', B4: '=MAX(A1:A5)', B5: '=CONTA.NUMERI(A1:A5)', C1: '=CONTA.VALORI(A1:A5)', C2: '=PRODOTTO(A1;A3)', C3: '=MEDIA(A2:A2)', C4: '=SOMMA(A1;"3";VERO)' });
  assert.deepStrictEqual([val(m, 'B1'), val(m, 'B2'), val(m, 'B3'), val(m, 'B4'), val(m, 'B5'), val(m, 'C1'), val(m, 'C2')], [10, 5, 4, 6, 2, 4, 24]);
  assert.deepStrictEqual(val(m, 'C3'), { err: '#DIV/0!' });
  assert.strictEqual(val(m, 'C4'), 8);
});
t('SE, E, O, NON, SE.ERRORE e confronti', () => {
  const m = mk({ A1: '10', B1: '=SE(A1>5;"alto";"basso")', B2: '=SE(A1<5;1)', B3: '=E(A1>1;A1<20)', B4: '=O(A1<1;A1=10)', B5: '=NON(A1=10)', B6: '=SE.ERRORE(1/0;"x")', B7: '=SE.ERRORE(5;"x")', B8: '="a"="A"', B9: '=A1<>10', B10: '="abc"<"abd"' });
  assert.deepStrictEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9', 'B10'].map((a) => val(m, a)), ['alto', false, true, true, false, 'x', 5, true, false, true]);
});
t('SE valuta solo il ramo scelto (l’altro può essere un errore)', () => {
  const m = mk({ A1: '=SE(VERO;1;1/0)', A2: '=SE(FALSO;1/0;2)' });
  assert.strictEqual(val(m, 'A1'), 1); assert.strictEqual(val(m, 'A2'), 2);
});
t('funzioni matematiche e di testo', () => {
  const m = mk({ A1: '=ARROTONDA(2,5;0)', A2: '=ARROTONDA(-2,5;0)', A3: '=ARROTONDA(1,005;2)', A4: '=ARROTONDA(1234;-2)', A5: '=ASS(-3)', A6: '=RADQ(16)', A7: '=RADQ(-1)', A8: '=POTENZA(2;10)', A9: '=RESTO(-7;3)', B1: '=INT(-2.5)', B2: '=CONCATENA("a";1;"b")', B3: '=LUNGHEZZA("àèì")', B4: '=MAIUSC("ciao")', B5: '=MINUSC("CIAO")', B6: '="x"&1,5', B7: '=RESTO(1;0)' });
  assert.deepStrictEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A8', 'A9', 'B1', 'B2', 'B3', 'B4', 'B5'].map((a) => val(m, a)), [3, -3, 1.01, 1200, 3, 4, 1024, 2, -3, 'a1b', 3, 'CIAO', 'ciao']);
  assert.deepStrictEqual(val(m, 'A7'), { err: '#NUM!' }); assert.deepStrictEqual(val(m, 'B7'), { err: '#DIV/0!' });
});
t('SOMMA.SE e CONTA.SE con criteri', () => {
  const m = mk({ A1: '1', A2: '5', A3: '10', A4: 'pane', B1: '10', B2: '20', B3: '30', B4: '40', C1: '=SOMMA.SE(A1:A4;">3")', C2: '=CONTA.SE(A1:A4;">=5")', C3: '=SOMMA.SE(A1:A4;">3";B1:B4)', C4: '=CONTA.SE(A1:A4;"PANE")', C5: '=CONTA.SE(A1:A4;"<>5")', C6: '=CONTA.SE(A1:A4;5)' });
  assert.deepStrictEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((a) => val(m, a)), [15, 2, 50, 1, 3, 1]);
});
t('altri fogli: Foglio2!A1 e nomi con spazi', () => {
  const m = mk({ A1: '=Foglio2!A1*2', A2: "='Dati 2026'!B1+1", A3: '=Manca!A1', A4: '=SOMMA(Foglio2!A1:A2)' }, { Foglio2: { A1: '21', A2: '1' }, 'Dati 2026': { B1: '9' } });
  assert.strictEqual(val(m, 'A1'), 42); assert.strictEqual(val(m, 'A2'), 10); assert.deepStrictEqual(val(m, 'A3'), { err: '#REF!' }); assert.strictEqual(val(m, 'A4'), 22);
});
t('funzione sconosciuta: #NOME? oppure ultimo risultato salvato nel file', () => {
  const m = mk({ A1: '=CERCA.VERT(1;B1:C2;2)' });
  assert.deepStrictEqual(val(m, 'A1'), { err: '#NAME?' });
  m.sheets[0].cells.set(C.key(0, 0), { f: 'VLOOKUP(1,B1:C2,2)', rv: 'trovato' });
  m.sheets[0].cells.set(C.key(1, 0), { f: 'A1&"!"' });
  assert.strictEqual(val(m, 'A1'), 'trovato'); assert.strictEqual(val(m, 'A2'), 'trovato!');
});
t('formati: numero, migliaia, euro, percentuale, data, generale', () => {
  const f = C.formatValue;
  assert.strictEqual(f(1234.5), '1234,5'); assert.strictEqual(f(0.1 + 0.2), '0,3'); assert.strictEqual(f(1 / 3), '0,333333333333333');
  assert.strictEqual(f(1234.5, '0.00'), '1234,50'); assert.strictEqual(f(1234567.891, '#,##0'), '1.234.568'); assert.strictEqual(f(1234.5, '#,##0.00 "€"'), '1.234,50 €');
  assert.strictEqual(f(0.125, '0.00%'), '12,50%'); assert.strictEqual(f(0.5, '0%'), '50%'); assert.strictEqual(f(-0.001, '0.00'), '0,00'); assert.strictEqual(f(-5.5, '0.0'), '-5,5');
  assert.strictEqual(f(46329, 'dd/mm/yyyy'), '03/11/2026'); assert.strictEqual(f(46329, 'mm-dd-yy'), '03/11/2026'); assert.strictEqual(f(46329, 'd/m/yy'), '3/11/26');
  assert.strictEqual(f(true), 'VERO'); assert.strictEqual(f('x'), 'x'); assert.strictEqual(f(null), ''); assert.strictEqual(f({ err: '#VALUE!' }), '#VALORE!');
  assert.strictEqual(f(2.675, '0.00'), '2,68');
});
t('date: seriali e conversione', () => {
  assert.strictEqual(L.dateSerial(2026, 11, 3), 46329); assert.strictEqual(L.dateSerial(2026, 2, 30), null);
  assert.strictEqual(L.fromSerial(46329).toISOString().slice(0, 10), '2026-11-03');
  const m = mk({ A1: '03/11/2026', A2: '=A1+30' });
  assert.strictEqual(val(m, 'A2'), 46359);
});
t('editText: formula in italiano, percentuale, data, testo che sembra numero', () => {
  assert.strictEqual(C.editText({ f: 'SUM(A1:A2,1.5)' }), '=SOMMA(A1:A2;1,5)');
  assert.strictEqual(C.editText({ v: 0.125, nf: '0.0%' }), '12,5%'); assert.strictEqual(C.editText({ v: 46329, nf: 'dd/mm/yyyy' }), '03/11/2026');
  assert.strictEqual(C.editText({ v: '123' }), "'123"); assert.strictEqual(C.editText({ v: 'ciao' }), 'ciao'); assert.strictEqual(C.editText({ v: 1234.5 }), '1234,5'); assert.strictEqual(C.editText(null), '');
  ['=SOMMA(A1;2)', '12,5%', '03/11/2026', "'123", '5', 'vero'].forEach((txt) => { const a = C.parseInput(txt); assert.deepStrictEqual(C.parseInput(C.editText(a)), a, txt); });
});
t('inserire righe: i riferimenti scorrono, gli intervalli si allargano', () => {
  const m = mk({ A1: '1', A2: '2', A3: '=SOMMA(A1:A2)', B1: '=A2', B2: '=A$2+$A3' });
  C.insertRows(m, 0, 1, 1);
  const f = (a) => m.sheets[0].cells.get(C.key(C.parseRef(a).r, C.parseRef(a).c)).f;
  assert.strictEqual(f('A4'), 'SUM(A1:A3)'); assert.strictEqual(f('B1'), 'A3'); assert.strictEqual(f('B3'), 'A$3+$A4');
  assert.strictEqual(m.sheets[0].cells.get(C.key(1, 0)), undefined); assert.strictEqual(val(m, 'A4'), 3);
});
t('eliminare righe: #RIF! sulle celle cancellate, intervalli ridotti', () => {
  const m = mk({ A1: '1', A2: '2', A3: '3', A4: '=SOMMA(A1:A3)', B1: '=A2', B2: '=A3', B3: '=SOMMA(A2:A2)' });
  C.deleteRows(m, 0, 1, 1);
  const f = (a) => (m.sheets[0].cells.get(C.key(C.parseRef(a).r, C.parseRef(a).c)) || {}).f;
  assert.strictEqual(f('A3'), 'SUM(A1:A2)'); assert.strictEqual(f('B1'), '#REF!'); assert.strictEqual(f('B2'), 'SUM(#REF!)');
  assert.strictEqual(val(m, 'A3'), 4); assert.deepStrictEqual(val(m, 'B1'), { err: '#REF!' });
});
t('colonne: inserire/eliminare spostano celle, formule e larghezze', () => {
  const m = mk({ A1: '1', B1: '2', C1: '=A1+B1' });
  m.sheets[0].colW = { 1: 150, 2: 200 };
  C.insertCols(m, 0, 1, 1);
  const f = (a) => m.sheets[0].cells.get(C.key(C.parseRef(a).r, C.parseRef(a).c));
  assert.strictEqual(f('D1').f, 'A1+C1'); assert.strictEqual(f('C1').v, 2); assert.deepStrictEqual(m.sheets[0].colW, { 2: 150, 3: 200 });
  C.deleteCols(m, 0, 2, 1);
  assert.strictEqual(f('C1').f, 'A1+#REF!'); assert.deepStrictEqual(m.sheets[0].colW, { 2: 200 });
});
t('righe/colonne: i riferimenti da altri fogli seguono il foglio giusto', () => {
  const m = mk({ A1: '=Foglio2!A2' }, { Foglio2: { A1: '1', A2: '2' } });
  C.insertRows(m, 1, 0, 1);
  assert.strictEqual(m.sheets[0].cells.get(0).f, 'Foglio2!A3');
  C.insertRows(m, 0, 0, 1); // inserire nel foglio 1 non tocca i riferimenti a Foglio2
  assert.strictEqual(m.sheets[0].cells.get(C.key(1, 0)).f, 'Foglio2!A3');
  assert.strictEqual(val(m, 'A2'), 2);
});
t('rinomina ed elimina foglio aggiornano le formule', () => {
  const m = mk({ A1: '=Foglio2!A1', A2: "=SOMMA('Foglio2'!A1:A2)" }, { Foglio2: { A1: '5', A2: '6' } });
  C.renameSheet(m, 1, 'Spese 2026');
  assert.strictEqual(m.sheets[0].cells.get(0).f, "'Spese 2026'!A1"); assert.strictEqual(val(m, 'A2'), 11);
  C.removeSheet(m, 1);
  assert.strictEqual(m.sheets[0].cells.get(0).f, '#REF!'); assert.deepStrictEqual(val(m, 'A1'), { err: '#REF!' });
});
t('cleanSheetName: caratteri vietati, lunghezza, duplicati', () => {
  assert.strictEqual(C.cleanSheetName('a/b:c*d?[e]'), 'a b c d  e'.replace(/\s+/g, ' '));
  assert.strictEqual(C.cleanSheetName(''), 'Foglio');
  assert.strictEqual(C.cleanSheetName('Dati', ['dati']), 'Dati (2)');
  assert.strictEqual(C.cleanSheetName('x'.repeat(40)).length, 31);
  assert.ok(C.cleanSheetName('y'.repeat(31), ['y'.repeat(31)]).length <= 31);
});
t('sheetText: testo a colonne con valori formattati', () => {
  const m = mk({ A1: 'Nome', B1: 'Totale', A2: 'Pane', B2: '=1,5*2', C3: '5' });
  m.sheets[0].cells.get(C.key(1, 1)).nf = '0.00';
  assert.strictEqual(C.sheetText(m, 0, C.createCalc(m)), 'Nome\tTotale\nPane\t3,00\n\t\t5');
});
t('usedRange', () => {
  assert.deepStrictEqual(C.usedRange(C.newSheet('x')), { rows: 0, cols: 0 });
  assert.deepStrictEqual(C.usedRange(mk({ C5: '1', A1: '1' }).sheets[0]), { rows: 5, cols: 3 });
});

t('scrittura e rilettura .xlsx: valori, formule con risultato, stili, fogli, larghezze', async () => {
  const m = mk({ A1: 'Voce', B1: 'Importo', A2: 'Pane', B2: '12,5', A3: 'Totale', B3: '=SOMMA(B2:B2)*2', C1: '03/11/2026', C2: '=SE(B2>10;"alto";"basso")', C3: '=1/0', D1: 'vero', E1: '50%' }, { 'Dati 2': { A1: '7'} });
  m.sheets[1].cells.set(C.key(1, 0), { f: "'Foglio 1'!A1" });
  const s = m.sheets[0];
  s.cells.set(C.key(0, 0), Object.assign({}, s.cells.get(C.key(0, 0)), { b: true, i: true, al: 'center' }));
  s.cells.set(C.key(1, 1), Object.assign({}, s.cells.get(C.key(1, 1)), { nf: '#,##0.00 "€"' }));
  s.colW = { 0: 130, 1: 100 };
  const buf = await C.buildXlsx(ExcelJS, m);
  assert.ok(buf instanceof ArrayBuffer && buf.byteLength > 1000);
  assert.strictEqual(Buffer.from(buf).slice(0, 2).toString(), 'PK');
  // lettura "raw" con ExcelJS: i risultati calcolati sono nel file
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  const ws = wb.getWorksheet('Foglio 1');
  assert.strictEqual(ws.getCell('B3').value.formula, 'SUM(B2:B2)*2'); assert.strictEqual(ws.getCell('B3').value.result, 25);
  assert.strictEqual(ws.getCell('C2').value.result, 'alto'); assert.deepStrictEqual(ws.getCell('C3').value.result, { error: '#DIV/0!' });
  assert.strictEqual(ws.getCell('A1').font.bold, true); assert.strictEqual(ws.getCell('A1').alignment.horizontal, 'center');
  assert.strictEqual(ws.getCell('B2').numFmt, '#,##0.00 "€"');
  assert.ok(Math.abs(ws.getColumn(1).width - 17.86) < 0.1);
  // e con la nostra lettura
  const back = await C.readXlsx(ExcelJS, buf);
  assert.deepStrictEqual(back.sheets.map((x) => x.name), ['Foglio 1', 'Dati 2']);
  const g = (si, a) => back.sheets[si].cells.get(C.key(C.parseRef(a).r, C.parseRef(a).c));
  assert.strictEqual(g(0, 'B3').f, 'SUM(B2:B2)*2'); assert.strictEqual(g(0, 'B3').rv, 25);
  assert.strictEqual(g(0, 'B2').v, 12.5); assert.strictEqual(g(0, 'B2').nf, '#,##0.00 "€"');
  assert.deepStrictEqual([g(0, 'A1').b, g(0, 'A1').i, g(0, 'A1').al], [true, true, 'center']);
  assert.strictEqual(g(0, 'D1').v, true); assert.strictEqual(g(0, 'E1').v, 0.5); assert.strictEqual(g(0, 'C1').v, 46329);
  assert.strictEqual(g(1, 'A2').f, "'Foglio 1'!A1");
  assert.ok(Math.abs(back.sheets[0].colW[0] - 130) <= 1 && Math.abs(back.sheets[0].colW[1] - 100) <= 1);
  const k = C.createCalc(back);
  assert.strictEqual(k.get(0, 2, 1), 25); assert.strictEqual(k.get(1, 1, 0), 'Voce');
});
t('lettura di un .xlsx creato da ExcelJS: date, formule condivise, celle unite, testo ricco, errori, funzioni sconosciute', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dati');
  ws.getCell('A1').value = new Date(Date.UTC(2026, 10, 3));
  ws.getCell('A2').value = { richText: [{ text: 'Ciao ' }, { text: 'mondo', font: { bold: true } }] };
  ws.getCell('A3').value = { formula: 'VLOOKUP(1,B1:C2,2,FALSE)', result: 'trovato' };
  ws.getCell('A4').value = { error: '#N/A' };
  ws.getCell('B1').value = 4; ws.getCell('B2').value = { formula: 'B1*2', result: 8 };
  ws.getCell('B3').value = { formula: 'SUM(A:A)', result: 99 };
  ws.getCell('C1').value = { formula: 'B1+1', result: new Date(Date.UTC(2026, 10, 3)) };
  ws.mergeCells('D1:E2'); ws.getCell('D1').value = 'unita';
  ws.getCell('F1').value = { text: 'sito', hyperlink: 'https://x.it' };
  ws.getColumn(2).width = 20;
  const buf = await wb.xlsx.writeBuffer();
  const m = await C.readXlsx(ExcelJS, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const g = (a) => m.sheets[0].cells.get(C.key(C.parseRef(a).r, C.parseRef(a).c));
  assert.strictEqual(g('A1').v, 46329); assert.strictEqual(g('A1').nf, 'dd/mm/yyyy');
  assert.strictEqual(g('A2').v, 'Ciao mondo');
  assert.strictEqual(g('A3').f, 'VLOOKUP(1,B1:C2,2,FALSE)'); assert.strictEqual(g('A3').rv, 'trovato');
  assert.deepStrictEqual(g('A4').v, { err: '#N/A' });
  assert.strictEqual(g('B3').v, 99); assert.strictEqual(g('B3').f, undefined); // A:A non supportato → resta il valore
  assert.strictEqual(g('D1').v, 'unita'); assert.strictEqual(g('E1'), undefined); assert.strictEqual(g('D2'), undefined);
  assert.strictEqual(g('F1').v, 'sito');
  assert.ok(m.warnings.some((w) => /unite/.test(w)));
  assert.strictEqual(m.sheets[0].colW[1], 145);
  const k = C.createCalc(m);
  assert.strictEqual(k.get(0, 2, 0), 'trovato'); assert.strictEqual(k.get(0, 1, 1), 8); assert.strictEqual(k.get(0, 0, 2), 5);
});
t('lettura di file vuoto o senza fogli → un foglio vuoto', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Vuoto');
  const buf = await wb.xlsx.writeBuffer();
  const m = await C.readXlsx(ExcelJS, buf);
  assert.strictEqual(m.sheets.length, 1); assert.strictEqual(m.sheets[0].cells.size, 0); assert.ok(m.sheets[0].rows >= 40 && m.sheets[0].cols >= 12);
});
t('file non valido: la lettura fallisce senza bloccare', async () => {
  await assert.rejects(() => C.readXlsx(ExcelJS, Buffer.from('non sono uno zip')));
});
t('catena lunga di formule: niente crash', () => {
  const m = C.newModel(); const sh = m.sheets[0];
  sh.cells.set(0, { v: 1 });
  for (let r = 1; r < 3000; r++) sh.cells.set(C.key(r, 0), { f: 'A' + r + '+1' });
  const v = C.createCalc(m).get(0, 2999, 0);
  assert.ok(v === 3000 || (v && v.err === '#VALUE!'));
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); n++; console.log('  ok  ' + name); } catch (e) { console.log(' FAIL ' + name + '\n       ' + String(e.stack || e).split('\n').slice(0, 8).join('\n       ')); process.exitCode = 1; }
  }
  console.log(n + '/' + queue.length + ' test unitari Excel superati');
})();
