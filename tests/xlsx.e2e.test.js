// Test end-to-end dell'editor Excel. Esecuzione: node tests/xlsx.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ExcelJS = require('../vendor/exceljs.min.js');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 14).join('\n       ')); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };

async function makeFixture() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Spese');
  a.getCell('A1').value = 'Voce'; a.getCell('A1').font = { bold: true };
  a.getCell('B1').value = 'Importo'; a.getCell('B1').font = { bold: true };
  a.getCell('A2').value = 'Affitto'; a.getCell('B2').value = 700; a.getCell('B2').numFmt = '#,##0.00 "€"';
  a.getCell('A3').value = 'Cibo'; a.getCell('B3').value = 250.5; a.getCell('B3').numFmt = '#,##0.00 "€"';
  a.getCell('A4').value = 'Totale'; a.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 950.5 }; a.getCell('B4').numFmt = '#,##0.00 "€"';
  a.getCell('C2').value = new Date(Date.UTC(2026, 10, 3));
  a.getCell('C3').value = { formula: 'VLOOKUP("Cibo",A2:B3,2,FALSE)', result: 250.5 };
  a.getColumn(1).width = 20;
  const b = wb.addWorksheet('Note');
  b.getCell('A1').value = 'Riepilogo'; b.getCell('B1').value = { formula: 'Spese!B4*2', result: 1901 };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

