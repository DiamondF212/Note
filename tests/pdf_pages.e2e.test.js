// Test end-to-end della gestione pagine PDF. Esecuzione: node tests/pdf_pages.e2e.test.js
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

async function makePdf(label, count) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) {
    const p = doc.addPage([400, 560]);
    p.drawText(label + ' ' + i, { x: 40, y: 500, size: 28, font });
  }
  return Buffer.from(await doc.save());
}

(async () => {
  const A5 = await makePdf('Alfa', 5), B2 = await makePdf('Beta', 2);
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  page.on('dialog', (d) => { if (d.type() === 'prompt') d.accept(page.__promptAnswer || '1'); else d.accept(); });

  await page.goto(base); await page.waitForSelector('#list');
  await page.click('.dock button:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
  await page.click('.docs-plus'); await page.click('.sheet [data-import]');
  await page.locator('input[data-docs-input]').setInputFiles([
    { name: 'Alfa.pdf', mimeType: 'application/pdf', buffer: A5 },
    { name: 'Beta.pdf', mimeType: 'application/pdf', buffer: B2 }
  ]);
  await page.waitForSelector('.docrow:nth-child(2)');

  const openDoc = async (name) => { await page.locator('.docrow:has-text("' + name + '") .docmain').click(); await page.waitForSelector('.pdf-page canvas'); };
  const openManager = async () => { await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="pages"]'); await page.waitForSelector('.pgm-grid .pgm-cell'); };
  const cells = () => page.locator('.pgm-cell').count();
  const nums = () => page.locator('.pgm-cell').evaluateAll((cs) => cs.map((c) => c.getAttribute('data-key')));
  const pick = async (...ns) => { for (const k of ns) await page.locator('.pgm-cell').nth(k - 1).click(); };
  const clearSel = async () => { if (await page.locator('.pgm-cell.sel').count()) { await page.click('[data-pgm-all]'); if (await page.locator('.pgm-cell.sel').count()) await page.click('[data-pgm-all]'); } };
  const info = () => page.locator('[data-pgm-info]').innerText();
  // contenuto vero del PDF salvato: testo e rotazione di ogni pagina
  const content = (name) => page.evaluate(async (nm) => {
    const d = N.docs._state.docs.find((x) => x.name === nm); const full = await N.db.docs.get(d.id);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(full.data.slice(0)) }).promise; const out = [];
    for (let i = 1; i <= pdf.numPages; i++) { const p = await pdf.getPage(i); const t = await p.getTextContent(); out.push(t.items.map((x) => x.str).join(' ') + '|' + p.rotate); }
    return out;
  }, name);
  const waitSaved = async (name, count) => { await page.waitForFunction(({ nm, c }) => document.querySelectorAll('.pgm-grid').length === 0 && document.querySelector('.pdf-pill'), { nm: name, c: count }); await page.waitForSelector('.pdf-page canvas'); };

  await t('«Gestisci pagine» mostra una miniatura per pagina e le disegna (non vuote)', async () => {
    await openDoc('Alfa'); await openManager();
    eq(await cells(), 5);
    await page.waitForFunction(() => document.querySelectorAll('.pgm-thumb canvas').length === 5);
    ok(await page.locator('.pgm-thumb canvas').first().evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 150) return true; return false; }), 'miniatura vuota');
    ok((await info()).startsWith('5 pagine'), await info());
    ok(await page.locator('[data-pgm-save]').isDisabled(), '«Salva» deve essere spento senza modifiche');
    ok(await page.locator('[data-pgm-rot]').isDisabled(), 'senza selezione i pulsanti sono spenti');
  });
  await t('toccando una pagina si seleziona; «Tutte» / «Nessuna» funzionano', async () => {
    await pick(2); ok(await page.locator('.pgm-cell.sel').count() === 1); ok((await info()).includes('1 selezionata'));
    await page.click('[data-pgm-all]'); eq(await page.locator('.pgm-cell.sel').count(), 5);
    await page.click('[data-pgm-all]'); eq(await page.locator('.pgm-cell.sel').count(), 0);
  });
  await t('ruota la pagina 2 di 90° (la miniatura cambia forma) e sposta la 1 dopo la 2', async () => {
    await pick(2); const before = await page.locator('.pgm-cell').nth(1).locator('canvas').evaluate((c) => c.width / c.height);
    await page.click('[data-pgm-rot]');
    await page.waitForFunction((b) => { const c = document.querySelectorAll('.pgm-cell')[1].querySelector('canvas'); return c && Math.abs(c.width / c.height - b) > 0.3; }, before);
    await page.click('[data-pgm-all]'); await page.click('[data-pgm-all]');      // deseleziona tutto
    await pick(1); await page.click('[data-pgm-right]');
    ok(!(await page.locator('[data-pgm-save]').isDisabled()), '«Salva» doveva accendersi');
  });
  await t('elimina la pagina 5 (con conferma) e unisce Beta in fondo: 6 pagine, 2 marcate «Unita»', async () => {
    await page.click('[data-pgm-all]'); await page.click('[data-pgm-all]');
    await pick(5); await page.click('[data-pgm-del]');
    await page.waitForFunction(() => document.querySelectorAll('.pgm-cell').length === 4);
    await page.click('[data-pgm-add]'); await page.click('.sheet [data-pgm-merge]');
    await page.waitForFunction(() => document.querySelectorAll('.pgm-cell').length === 6);
    eq(await page.locator('.pgm-src').count(), 2);
    await page.waitForFunction(() => document.querySelectorAll('.pgm-thumb canvas').length === 6);
  });
  await t('«Salva» scrive il PDF: ordine, rotazione, eliminazione e unione corretti; il lettore si riapre', async () => {
    await page.click('[data-pgm-save]');
    await waitSaved();
    const c = await content('Alfa');
    eq(c.length, 6);
    eq(c.map((x) => x.split('|')[0]).join(' / '), 'Alfa 2 / Alfa 1 / Alfa 3 / Alfa 4 / Beta 1 / Beta 2');
    eq(c.map((x) => x.split('|')[1]).join(','), '90,0,0,0,0,0');
    eq(await page.locator('.pdf-page').count(), 6);
  });
  await t('«Estrai» crea un nuovo PDF con le sole pagine scelte, lasciando l’originale', async () => {
    await openManager(); await pick(3, 4);
    await page.click('[data-pgm-split]'); await page.click('.sheet [data-pgm-extract]');
    await page.waitForFunction(() => N.docs._state.docs.some((d) => /Alfa \(estratto\)/.test(d.name)));
    const c = await content('Alfa (estratto)');
    eq(c.map((x) => x.split('|')[0]).join(' / '), 'Alfa 3 / Alfa 4');
    eq((await content('Alfa')).length, 6);
  });
  await t('«Dividi in PDF da N pagine» crea i pezzi (6 pagine / 4 → 2 file)', async () => {
    await page.click('[data-pgm-split]'); page.__promptAnswer = '4'; await page.click('.sheet [data-pgm-chunk]');
    await page.waitForFunction(() => N.docs._state.docs.some((d) => d.name === 'Alfa (parte 2)'));
    eq((await content('Alfa (parte 1)')).length, 4); eq((await content('Alfa (parte 2)')).length, 2);
    page.__promptAnswer = null;
  });
  await t('uscendo senza salvare le modifiche vengono scartate (con avviso) e il file non cambia', async () => {
    await clearSel(); await pick(1); await page.click('[data-pgm-del]');
    await page.waitForFunction(() => document.querySelectorAll('.pgm-cell').length === 5);
    await page.goBack();
    await page.waitForFunction(() => /scartate/.test((document.querySelector('.toast') || {}).innerText || ''));
    eq((await content('Alfa')).length, 6);
  });
  await t('non si possono eliminare tutte le pagine', async () => {
    await openManager(); await page.click('[data-pgm-all]'); await page.click('[data-pgm-del]');
    await page.waitForFunction(() => /tutte le pagine/.test((document.querySelector('.toast') || {}).innerText || ''));
    eq(await cells(), 6);
    await page.goBack();
  });
  await t('con annotazioni non salvate il lettore chiede prima di salvarle', async () => {
    await page.click('[data-pdf-annot]'); await page.waitForSelector('.pdf-tools.on'); await page.waitForTimeout(800);
    await page.click('[data-ink-pen]');
    const b = await page.locator('.pdf-page').first().boundingBox();
    await page.mouse.move(b.x + 50, b.y + 200); await page.mouse.down(); await page.mouse.move(b.x + 150, b.y + 220, { steps: 5 }); await page.mouse.up();
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="pages"]');
    await page.waitForFunction(() => /salva le annotazioni/i.test((document.querySelector('.toast') || {}).innerText || ''));
    eq(await page.locator('.pgm-grid').count(), 0);
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
