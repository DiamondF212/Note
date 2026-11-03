// Test end-to-end della creazione di PDF nuovi. Esecuzione: node tests/pdf_new.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
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
const col = (a, b, m) => ok(a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 3), (m || 'colore') + ' atteso [' + b + '] ottenuto [' + a + ']'); // il JPEG cambia di poco i colori
const near = (a, b, m) => ok(Math.abs(a - b) < 0.5, (m || '') + ' atteso ' + b + ' ottenuto ' + a);

(async () => {
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

  // immagini di prova generate nel browser: larga rossa (con trasparenza a sinistra), alta blu, e un file non valido
  const png = (w, h, color, alphaLeft) => page.evaluate(async ([w, h, color, alphaLeft]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(alphaLeft ? w / 2 : 0, 0, alphaLeft ? w / 2 : w, h);
    const b = await new Promise((r) => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, [w, h, color, alphaLeft]).then((a) => Buffer.from(a));
  const WIDE = await png(400, 200, '#ff0000', false), TALL = await png(200, 400, '#0000ff', false), HALF = await png(400, 200, '#ff0000', true);

  const startNew = async (which) => { await page.click('.docs-plus'); await page.click('.sheet [data-new="pdf"]'); await page.click('.sheet [data-pdfnew="' + which + '"]'); };
  const closeReader = async () => { await page.waitForSelector('.pdf-page canvas'); await page.goBack().catch(() => {}); };
  const lastDoc = () => page.evaluate(() => { const s = N.docs._state.docs.slice().sort((a, b) => b.created - a.created)[0]; return { id: s.id, name: s.name, size: s.size }; });
  // pagine del PDF salvato: dimensioni e colore del pixel al centro
  const inspect = (id) => page.evaluate(async (id) => {
    const full = await N.db.docs.get(id);
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(full.data.slice(0)) }).promise; const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i); const vp = p.getViewport({ scale: 1 });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const px = (x, y) => Array.from(c.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data).slice(0, 3);
      out.push({ w: vp.width, h: vp.height, center: px(vp.width / 2, vp.height / 2), left: px(vp.width * 0.3, vp.height / 2), corner: px(2, 2) });
    }
    return out;
  }, id);
  const setFiles = (files) => page.locator('input[data-img-input]').setInputFiles(files);

  await t('Il menu «Nuovo PDF» offre pagine vuote e immagini', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-new="pdf"]');
    eq(await page.locator('.sheet [data-pdfnew]').count(), 2);
    await page.goBack();
  });

  await t('Pagine vuote: valori predefiniti = 1 pagina A4 verticale, si apre nel lettore', async () => {
    await page.waitForSelector('.docs-screen');
    await startNew('blank'); await page.waitForSelector('.sheet [data-create]');
    eq(await page.inputValue('.sheet [data-new-name]'), 'Nuovo PDF');
    await page.click('.sheet [data-create]');
    await page.waitForSelector('.pdf-page canvas');
    const d = await lastDoc(); eq(d.name, 'Nuovo PDF');
    const pg = await inspect(d.id); eq(pg.length, 1); near(pg[0].w, 595.28); near(pg[0].h, 841.89);
    eq(JSON.stringify(pg[0].center), '[255,255,255]', 'pagina bianca');
  });

  await t('Pagine vuote: Letter orizzontale, 3 pagine, nome scelto', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await startNew('blank'); await page.waitForSelector('.sheet [data-create]');
    await page.fill('.sheet [data-new-name]', 'Verbale');
    await page.click('.sheet [data-seg="fmt"] [data-v="letter"]');
    await page.click('.sheet [data-seg="orient"] [data-v="true"]');
    await page.click('.sheet [data-step="1"]'); await page.click('.sheet [data-step="1"]');
    eq(await page.innerText('.sheet [data-count]'), '3');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    const d = await lastDoc(); eq(d.name, 'Verbale');
    const pg = await inspect(d.id); eq(pg.length, 3);
    pg.forEach((p) => { near(p.w, 792); near(p.h, 612); });
  });

  await t('Il contatore pagine sta fra 1 e 100', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await startNew('blank'); await page.waitForSelector('.sheet [data-create]');
    await page.click('.sheet [data-step="-1"]'); eq(await page.innerText('.sheet [data-count]'), '1');
    for (let i = 0; i < 105; i++) await page.click('.sheet [data-step="1"]');
    eq(await page.innerText('.sheet [data-count]'), '100');
    await page.goBack();
  });

  await t('Due documenti con lo stesso nome ricevono «(2)»', async () => {
    await startNew('blank'); await page.waitForSelector('.sheet [data-create]');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    eq((await lastDoc()).name, 'Nuovo PDF (2)');
  });

  await t('Il PDF creato resta in archivio, riapribile e con dimensione registrata', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    ok(await page.locator('.docrow:has-text("Verbale")').count() === 1);
    await page.locator('.docrow:has-text("Verbale") .docmain').click(); await page.waitForSelector('.pdf-page canvas');
    const d = await page.evaluate(() => N.docs._state.docs.find((x) => x.name === 'Verbale').size); ok(d > 300, 'size ' + d);
    await page.goBack(); await page.waitForSelector('.docs-screen');
  });

  await t('Da immagini: senza file il pulsante Crea è disattivato', async () => {
    await startNew('images'); await page.waitForSelector('.sheet [data-create]');
    ok(await page.locator('.sheet [data-create]').isDisabled());
  });

  await t('Da immagini (A4): una pagina per immagine, orientamento e colori giusti, nome dal file', async () => {
    await setFiles([{ name: 'larga.png', mimeType: 'image/png', buffer: WIDE }, { name: 'alta.png', mimeType: 'image/png', buffer: TALL }]);
    await page.waitForSelector('.sheet [data-img="1"]');
    await page.fill('.sheet [data-new-name]', 'Foto');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    const d = await lastDoc(); eq(d.name, 'Foto');
    const pg = await inspect(d.id); eq(pg.length, 2);
    near(pg[0].w, 841.89); near(pg[0].h, 595.28, 'pagina 1 orizzontale');
    near(pg[1].w, 595.28); near(pg[1].h, 841.89, 'pagina 2 verticale');
    col(pg[0].center, [255, 0, 0]); col(pg[1].center, [0, 0, 255]);
    eq(JSON.stringify(pg[0].corner), '[255,255,255]', 'margine bianco');
  });

  await t('Da immagini: si può cambiare l’ordine e togliere un’immagine', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await startNew('images'); await setFiles([{ name: 'larga.png', mimeType: 'image/png', buffer: WIDE }, { name: 'alta.png', mimeType: 'image/png', buffer: TALL }, { name: 'extra.png', mimeType: 'image/png', buffer: WIDE }]);
    await page.waitForSelector('.sheet [data-img="2"]');
    await page.locator('.sheet [data-img="1"] [aria-label="Sposta su"]').click();
    eq(await page.locator('.sheet [data-img="0"] b').innerText(), '1. alta.png');
    await page.locator('.sheet [data-img="2"] [aria-label="Togli"]').click();
    eq(await page.locator('.sheet [data-img]').count(), 2);
    await page.fill('.sheet [data-new-name]', 'Ordine');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    const pg = await inspect((await lastDoc()).id); eq(pg.length, 2);
    col(pg[0].center, [0, 0, 255]); col(pg[1].center, [255, 0, 0]);
  });

  await t('Da immagini («Come l’immagine»): pagina con le proporzioni dell’immagine, senza margine; trasparenza → bianco', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await startNew('images'); await setFiles([{ name: 'meta.png', mimeType: 'image/png', buffer: HALF }]);
    await page.waitForSelector('.sheet [data-img="0"]');
    eq(await page.inputValue('.sheet [data-new-name]'), 'meta', 'nome dal file');
    await page.click('.sheet [data-seg="mode"] [data-v="fit"]');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    const pg = await inspect((await lastDoc()).id); eq(pg.length, 1);
    near(pg[0].w / pg[0].h, 2); near(Math.max(pg[0].w, pg[0].h), 842);
    eq(JSON.stringify(pg[0].left), '[255,255,255]', 'parte trasparente = bianca');
    eq(JSON.stringify(pg[0].corner), '[255,255,255]');
    col(pg[0].center, [255, 0, 0], 'parte rossa');
  });

  await t('Da immagini: un file non valido viene saltato con avviso, gli altri restano', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await startNew('images'); await setFiles([{ name: 'rotto.png', mimeType: 'image/png', buffer: Buffer.from('non sono un’immagine') }, { name: 'ok.png', mimeType: 'image/png', buffer: TALL }]);
    await page.waitForSelector('.sheet [data-img="1"]');
    await page.fill('.sheet [data-new-name]', 'Misto');
    await page.click('.sheet [data-create]'); await page.waitForSelector('.pdf-page canvas');
    eq((await inspect((await lastDoc()).id)).length, 1);
    await page.waitForSelector('.toast:has-text("saltata")');
  });

  await t('Da immagini: se nessuna è leggibile non crea nulla e mostra l’errore', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    const before = await page.evaluate(() => N.docs._state.docs.length);
    await startNew('images'); await setFiles([{ name: 'rotto.png', mimeType: 'image/png', buffer: Buffer.from('xxx') }]);
    await page.waitForSelector('.sheet [data-img="0"]');
    await page.click('.sheet [data-create]');
    await page.waitForSelector('.toast:has-text("Impossibile creare")');
    eq(await page.evaluate(() => N.docs._state.docs.length), before);
    ok(!(await page.locator('.sheet [data-create]').isDisabled()), 'il pulsante torna attivo');
    await page.goBack();
  });

  await t('Il PDF da immagini si riapre e ha 2 pagine nel file', async () => {
    await page.waitForSelector('.docs-screen');
    await page.locator('.docrow:has-text("Foto") .docmain').click(); await page.waitForSelector('.pdf-page canvas');
    const t1 = await page.evaluate(async () => { const d = N.docs._state.docs.find((x) => x.name === 'Foto'); const full = await N.db.docs.get(d.id); await N.docs.api.lib('pdflib'); const doc = await PDFLib.PDFDocument.load(full.data); return doc.getPageCount(); });
    eq(t1, 2);
    await page.goBack();
  });

  await t('Nessuna richiesta esterna e nessun errore in console', async () => {
    eq(external.join(','), ''); const real = errors.filter((e) => !/could not be decoded|nessuna immagine leggibile|buildFromImages|pdf_new\.js/.test(e)); eq(real.join(' | '), '');
  });

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