(async () => {
  const FIX = await makeFixture();
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(9000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(base); await page.waitForSelector('#list');
  await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');

  const docs = () => page.evaluate(() => N.docs._state.docs.map((d) => ({ id: d.id, name: d.name, type: d.type, size: d.size, origin: d.origin })));
  const byName = async (n) => (await docs()).find((d) => d.name === n);
  const bytesOf = (id) => page.evaluate(async (id) => Array.from(new Uint8Array((await N.db.docs.get(id)).data)), id).then((a) => Buffer.from(a));
  const closeEditor = async () => { await page.goBack(); await page.waitForSelector('.docs-screen'); await page.waitForTimeout(500); };
  const cell = (a1) => { const m = /^([A-Z]+)(\d+)$/.exec(a1); let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return '.xl-c[data-r="' + (m[2] - 1) + '"][data-c="' + (c - 1) + '"]'; };
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const txt = async (a1) => { await settle(); await page.waitForSelector(cell(a1)); return page.locator(cell(a1)).textContent(); };
  const inp = '[data-xl-input]';
  // scrive nella barra della formula della cella scelta e conferma con Invio (si passa alla cella sotto)
  const enter = async (a1, text) => { await page.click(cell(a1)); await page.fill(inp, text); await page.press(inp, 'Enter'); await settle(); };
  const x = async (k) => { await page.click('.xl-bar [data-x="' + k + '"]'); await settle(); };
  const model = () => page.evaluate(() => { const m = N.xlsxView._cur.model(); return m.sheets.map((s) => ({ name: s.name, cells: Array.from(s.cells.entries()) })); });
  const updated = (n) => page.evaluate((n) => (N.docs._state.docs.find((d) => d.name === n) || {}).updated, n);
  const saveAndWait = async (name) => { const u = await updated(name); await page.click('[aria-label="Salva"]'); await page.waitForFunction(([n, u]) => { const d = N.docs._state.docs.find((x) => x.name === n); return d && d.updated !== u; }, [name, u]); };
  const readBack = (id) => page.evaluate(async (id) => {
    const d = await N.db.docs.get(id); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(d.data.slice(0));
    const out = {}; wb.eachSheet((ws) => { out[ws.name] = {}; ws.eachRow((r) => r.eachCell((c) => { out[ws.name][c.address] = { v: c.value, nf: c.numFmt, b: c.font && c.font.bold }; })); }); return out;
  }, id);

  await t('Nuovo Excel: crea «Nuovo foglio di calcolo», apre la griglia con barra, formula e scheda', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-new="xlsx"]');
    await page.waitForSelector('.xl-grid .xl-c');
    const d = await byName('Nuovo foglio di calcolo'); ok(d && d.type === 'xlsx' && d.origin === 'note', JSON.stringify(d));
    eq(await page.locator('.xl-tab').count(), 2, 'Foglio 1 + «+»');
    eq(await page.locator('[data-xl-name]').textContent(), 'A1');
    ok(await page.locator('.xl-ch').first().textContent() === 'A' && await page.locator('.xl-rh').first().textContent() === '1');
  });

  await t('Scrittura: numeri, virgola decimale, testo, formula → valori calcolati e selezione che scende', async () => {
    await enter('A1', 'Mele'); await enter('A2', 'Pere');
    await enter('B1', '10'); await enter('B2', '2,5'); await enter('B3', '=SOMMA(B1:B2)');
    eq(await txt('A1'), 'Mele'); eq(await txt('B1'), '10'); eq(await txt('B2'), '2,5'); eq(await txt('B3'), '12,5');
    await settle(); eq(await page.locator('[data-xl-name]').textContent(), 'B4', 'dopo Invio si passa alla riga sotto');
    await page.click(cell('B3'));
    eq(await page.inputValue(inp), '=SOMMA(B1:B2)', 'la barra mostra la formula in italiano');
  });

  await t('Ricalcolo: cambiando B1 il totale si aggiorna', async () => {
    await enter('B1', '20');
    eq(await txt('B3'), '22,5');
  });

  await t('Formule: SE su testo, errore #DIV/0!, formula non valida dà avviso e non cambia nulla', async () => {
    await enter('C1', '=SE(B1>15;"alto";"basso")'); eq(await txt('C1'), 'alto');
    await enter('C2', '=B1/0'); eq(await txt('C2'), '#DIV/0!');
    ok(await page.locator(cell('C2')).evaluate((e) => e.classList.contains('err')));
    await page.click(cell('C3')); await page.fill(inp, '=SOMMA(B1'); await page.press(inp, 'Enter');
    await page.waitForSelector('.toast:has-text("Formula")');
    eq(await txt('C3'), '', 'cella invariata');
  });

  await t('Grassetto, corsivo, allineamento, annulla e ripeti', async () => {
    await page.click(cell('A1')); await x('b'); await x('i'); await x('al-center');
    const c = page.locator(cell('A1'));
    ok(await c.evaluate((e) => e.classList.contains('b') && e.classList.contains('i') && e.classList.contains('al-center')));
    await x('undo'); ok(await c.evaluate((e) => !e.classList.contains('al-center')));
    await x('undo'); ok(await c.evaluate((e) => !e.classList.contains('i')));
    await x('redo'); ok(await c.evaluate((e) => e.classList.contains('i')));
    await x('redo'); ok(await c.evaluate((e) => e.classList.contains('al-center')));
  });

  await t('Annulla/ripeti anche per i valori scritti', async () => {
    await enter('D1', '5'); eq(await txt('D1'), '5');
    await x('undo'); eq(await txt('D1'), ''); await x('redo'); eq(await txt('D1'), '5');
    await page.click(cell('D1')); await x('clear'); eq(await txt('D1'), ''); await x('undo'); eq(await txt('D1'), '5');
  });

  await t('Estendi selezione + formato Euro e Percentuale su più celle', async () => {
    await page.click(cell('B1')); await x('ext'); await page.click(cell('B3'));
    await settle(); eq(await page.locator('[data-xl-name]').textContent(), 'B1:B3');
    await x('nf'); await page.click('.sheet [data-nf="eur"]');
    eq(await txt('B1'), '20,00 €'); eq(await txt('B2'), '2,50 €'); eq(await txt('B3'), '22,50 €');
    await x('undo'); eq(await txt('B3'), '22,5');
    await x('redo'); eq(await txt('B3'), '22,50 €');
    await page.click(cell('D1')); await enter('D1', '12,5%'); eq(await txt('D1'), '12,5%', 'percentuale con un decimale');
  });

  await t('Intestazione di colonna: seleziona l’intera colonna e il formato vale per tutte le celle', async () => {
    await page.click('.xl-ch[data-ch="2"]');
    await settle();
    eq(await page.locator('[data-xl-name]').textContent(), 'C1:C' + await page.evaluate(() => N.xlsxView._cur.model().sheets[0].rows));
    await x('b');
    ok(await page.locator(cell('C2')).evaluate((e) => e.classList.contains('b')));
    ok(await page.locator(cell('C10')).evaluate((e) => e.classList.contains('b')));
    await x('undo');
  });

  await t('Inserire una riga: celle e formule scorrono (SOMMA si allarga)', async () => {
    await page.click(cell('A2')); await x('rc'); await page.click('.sheet [data-act="row-above"]');
    eq(await txt('A3'), 'Pere'); eq(await txt('B4'), '22,50 €'); eq(await txt('A2'), '');
    await page.click(cell('B4')); eq(await page.inputValue(inp), '=SOMMA(B1:B3)');
    await x('undo'); eq(await txt('A2'), 'Pere'); eq(await txt('B3'), '22,50 €');
  });

  await t('Eliminare una riga con riferimenti: #RIF! dove serve; colonne: inserisci e larghezza', async () => {
    await page.click(cell('B2')); await x('rc'); await page.click('.sheet [data-act="row-del"]');
    await page.click(cell('B2')); eq(await page.inputValue(inp), '=SOMMA(B1:B1)');
    await x('undo');
    await page.click(cell('B1')); await x('rc'); await page.click('.sheet [data-act="col-left"]');
    eq(await txt('C1'), '20,00 €'); eq(await txt('B1'), '');
    const w0 = await page.locator('.xl-ch[data-ch="2"]').evaluate((e) => e.getBoundingClientRect().width);
    await page.click(cell('C1')); await x('rc'); await page.click('.sheet [data-act="col-wider"]');
    await settle();
    const w1 = await page.locator('.xl-ch[data-ch="2"]').evaluate((e) => e.getBoundingClientRect().width);
    ok(w1 > w0 + 20, w0 + ' → ' + w1);
    await x('undo'); await x('undo'); eq(await txt('B1'), '20,00 €');
  });

  await t('Più fogli: nuovo foglio, formula tra fogli, rinomina aggiorna le formule', async () => {
    await page.click('[data-xl-addsheet]'); await page.waitForSelector('.xl-tab[data-sheet="1"].on');
    eq(await page.locator('.xl-tab[data-sheet="1"]').textContent(), 'Foglio 2');
    await enter('A1', "='Foglio 1'!B3*2"); eq(await txt('A1'), '45');
    await page.click('.more-btn, [aria-label="Altro"]'); await page.click('.sheet [data-act="rename"]');
    await page.waitForSelector('[data-xl-rename]');
    await page.locator('[data-xl-rename]').fill('Il mio foglio'); await page.click('[data-xl-rename-ok]');
    await page.waitForSelector('.xl-tab:has-text("Il mio foglio")');
    await page.click('.xl-tab[data-sheet="0"]'); await page.waitForSelector(cell('A1'));
    eq(await txt('B3'), '22,50 €', 'il primo foglio è intatto');
    await page.click('.xl-tab[data-sheet="1"]'); await page.click(cell('A1'));
    eq(await page.inputValue(inp), "='Foglio 1'!B3*2");
    const m = await model(); eq(m.length, 2);
    await page.click('.xl-tab[data-sheet="0"]');
    await page.click('[aria-label="Altro"]'); await page.click('.sheet [data-act="rename"]'); await page.locator('[data-xl-rename]').fill('Conti'); await page.click('[data-xl-rename-ok]');
    await page.waitForSelector('.xl-tab:has-text("Conti")');
    await page.click('.xl-tab[data-sheet="1"]'); await page.click(cell('A1'));
    eq(await page.inputValue(inp), '=Conti!B3*2', 'rinomina del foglio: la formula segue');
    eq(await txt('A1'), '45');
  });

  await t('Elimina foglio: le formule che lo usano diventano #RIF!', async () => {
    await page.click('.xl-tab[data-sheet="0"]');
    await page.click('[aria-label="Altro"]'); await page.click('.sheet [data-act="delsheet"]');
    await page.waitForFunction(() => document.querySelectorAll('.xl-tab[data-sheet]').length === 1);
    eq(await txt('A1'), '#RIF!');
    await x('undo');
    await page.waitForFunction(() => document.querySelectorAll('.xl-tab[data-sheet]').length === 2);
    await page.click('.xl-tab[data-sheet="1"]'); eq(await txt('A1'), '45');
  });

  await t('Griglia virtuale: pochi elementi nel DOM anche con migliaia di righe; si scorre fino in fondo', async () => {
    await page.click('.xl-tab[data-sheet="0"]');
    await page.evaluate(() => N.xlsxView._cur.setSize(5000, 60));
    await page.click(cell('A1')); await page.keyboard.press('Escape');
    await page.evaluate(() => { const sc = document.querySelector('[data-xl-scroll]'); sc.scrollTop = 4990 * 36 - 300; sc.scrollLeft = 3000; });
    await page.waitForTimeout(400);
    const n = await page.locator('.xl-c').count();
    ok(n > 10 && n < 400, 'celle nel DOM: ' + n);
    ok(Number(await page.locator('.xl-rh').last().textContent()) > 4900, 'intestazioni di riga lontane');
    ok(/^[A-Z]+$/.test(await page.locator('.xl-ch').last().textContent()));
    await page.evaluate(() => { const sc = document.querySelector('[data-xl-scroll]'); sc.scrollTop = 0; sc.scrollLeft = 0; });
    await page.evaluate(() => N.xlsxView._cur.setSize(50, 12));
    await page.waitForTimeout(300);
  });

  await t('Salva: il file .xlsx contiene valori, formule con risultato, stili e fogli', async () => {
    await page.click('.xl-tab[data-sheet="0"]');
    await saveAndWait('Nuovo foglio di calcolo');
    const d = await byName('Nuovo foglio di calcolo');
    const out = await readBack(d.id);
    eq(Object.keys(out).join(','), 'Conti,Foglio 2'.replace('Foglio 2', 'Il mio foglio'));
    const s = out.Conti;
    eq(s.A1.v, 'Mele'); eq(s.A1.b, true); eq(s.B1.v, 20); eq(s.B1.nf, '#,##0.00 "€"');
    eq(s.B3.v.formula, 'SUM(B1:B2)'); eq(s.B3.v.result, 22.5); eq(s.C1.v.result, 'alto');
    eq(out['Il mio foglio'].A1.v.formula, 'Conti!B3*2'); eq(out['Il mio foglio'].A1.v.result, 45);
    eq((await docs()).filter((x) => x.type === 'xlsx').length, 1, 'nessuna copia per un foglio creato qui');
  });

  await t('Il file salvato si riapre identico dopo ricarica dell’app', async () => {
    await closeEditor();
    await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list');
    await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
    await page.locator('.docrow:has-text("Nuovo foglio") .docmain').click(); await page.waitForSelector('.xl-grid .xl-c');
    eq(await page.locator('.xl-tab[data-sheet="0"]').textContent(), 'Conti');
    eq(await txt('A1'), 'Mele'); eq(await txt('B1'), '20,00 €'); eq(await txt('B3'), '22,50 €');
    await page.click(cell('B3')); eq(await page.inputValue(inp), '=SOMMA(B1:B2)');
  });

  await t('Esce con modifiche non salvate → salvataggio automatico (anche con la cella ancora in modifica)', async () => {
    await page.click(cell('A1')); await page.click(cell('A1')); await page.fill(inp, 'Banane'); // non confermato
    const before = (await byName('Nuovo foglio di calcolo')).size;
    await closeEditor();
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Nuovo foglio di calcolo').size !== b, before);
    eq((await readBack((await byName('Nuovo foglio di calcolo')).id)).Conti.A1.v, 'Banane');
  });

  await t('Importa un .xlsx vero: valori, formati, formule, date, secondo foglio, larghezza', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Spese.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: FIX }]);
    await page.waitForSelector('.docrow:has-text("Spese")');
    await page.locator('.docrow:has-text("Spese") .docmain').click(); await page.waitForSelector('.xl-grid .xl-c');
    eq(await txt('A2'), 'Affitto'); eq(await txt('B2'), '700,00 €'); eq(await txt('B3'), '250,50 €'); eq(await txt('B4'), '950,50 €');
    eq(await txt('C2'), '03/11/2026');
    eq(await txt('C3'), '250,5', 'funzione sconosciuta (CERCA.VERT): si vede l’ultimo risultato del file');
    ok(await page.locator(cell('A1')).evaluate((e) => e.classList.contains('b')));
    ok(await page.locator('.xl-ch[data-ch="0"]').evaluate((e) => e.getBoundingClientRect().width) > 125, 'larghezza colonna A letta dal file');
    await page.click(cell('B4')); eq(await page.inputValue(inp), '=SOMMA(B2:B3)');
    await page.click('.xl-tab[data-sheet="1"]'); eq(await txt('B1'), '1901'); eq(await txt('A1'), 'Riepilogo');
  });

  await t('Aprire e chiudere senza modifiche non crea copie', async () => {
    await closeEditor();
    eq((await docs()).filter((d) => d.type === 'xlsx').length, 2);
  });

  await t('Modifica di un .xlsx importato: l’originale resta identico, nasce «(modificato)» e le modifiche seguono', async () => {
    const orig = await byName('Spese'); const origBytes = await bytesOf(orig.id);
    await page.locator('.docrow:has-text("Spese") .docmain').first().click(); await page.waitForSelector('.xl-grid .xl-c');
    await enter('B2', '800');
    eq(await txt('B4'), '1.050,50 €');
    await page.click('[aria-label="Salva"]');
    await page.waitForFunction(() => N.docs._state.docs.some((d) => d.name === 'Spese (modificato)' && d.size > 1000));
    await page.waitForSelector('.toast:has-text("L’originale non è stato toccato")');
    eq((await bytesOf(orig.id)).equals(origBytes), true, 'originale invariato');
    const copy = await byName('Spese (modificato)'); eq(copy.origin, 'note');
    const out = await readBack(copy.id);
    eq(out.Spese.B2.v, 800); eq(out.Spese.B4.v.formula, 'SUM(B2:B3)'); eq(out.Spese.B4.v.result, 1050.5);
    eq(out.Spese.C3.v.formula, 'VLOOKUP("Cibo",A2:B3,2,FALSE)', 'la formula sconosciuta è conservata');
    eq(out.Spese.C3.v.result, 250.5, 'e anche il suo risultato');
    eq(out.Note.B1.v.formula, 'Spese!B4*2'); eq(out.Note.B1.v.result, 2101);
    await enter('B3', '300');
    await page.click('[aria-label="Salva"]');
    await page.waitForFunction(async () => { const d = N.docs._state.docs.find((x) => x.name === 'Spese (modificato)'); return !!d; });
    eq((await docs()).filter((d) => d.name.startsWith('Spese')).length, 2, 'una sola copia: i salvataggi successivi aggiornano la stessa');
  });

  await t('Menu Altro → salva il foglio come nota (testo a colonne)', async () => {
    await page.click('[aria-label="Altro"]'); await page.click('.sheet [data-act="note"]');
    await page.waitForTimeout(600);
    const notes = await page.evaluate(() => N.db.all().then((a) => a.map((n) => n.title + '|' + (n.body || ''))));
    ok(notes.some((s) => /Spese/.test(s.split('|')[0]) && s.includes('Affitto\t800,00 €')), JSON.stringify(notes).slice(0, 300));
  });

  await t('Un file .xlsx corrotto dà un messaggio, non blocca l’app', async () => {
    await closeEditor().catch(() => {});
    await page.waitForSelector('.docs-screen');
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Rotto.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('non uno zip')]) }]);
    await page.waitForSelector('.docrow:has-text("Rotto")');
    await page.locator('.docrow:has-text("Rotto") .docmain').click();
    await page.waitForSelector('.toast:has-text("Impossibile aprire")');
    eq(await page.locator('.xl-grid').count(), 0);
  });

  await t('Nessuna richiesta esterna e nessun errore imprevisto', async () => {
    eq(external.join(','), '');
    const real = errors.filter((e) => !/file Excel non leggibile|Impossibile aprire|end of central directory|zip|Failed to load resource|Can't find|corrupt/i.test(e));
    eq(real.join(' | '), '');
  });

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
