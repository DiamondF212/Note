// Test end-to-end della correzione del testo («copri e riscrivi») nel lettore PDF. Esecuzione: node tests/pdf_fix.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const { PDFDocument, StandardFonts, rgb, degrees } = require(path.join(root, 'vendor/pdf-lib.min.js'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 14).join('\n       ')); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };
const near = (a, b, tol, m) => { if (Math.abs(a - b) > tol) throw new Error((m || '') + ' atteso ≈' + b + ' (±' + tol + ') ottenuto ' + a); };

const OLD = 'Importo: 100 euro', NEW = 'Totale 5';
// Pagina 1: riga su fondo giallo + riga su fondo bianco. Pagina 2: scritta in verticale sullo schermo (non correggibile).
async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([400, 560]);
  p1.drawRectangle({ x: 20, y: 480, width: 360, height: 50, color: rgb(1, 0.976, 0.769) });
  p1.drawText(OLD, { x: 40, y: 500, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  p1.drawText('Seconda riga di prova', { x: 40, y: 400, size: 14, font });
  const p2 = doc.addPage([400, 560]);
  p2.drawText('Pagina girata', { x: 40, y: 500, size: 18, font });
  p2.setRotation(degrees(90));
  // Pagina 3: girata di 90°, ma la scritta è ruotata in senso opposto, quindi sullo schermo si legge dritta
  const p3 = doc.addPage([400, 560]);
  p3.drawText('Girato dritto', { x: 100, y: 60, size: 18, font, rotate: degrees(90) });
  p3.setRotation(degrees(90));
  return Buffer.from(await doc.save());
}

(async () => {
  const PDF = await makePdf();
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
  await page.click('.dock button:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
  await page.click('.docs-plus'); await page.click('.sheet [data-import]');
  await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Fattura.pdf', mimeType: 'application/pdf', buffer: PDF }]);
  await page.waitForSelector('.docrow');
  await page.locator('.docrow:has-text("Fattura") .docmain').click(); await page.waitForSelector('.pdf-page canvas');
  const docSize = () => page.evaluate(() => N.docs._state.docs.find((d) => d.name === 'Fattura').size);
  const box = (sel) => page.locator(sel).first().boundingBox();
  const toastText = () => page.evaluate(() => (document.querySelector('.toast') || {}).innerText || '');
  // tocco su un punto della pagina, dato in unità pagina (400×560, origine in alto a sinistra)
  const tapAt = async (pageNo, x, y) => {
    const pb = await box('.pdf-page[data-page="' + pageNo + '"]'), sc = pb.width / 400;
    await page.mouse.click(pb.x + x * sc, pb.y + y * sc);
  };
  const exportBytes = async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="export"]'); })()]);
    return fs.readFileSync(await dl.path());
  };
  // PDF salvato → testo (con posizioni) e pixel di una zona, letti con pdf.js dentro la pagina
  const inspect = (buf, pageNo, zone) => page.evaluate(async ({ b64, pageNo, zone }) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: u, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/pdfjs/standard_fonts/' }).promise;
    const pg = await pdf.getPage(pageNo), S = 2, vp = pg.getViewport({ scale: S }), vp1 = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    const items = tc.items.filter((i) => i.str.trim()).map((i) => { const m = pdfjsLib.Util.transform(vp1.transform, i.transform); return { str: i.str, x: m[4], y: m[5], w: i.width }; });
    const c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgb(255,255,255)' }).promise;
    let out = null;
    if (zone) {
      const d = c.getContext('2d').getImageData(Math.round(zone.x * S), Math.round(zone.y * S), Math.round(zone.w * S), Math.round(zone.h * S)).data;
      let dark = 0, r = 0, g = 0, b = 0, n = d.length / 4;
      for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; if (d[k] + d[k + 1] + d[k + 2] < 330) dark++; }
      out = { dark, r: r / n, g: g / n, b: b / n };
    }
    return { items, px: out };
  }, { b64: buf.toString('base64'), pageNo, zone });

  await t('la barra «Firma e testo» ha il pulsante «Correggi»; la correzione non parte da sola', async () => {
    await page.click('[data-pdf-insert]'); await page.waitForSelector('.pdf-ins.on [data-ins-fix]');
    await tapAt(1, 60, 55);
    await page.waitForTimeout(300);
    eq(await page.locator('[data-txt-input]').count(), 0); eq(await page.locator('.pdf-obj').count(), 0);
  });
  await t('«Correggi» + tocco su una riga: si apre la finestra col testo già scritto e l’avviso sul testo che resta', async () => {
    await page.click('[data-ins-fix]');
    await page.waitForFunction(() => /Tocca la riga/.test((document.querySelector('.toast') || {}).innerText || ''));
    await tapAt(1, 60, 55);                                   // la riga sta a y = 560 − 500 = 60, il tocco è un po’ sopra la linea di base
    await page.waitForSelector('[data-txt-input]');
    await page.waitForTimeout(800);
    eq(await page.inputValue('[data-txt-input]'), OLD);
    ok(await page.locator('[data-fix-hint]').count() === 1, 'manca l’avviso');
    const bgs = await page.locator('[data-fix-bg]').evaluateAll((l) => l.map((e) => e.dataset.fixBg));
    ok(bgs.includes('#fff9c4'), 'sfondo giallo non riconosciuto: ' + bgs);
    ok(bgs.includes('#ffffff'), 'manca il bianco');
    eq(await page.locator('.pdf-body.fixing').count(), 0, 'la modalità deve spegnersi dopo il tocco');
  });
  await t('«Applica»: compare il riquadro giallo e il testo nuovo nello stesso punto, stesso corpo', async () => {
    await page.fill('[data-txt-input]', NEW); await page.click('[data-txt-done]');
    await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    eq(await page.locator('.pdf-cover').count(), 1); eq(await page.locator('.pdf-obj[data-obj="text"]').count(), 1);
    eq(await page.locator('.pdf-cover').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgb(255, 249, 196)');
    const o = await page.locator('.pdf-obj').evaluate((e) => ({ x: parseFloat(e.style.left) * 4, y: parseFloat(e.style.top) * 5.6, t: e.innerText }));
    eq(o.t, NEW); near(o.x, 40, 0.6, 'x'); near(o.y, 60 - 18 * 0.9465, 1, 'y');
    const fsz = await page.locator('.pdf-obj').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)), pb = await box('.pdf-page[data-page="1"]');
    near(fsz, 18 * pb.width / 400, 0.6, 'corpo del testo');
    ok(!(await page.locator('[data-ins-save]').isDisabled()), '«Salva» doveva accendersi');
  });
  await t('il riquadro copre davvero il testo vecchio sullo schermo (stessa posizione della riga originale)', async () => {
    const cv = await box('.pdf-cover'), pb = await box('.pdf-page[data-page="1"]'), sc = pb.width / 400;
    near((cv.x - pb.x) / sc, 40 - 1.08, 0.5, 'bordo sinistro'); ok(cv.width / sc > 120, 'troppo stretto: ' + cv.width / sc);
    near((cv.y - pb.y) / sc, 60 - 0.85 * 18, 1, 'bordo alto'); near(cv.height / sc, 1.07 * 18, 1, 'altezza');
  });
  await t('toccare l’oggetto non riapre la correzione; la matita modifica il testo e il riquadro resta', async () => {
    await page.click('[data-obj-edit]'); await page.waitForSelector('[data-txt-input]');
    eq(await page.inputValue('[data-txt-input]'), NEW);
    ok(await page.locator('[data-fix-bg]').count() >= 2, 'manca la scelta dello sfondo');
    await page.click('[data-txt-bold]'); await page.click('[data-txt-done]'); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    eq(await page.locator('.pdf-cover').count(), 1); eq(await page.locator('.pdf-obj').evaluate((e) => getComputedStyle(e).fontWeight), '700');
  });
  await t('il cestino toglie testo e riquadro insieme; «Salva» torna spento', async () => {
    await page.click('[data-obj-del]');
    eq(await page.locator('.pdf-cover').count(), 0); eq(await page.locator('.pdf-obj').count(), 0);
    ok(await page.locator('[data-ins-save]').isDisabled());
  });
  await t('tocco lontano da ogni testo: avviso, nessuna finestra, la modalità resta accesa', async () => {
    await page.click('[data-ins-fix]');
    await tapAt(1, 200, 250);
    await page.waitForFunction(() => /Qui non c/.test((document.querySelector('.toast') || {}).innerText || ''));
    eq(await page.locator('[data-txt-input]').count(), 0); eq(await page.locator('.pdf-body.fixing').count(), 1);
  });
  await t('pagina girata (testo verticale sullo schermo): avviso onesto, nessuna correzione', async () => {
    await page.evaluate(() => document.querySelector('.pdf-body').scrollTo(0, document.querySelector('.pdf-page[data-page="2"]').offsetTop));
    await page.waitForSelector('.pdf-page[data-page="2"] canvas'); await page.waitForTimeout(400);
    const pb = await box('.pdf-page[data-page="2"]'), sc = pb.width / 560;      // pagina 2 girata: 560 × 400
    await page.mouse.click(pb.x + 60 * sc * (pb.width / 560 > 0 ? 1 : 1), pb.y + 40 * sc);
    await page.waitForFunction(() => /inclinata o verticale|Qui non c/.test((document.querySelector('.toast') || {}).innerText || ''));
    eq(await page.locator('[data-txt-input]').count(), 0); eq(await page.locator('.pdf-obj').count(), 0);
  });
  await t('chiudere la barra spegne la modalità «Correggi»', async () => {
    await page.click('[data-ins-close]');
    eq(await page.locator('.pdf-body.fixing').count(), 0);
    await page.evaluate(() => document.querySelector('.pdf-body').scrollTo(0, 0)); await page.waitForTimeout(300);
  });
  await t('seconda riga (fondo bianco): sfondo bianco, testo nero; il tocco sotto la riga la prende lo stesso', async () => {
    await page.click('[data-pdf-insert]'); await page.click('[data-ins-fix]');
    await tapAt(1, 70, 163);                                    // riga a y = 160; tocco 3 unità sotto la linea di base
    await page.waitForSelector('[data-txt-input]'); await page.waitForTimeout(800);
    eq(await page.inputValue('[data-txt-input]'), 'Seconda riga di prova');
    const bgs = await page.locator('[data-fix-bg]').evaluateAll((l) => l.map((e) => e.dataset.fixBg));
    eq(bgs.join(','), '#ffffff');
    await page.fill('[data-txt-input]', 'Seconda riga'); await page.click('[data-txt-done]'); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    eq(await page.locator('.pdf-cover').count(), 1);
    await page.click('[data-obj-del]');
  });
  await t('salvataggio: il vecchio testo non si vede più, il nuovo è nel punto giusto, lo sfondo giallo è intatto', async () => {
    await page.click('[data-ins-fix]'); await tapAt(1, 60, 55);
    await page.waitForSelector('[data-txt-input]'); await page.waitForTimeout(800);
    await page.fill('[data-txt-input]', NEW); await page.click('[data-txt-done]'); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    const before = await docSize();
    await page.click('[data-ins-save]');
    await page.waitForFunction(() => /Annotazioni salvate/.test((document.querySelector('.toast') || {}).innerText || ''));
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    ok((await docSize()) !== before, 'il file non è cambiato');
    // coda del vecchio testo, oltre la fine del nuovo (≈ 40 + 62 = 102): dev’essere tutta gialla, senza pixel scuri
    const r = await inspect(await exportBytes(), 1, { x: 125, y: 50, w: 100, h: 18 });
    const it = r.items.find((i) => i.str === NEW); ok(it, 'testo nuovo non trovato: ' + JSON.stringify(r.items));
    near(it.x, 40, 0.6, 'x'); near(it.y, 60, 1.2, 'linea di base');
    eq(r.px.dark, 0, 'restano pixel scuri del vecchio testo');
    near(r.px.r, 255, 2); near(r.px.g, 249, 2); near(r.px.b, 196, 2);
    ok(r.items.some((i) => i.str === 'Seconda riga di prova'), 'l’altra riga doveva restare intatta');
  });
  await t('dopo il salvataggio la modalità «Correggi» funziona ancora sul file nuovo', async () => {
    await page.click('[data-pdf-insert]'); await page.click('[data-ins-fix]');
    await tapAt(1, 70, 163);
    await page.waitForSelector('[data-txt-input]');
    eq(await page.inputValue('[data-txt-input]'), 'Seconda riga di prova');
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
  });
  await t('pagina girata di 90° con testo dritto sullo schermo: la correzione e il riquadro finiscono nel punto giusto', async () => {
    await page.evaluate(() => document.querySelector('.pdf-body').scrollTo(0, document.querySelector('.pdf-page[data-page="3"]').offsetTop));
    await page.waitForSelector('.pdf-page[data-page="3"] canvas'); await page.waitForTimeout(500);
    await page.click('[data-ins-fix]');
    const pb = await box('.pdf-page[data-page="3"]'), sc = pb.width / 560;      // girata: 560 × 400
    await page.mouse.click(pb.x + 75 * sc, pb.y + 96 * sc);
    await page.waitForSelector('[data-txt-input]'); await page.waitForTimeout(800);
    eq(await page.inputValue('[data-txt-input]'), 'Girato dritto');
    await page.fill('[data-txt-input]', 'Ok'); await page.click('[data-txt-done]'); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    await page.click('[data-ins-save]');
    await page.waitForFunction(() => /Annotazioni salvate/.test((document.querySelector('.toast') || {}).innerText || ''));
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    const r = await inspect(await exportBytes(), 3, { x: 100, y: 85, w: 85, h: 20 });
    const it = r.items.find((i) => i.str === 'Ok'); ok(it, 'testo nuovo non trovato: ' + JSON.stringify(r.items));
    near(it.x, 60, 0.8, 'x'); near(it.y, 100, 1.2, 'linea di base');
    eq(r.px.dark, 0, 'restano pixel scuri del vecchio testo');
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
