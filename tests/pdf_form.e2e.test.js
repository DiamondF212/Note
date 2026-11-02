// Test end-to-end della compilazione dei moduli PDF. Esecuzione: node tests/pdf_form.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const { PDFDocument, StandardFonts } = require(path.join(root, 'vendor/pdf-lib.min.js'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 14).join('\n       ')); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };

async function makeForm() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 560]);
  p.drawText('Modulo di prova', { x: 40, y: 510, size: 20, font });
  const form = doc.getForm();
  const nome = form.createTextField('nome'); nome.addToPage(p, { x: 40, y: 450, width: 200, height: 22 });
  const note = form.createTextField('note'); note.enableMultiline(); note.setText('Testo già presente'); note.addToPage(p, { x: 40, y: 360, width: 250, height: 60 });
  const ok = form.createCheckBox('accetto'); ok.addToPage(p, { x: 40, y: 320, width: 18, height: 18 });
  const rg = form.createRadioGroup('sesso'); rg.addOptionToPage('M', p, { x: 40, y: 280, width: 16, height: 16 }); rg.addOptionToPage('F', p, { x: 80, y: 280, width: 16, height: 16 });
  const dd = form.createDropdown('citta'); dd.addOptions(['Roma', 'Milano', 'Napoli']); dd.addToPage(p, { x: 40, y: 230, width: 160, height: 22 });
  return Buffer.from(await doc.save());
}
async function makePlain() { const doc = await PDFDocument.create(); doc.addPage([300, 400]); return Buffer.from(await doc.save()); }

