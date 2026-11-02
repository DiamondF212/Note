// Test end-to-end di firma e testo nuovo nel lettore PDF. Esecuzione: node tests/pdf_sign.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const { PDFDocument, StandardFonts, degrees } = require(path.join(root, 'vendor/pdf-lib.min.js'));
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

async function makePdf(rotate) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const p = doc.addPage([400, 560]);
    p.drawText('Pagina ' + i, { x: 40, y: 500, size: 24, font });
    if (rotate) p.setRotation(degrees(rotate));
  }
  return Buffer.from(await doc.save());
}

(async () => {
  const PDF = await makePdf(0), ROT = await makePdf(90);
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
    { name: 'Modulo.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'Girato.pdf', mimeType: 'application/pdf', buffer: ROT }
  ]);
  await page.waitForSelector('.docrow:nth-child(2)');
  const openDoc = async (name) => { await page.locator('.docrow:has-text("' + name + '") .docmain').click(); await page.waitForSelector('.pdf-page canvas'); };
  const docSize = (name) => page.evaluate((n) => N.docs._state.docs.find((d) => d.name === n).size, name);
  const objs = () => page.locator('.pdf-obj').count();
  const box = (sel) => page.locator(sel).first().boundingBox();
  // posizione dell'oggetto in unità pagina (400×560), letta dagli stili in percentuale
  const objBase = (sel) => page.locator(sel).first().evaluate((e) => ({ x: parseFloat(e.style.left) * 4, y: parseFloat(e.style.top) * 5.6, w: e.style.width ? parseFloat(e.style.width) * 4 : 0 }));
  const addText = async (txt) => {
    await page.click('[data-ins-text]'); await page.waitForSelector('[data-txt-input]');
    await page.fill('[data-txt-input]', txt); await page.click('[data-txt-done]');
    await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
  };
  // PDF salvato → testo e posizioni letti con pdf.js dentro la pagina
  const exportBytes = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="export"]'); })()]);
    return fs.readFileSync(await dl.path());
  };
  const pdfText = (buf, pageNo) => page.evaluate(async ({ b64, pageNo }) => {
    const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const pdf = await pdfjsLib.getDocument({ data: u, cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: 'vendor/pdfjs/standard_fonts/' }).promise;
    const pg = await pdf.getPage(pageNo), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    return tc.items.filter((i) => i.str.trim()).map((i) => { const m = pdfjsLib.Util.transform(vp.transform, i.transform); return { str: i.str, x: m[4], y: m[5], a: m[1], h: Math.hypot(m[2], m[3]) }; });
  }, { b64: buf.toString('base64'), pageNo });

  await openDoc('Modulo');

  await t('la barra «Firma e testo» si apre e «Salva» è spento senza oggetti', async () => {
    await page.click('[data-pdf-insert]'); await page.waitForSelector('.pdf-ins.on');
    ok(await page.locator('[data-ins-save]').isDisabled());
    eq(await objs(), 0);
  });
  await t('testo: «Aggiungi» resta bloccato se il testo è vuoto', async () => {
    await page.click('[data-ins-text]'); await page.waitForSelector('[data-txt-input]');
    await page.click('[data-txt-done]');
    ok(await page.locator('[data-txt-input]').count() === 1, 'la finestra doveva restare aperta');
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    eq(await objs(), 0);
  });
  await t('testo: aggiungo «Ciao è già più» → compare sulla pagina, selezionato, con «Salva» acceso', async () => {
    await addText('Ciao è già più');
    eq(await objs(), 1);
    ok(await page.locator('.pdf-obj.sel[data-obj="text"]').innerText().then((s) => s === 'Ciao è già più'));
    ok(!(await page.locator('[data-ins-save]').isDisabled()));
  });
  await t('testo: trascinandolo si sposta (e resta dentro la pagina)', async () => {
    const b0 = await box('.pdf-obj'), pb = await box('.pdf-page[data-page="1"]');
    await page.mouse.move(b0.x + 10, b0.y + b0.height / 2); await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(b0.x + 10 + 10 * k, b0.y + b0.height / 2 + 12 * k);
    await page.mouse.up();
    const b1 = await box('.pdf-obj');
    near(b1.x - b0.x, 60, 3, 'spostamento orizzontale'); near(b1.y - b0.y, 72, 3, 'spostamento verticale');
    // tirato fuori a sinistra: si ferma al bordo
    await page.mouse.move(b1.x + 10, b1.y + b1.height / 2); await page.mouse.down();
    await page.mouse.move(b1.x - 400, b1.y + b1.height / 2, { steps: 5 }); await page.mouse.up();
    const b2 = await box('.pdf-obj'); ok(b2.x >= pb.x - 1, 'uscito dalla pagina');
  });
  await t('testo: la maniglia in basso lo ingrandisce', async () => {
    const fs0 = await page.locator('.pdf-obj').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const hb = await box('[data-obj-resize]');
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(hb.x + 90, hb.y + hb.height / 2, { steps: 5 }); await page.mouse.up();
    const fs1 = await page.locator('.pdf-obj').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    ok(fs1 > fs0 * 1.3, 'corpo ' + fs0 + '→' + fs1);
  });
  await t('testo: la matita lo modifica (testo, grassetto, colore)', async () => {
    await page.click('[data-obj-edit]'); await page.waitForSelector('[data-txt-input]');
    await page.fill('[data-txt-input]', 'Riga uno\nRiga due'); await page.click('[data-txt-bold]'); await page.click('[data-txt-color="#e53935"]');
    await page.click('[data-txt-done]'); await page.waitForFunction(() => !document.querySelector('[data-txt-input]'));
    eq(await objs(), 1);
    const st = await page.locator('.pdf-obj').evaluate((e) => ({ t: e.innerText, w: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color }));
    eq(st.t, 'Riga uno\nRiga due'); eq(st.w, '700'); eq(st.c, 'rgb(229, 57, 53)');
  });
  await t('testo: il cestino lo elimina; «Salva» torna spento', async () => {
    await page.click('[data-obj-del]'); eq(await objs(), 0);
    ok(await page.locator('[data-ins-save]').isDisabled());
  });
  await t('firma: la prima volta si apre il riquadro; «Usa» è spento finché non si disegna', async () => {
    await page.click('[data-ins-sig]'); await page.waitForSelector('[data-sig-pad]');
    ok(await page.locator('[data-sig-use]').isDisabled());
  });
  await t('firma: disegno, «Cancella» svuota, ridisegno e «Usa» la mette sulla pagina e la salva sul telefono', async () => {
    await page.waitForTimeout(800); // la finestra sale con un'animazione
    const draw = async (pts) => { const b = await box('[data-sig-pad]'); await page.mouse.move(b.x + b.width * pts[0][0], b.y + b.height * pts[0][1]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(b.x + b.width * p[0], b.y + b.height * p[1], { steps: 3 }); await page.mouse.up(); };
    await draw([[0.1, 0.5], [0.3, 0.2]]); ok(!(await page.locator('[data-sig-use]').isDisabled()));
    await page.click('[data-sig-clear]'); ok(await page.locator('[data-sig-use]').isDisabled());
    eq(await page.locator('[data-sig-pad] path:not(.pdf-padline)').count(), 0);
    await draw([[0.1, 0.6], [0.2, 0.2], [0.3, 0.7], [0.45, 0.25], [0.6, 0.65], [0.85, 0.3]]);
    await draw([[0.1, 0.75], [0.9, 0.75]]);
    await page.click('[data-sig-use]');
    await page.waitForSelector('.pdf-obj[data-obj="sig"]');
    eq(await objs(), 1);
    const sig = await page.evaluate(() => N.db.getMeta('signature'));
    ok(sig && sig.strokes.length === 2 && sig.ar > 1, 'firma non salvata: ' + JSON.stringify(sig).slice(0, 80));
  });
  await t('firma: trascinabile e ridimensionabile mantenendo le proporzioni', async () => {
    const b0 = await box('.pdf-obj');
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
    await page.mouse.move(b0.x + b0.width / 2 - 20, b0.y + b0.height / 2 - 90, { steps: 5 }); await page.mouse.up();
    const b1 = await box('.pdf-obj'); near(b1.y - b0.y, -90, 3); near(b1.x - b0.x, -20, 3);
    const hb = await box('[data-obj-resize]');
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
    await page.mouse.move(hb.x + 40, hb.y + hb.height / 2, { steps: 4 }); await page.mouse.up();
    const b2 = await box('.pdf-obj');
    ok(b2.width > b1.width + 20, 'non si è allargata');
    near(b2.width / b2.height, b1.width / b1.height, 0.05, 'proporzioni');
  });
  await t('firma: la volta dopo il pulsante offre «Usa la firma salvata»', async () => {
    await page.click('[data-ins-sig]'); await page.waitForSelector('[data-sig-place]');
    ok(await page.locator('[data-sig-prev] path').count() >= 2, 'anteprima vuota');
    await page.click('[data-sig-place]');
    await page.waitForFunction(() => document.querySelectorAll('.pdf-obj[data-obj="sig"]').length === 2);
    await page.click('[data-obj-del]'); eq(await objs(), 1);
  });
  await t('firma + testo sulla stessa pagina: «Salva» li scrive nel PDF e riapre il lettore', async () => {
    await addText('Firmato a Roma, è già così');
    eq(await objs(), 2);
    // sposto il testo in un punto noto: sotto la firma, a sinistra
    const tb = await box('.pdf-obj[data-obj="text"]'), pb = await box('.pdf-page[data-page="1"]');
    await page.mouse.move(tb.x + 8, tb.y + tb.height / 2); await page.mouse.down();
    await page.mouse.move(pb.x + 30, pb.y + pb.height * 0.8, { steps: 6 }); await page.mouse.up();
    page.__want = await objBase('.pdf-obj[data-obj="text"]');
    page.__sig = await objBase('.pdf-obj[data-obj="sig"]');
    const before = await docSize('Modulo');
    await page.click('[data-ins-save]');
    await page.waitForFunction(() => /Annotazioni salvate/.test((document.querySelector('.toast') || {}).innerText || ''));
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    ok((await docSize('Modulo')) > before, 'file non cambiato');
    eq(await objs(), 0, 'gli oggetti devono essere dentro il PDF');
  });
  await t('PDF salvato: il testo c’è, con accenti, nel punto e nella dimensione scelti', async () => {
    const buf = await exportBytes();
    const items = await pdfText(buf, 1);
    const it = items.find((i) => /Firmato a Roma/.test(i.str));
    ok(it, 'testo non trovato: ' + JSON.stringify(items.map((i) => i.str)));
    ok(/è già così/.test(it.str), 'accenti persi: ' + it.str);
    const w = page.__want;
    near(it.x, w.x, 1.5, 'x'); near(it.y, w.y + it.h * 0.9465, 2, 'linea di base'); near(it.a, 0, 0.01, 'inclinazione');
    ok(it.h > 5, 'corpo troppo piccolo');
    eq((await PDFDocument.load(buf)).getPageCount(), 2);
  });
  await t('PDF salvato: la firma si vede (pixel blu scuro) vicino alla posizione scelta, il testo non è sparito', async () => {
    await page.waitForTimeout(500);
    const r = await page.locator('.pdf-page[data-page="1"] canvas').evaluate((c, s) => {
      const k = c.width / 400, d = c.getContext('2d').getImageData(Math.floor(s.x * k), Math.floor(s.y * k), Math.ceil(s.w * k), Math.ceil(s.w * k * 0.6)).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 60 && d[i + 1] < 70 && d[i + 2] > 70 && d[i + 2] < 160) n++;
      return n;
    }, page.__sig);
    ok(r > 150, 'firma non visibile nel PDF: ' + r + ' pixel');
  });
  await t('uscendo senza «Salva» testo e firma vengono salvati comunque', async () => {
    await page.click('[data-pdf-insert]');
    await addText('Uscita automatica');
    eq(await objs(), 1);
    const before = await docSize('Modulo');
    await page.goBack();
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Modulo').size > b, before);
    await page.waitForFunction(() => !document.querySelector('.pdf-body'));
    await openDoc('Modulo'); await page.click('button[aria-label="Altro"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-act="export"]')]);
    const items = await pdfText(fs.readFileSync(await dl.path()), 1);
    ok(items.some((i) => /Uscita automatica/.test(i.str)), 'testo non salvato');
  });
  await t('testo con caratteri che il font non ha: non blocca il salvataggio (diventano «?»)', async () => {
    await page.click('[data-pdf-insert]');
    await addText('Ok 😀 fine');
    const before = await docSize('Modulo');
    await page.click('[data-ins-save]');
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Modulo').size > b, before);
    await page.waitForFunction(() => !document.querySelector('.pdf-ins.on') && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    const items = await pdfText(await exportBytes(), 1);
    ok(items.some((i) => /Ok \?+ fine/.test(i.str)), JSON.stringify(items.map((i) => i.str)));
  });
  await t('pagina ruotata di 90°: il testo si legge dritto e nel punto scelto', async () => {
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('.pdf-body'));
    await openDoc('Girato');
    await page.click('[data-pdf-insert]'); await addText('Dritto');
    const o = await page.locator('.pdf-obj').evaluate((e) => ({ l: parseFloat(e.style.left), t: parseFloat(e.style.top), pg: +e.closest('.pdf-page').dataset.page }));
        const before = await docSize('Girato');
    await page.click('[data-ins-save]');
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Girato').size > b, before);
    await page.waitForFunction(() => !document.querySelector('.pdf-ins.on') && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    const items = await pdfText(await exportBytes(), o.pg);
    const it = items.find((i) => i.str === 'Dritto'); ok(it, 'testo non trovato: ' + JSON.stringify(items));
    near(it.a, 0, 0.01, 'il testo deve restare orizzontale sullo schermo');
    // la pagina ruotata è larga 560 e alta 400 (unità pagina)
    near(it.x, o.l / 100 * 560, 2, 'x'); near(it.y - it.h * 0.9465, o.t / 100 * 400, 2, 'y');
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