(async () => {
  const FORM = await makeForm(), PLAIN = await makePlain();
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(base); await page.waitForSelector('#list');
  await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
  await page.click('.docs-plus'); await page.click('.sheet [data-import]');
  await page.locator('input[data-docs-input]').setInputFiles([
    { name: 'Modulo.pdf', mimeType: 'application/pdf', buffer: FORM },
    { name: 'Semplice.pdf', mimeType: 'application/pdf', buffer: PLAIN }
  ]);
  await page.waitForSelector('.docrow:nth-child(2)');
  const openDoc = async (name) => { await page.locator('.docrow:has-text("' + name + '") .docmain').click(); await page.waitForSelector('.pdf-page canvas'); };
  const values = () => page.evaluate(async () => {
    const d = N.docs._state.docs.find((x) => x.name === 'Modulo'); const full = await N.db.docs.get(d.id);
    const doc = await PDFLib.PDFDocument.load(full.data.slice(0)); const f = doc.getForm();
    return { nome: f.getTextField('nome').getText() || '', note: f.getTextField('note').getText() || '', accetto: f.getCheckBox('accetto').isChecked(), sesso: f.getRadioGroup('sesso').getSelected() || '', citta: (f.getDropdown('citta').getSelected() || [''])[0] };
  });

  await t('un PDF senza campi non mostra il pulsante «Compila il modulo»', async () => {
    await openDoc('Semplice'); await page.waitForTimeout(700);
    ok(await page.locator('[data-pdf-form]').isHidden(), 'il pulsante doveva restare nascosto');
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('.pdf-body'));
  });
  await t('un PDF con campi mostra il pulsante e i campi si disegnano al posto giusto', async () => {
    await openDoc('Modulo');
    await page.waitForSelector('[data-pdf-form]:not([hidden])');
    await page.click('[data-pdf-form]'); await page.waitForSelector('.pdf-tools.on [data-form-save]');
    eq(await page.locator('.pdf-fld').count(), 3, 'campi testo/elenco'); eq(await page.locator('.pdf-fchk').count(), 3, 'caselle e scelte');
    const b = await page.locator('.pdf-page').boundingBox(), f = await page.locator('[data-fld="nome"]').boundingBox(), cs = b.width / 400;
    ok(Math.abs((f.x - b.x) / cs - 40) < 2, 'x ' + (f.x - b.x) / cs); ok(Math.abs((f.y - b.y) / cs - (560 - 450 - 22)) < 2, 'y ' + (f.y - b.y) / cs);
    ok(Math.abs(f.width / cs - 200) < 2, 'larghezza');
    eq(await page.locator('[data-fld="note"]').inputValue(), 'Testo già presente');
    ok(await page.locator('[data-form-save]').isDisabled(), '«Salva» spento senza modifiche');
  });
  await t('compilando i campi «Salva» si accende; riportando i valori com’erano si spegne di nuovo', async () => {
    await page.fill('[data-fld="nome"]', 'Mario');
    ok(!(await page.locator('[data-form-save]').isDisabled()));
    await page.fill('[data-fld="nome"]', '');
    ok(await page.locator('[data-form-save]').isDisabled());
  });
  await t('«Salva» scrive nel PDF: testo, casella, scelta singola ed elenco', async () => {
    await page.fill('[data-fld="nome"]', 'Mario Rossi è Łódź');
    await page.fill('[data-fld="note"]', 'Riga 1\nRiga 2');
    await page.click('[data-fld="accetto"]');
    await page.click('[data-fld="sesso"][data-val="1"]');
    await page.selectOption('[data-fld="citta"]', 'Milano');
    const before = await page.evaluate(() => N.docs._state.docs.find((d) => d.name === 'Modulo').size);
    await page.click('[data-form-save]');
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Modulo').size !== b, before);
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    const v = await values();
    eq(v.nome, 'Mario Rossi è Łódź'); eq(v.note, 'Riga 1\nRiga 2'); eq(v.accetto, true); eq(v.sesso, 'F'); eq(v.citta, 'Milano');
  });
  await t('il PDF salvato mostra davvero il testo scritto nel campo (anche senza la modalità modulo)', async () => {
    await page.waitForTimeout(700);
    const dark = await page.locator('.pdf-page canvas').first().evaluate((c) => {
      const k = c.width / 400, d = c.getContext('2d').getImageData(Math.floor(40 * k), Math.floor(88 * k), Math.floor(200 * k), Math.floor(22 * k)).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120) n++; return n;
    });
    ok(dark > 30, 'nessun testo visibile nel campo: ' + dark);
  });
  await t('riaprendo, i campi mostrano i valori salvati e si possono cambiare (togliere la spunta, scegliere M)', async () => {
    await page.waitForSelector('[data-pdf-form]:not([hidden])');
    await page.click('[data-pdf-form]'); await page.waitForSelector('[data-fld="nome"]');
    eq(await page.locator('[data-fld="nome"]').inputValue(), 'Mario Rossi è Łódź');
    ok(await page.locator('[data-fld="accetto"].on').count() === 1); ok(await page.locator('[data-fld="sesso"][data-val="1"].on').count() === 1);
    eq(await page.locator('[data-fld="citta"]').inputValue(), 'Milano');
    await page.click('[data-fld="accetto"]'); await page.click('[data-fld="sesso"][data-val="0"]');
    ok(await page.locator('[data-fld="sesso"].on').count() === 1, 'una sola scelta alla volta');
    await page.click('[data-form-save]');
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill') && !document.querySelector('.pdf-tools.on'));
    await page.waitForSelector('.pdf-page canvas'); await page.waitForTimeout(500);
    const v = await values(); eq(v.accetto, false); eq(v.sesso, 'M'); eq(v.nome, 'Mario Rossi è Łódź');
  });
  await t('con campi modificati e non salvati, «Gestisci pagine» chiede prima di salvare', async () => {
    await page.click('[data-pdf-form]'); await page.waitForSelector('[data-fld="nome"]');
    await page.fill('[data-fld="nome"]', 'Altro');
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="pages"]');
    await page.waitForFunction(() => /salva le annotazioni/i.test((document.querySelector('.toast') || {}).innerText || ''));
  });
  await t('uscendo dal lettore con campi compilati, i valori vengono salvati comunque', async () => {
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('.pdf-body'));
    await page.waitForFunction(() => /Annotazioni salvate/.test((document.querySelector('.toast') || {}).innerText || ''));
    await page.waitForTimeout(600);
    eq((await values()).nome, 'Altro');
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
