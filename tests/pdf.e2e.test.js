// Test end-to-end del lettore PDF. Esecuzione: node tests/pdf.e2e.test.js
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

// PDF di prova: 12 pagine, ognuna con il proprio numero; parole da cercare sparse nelle pagine.
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([400, 560]);
    p.drawText('Pagina numero ' + i, { x: 40, y: 500, size: 24, font });
    p.drawText(i === 3 || i === 7 ? 'Qui c’è lo Zucchero di canna' : 'Testo normale della pagina', { x: 40, y: 450, size: 14, font });
    if (i === 7) p.drawText('Perché il CAFFÈ è caldo', { x: 40, y: 420, size: 14, font });
    if (i === 12) p.drawText('Fine documento zucchero', { x: 40, y: 400, size: 14, font });
  }
  return Buffer.from(await doc.save());
}
async function makeScan() { // pagina senza testo (come una scansione)
  const doc = await PDFDocument.create(); doc.addPage([300, 400]); return Buffer.from(await doc.save());
}

(async () => {
  const PDF12 = await makePdf(12), SCAN = await makeScan();
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  page.on('dialog', (d) => { if (d.type() === 'prompt') d.accept(page.__promptAnswer || 'x'); else d.accept(); });

  await page.goto(base); await page.waitForSelector('#list');
  await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
  await page.click('.docs-plus'); await page.click('.sheet [data-import]');
  await page.locator('input[data-docs-input]').setInputFiles([
    { name: 'Lungo.pdf', mimeType: 'application/pdf', buffer: PDF12 },
    { name: 'Scansione.pdf', mimeType: 'application/pdf', buffer: SCAN }
  ]);
  await page.waitForSelector('.docrow:nth-child(2)');

  const openDoc = async (name) => { await page.locator('.docrow:has-text("' + name + '") .docmain').click(); await page.waitForSelector('.pdf-page'); };
  const closeViewer = async () => { await page.goBack(); await page.waitForFunction(() => !document.querySelector('.pdf-body')); };
  const pill = () => page.locator('.pdf-pill').innerText();
  const pageWidth = () => page.locator('.pdf-page').first().evaluate((e) => e.getBoundingClientRect().width);
  const renderedPages = () => page.locator('.pdf-page canvas').count();
  const nonBlank = (sel) => page.locator(sel).first().evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) return true; return false; });

  await t('si apre: 12 pagine in struttura e indicatore «1 / 12»', async () => {
    await openDoc('Lungo');
    eq(await page.locator('.pdf-page').count(), 12);
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '1 / 12');
  });
  await t('le pagine vicine sono disegnate e non vuote (c’è del testo nero)', async () => {
    await page.waitForSelector('.pdf-page canvas');
    ok(await nonBlank('.pdf-page canvas'), 'la prima pagina è tutta bianca');
  });
  await t('non tutte le pagine sono disegnate insieme (risparmio memoria)', async () => {
    ok((await renderedPages()) < 12, 'disegnate tutte e 12');
  });
  await t('scorrendo fino in fondo compare l’ultima pagina e il contatore la segue', async () => {
    await page.locator('.pdf-body').evaluate((b) => { b.scrollTop = b.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '12 / 12');
    await page.waitForSelector('.pdf-page[data-page="12"] canvas');
    ok(await nonBlank('.pdf-page[data-page="12"] canvas'));
    ok(await page.locator('.pdf-page[data-page="1"] canvas').count() === 0, 'la pagina 1 doveva essere liberata');
  });
  await t('«Vai a pagina» (tocca l’indicatore) salta alla pagina scelta', async () => {
    page.__promptAnswer = '5';
    await page.click('.pdf-pill');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '5 / 12');
  });
  await t('ricerca: «zucchero» trova 3 risultati (maiuscole ignorate), salta alla pagina 3', async () => {
    await page.locator('.pdf-body').evaluate((b) => { b.scrollTop = 0; });
    await page.click('[data-pdf-search]');
    await page.waitForSelector('.pdf-search.on');
    await page.fill('[data-pdf-q]', 'zucchero');
    await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '1/3');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '3 / 12');
    await page.waitForSelector('.pdf-page[data-page="3"] .pdf-hl i.cur');
  });
  await t('ricerca: «avanti» va alla pagina 7, poi alla 12, poi ricomincia dalla 3', async () => {
    await page.click('[data-pdf-next]'); await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '2/3');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '7 / 12');
    await page.click('[data-pdf-next]'); await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '3/3');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '12 / 12');
    await page.click('[data-pdf-next]'); await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '1/3');
  });
  await t('ricerca: «indietro» dal primo risultato va all’ultimo', async () => {
    await page.click('[data-pdf-prev]'); await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '3/3');
  });
  await t('ricerca senza distinzione di accenti: «perche caffe» trova «Perché il CAFFÈ»', async () => {
    await page.fill('[data-pdf-q]', 'perche il caffe');
    await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '1/1');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '7 / 12');
    ok(await page.locator('.pdf-page[data-page="7"] .pdf-hl i').count() >= 1, 'nessuna evidenziazione');
  });
  await t('ricerca: «è» con l’accento trova anche la «e» senza (e viceversa)', async () => {
    await page.fill('[data-pdf-q]', 'c’è lo');
    await page.waitForFunction(() => /^[12]\/2$/.test(document.querySelector('[data-pdf-count]').textContent));
  });
  await t('ricerca: parola assente mostra «0»', async () => {
    await page.fill('[data-pdf-q]', 'xyzxyz');
    await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '0');
  });
  await t('chiudere la ricerca toglie evidenziazioni e contatore', async () => {
    await page.fill('[data-pdf-q]', 'pagina');
    await page.waitForFunction(() => /\//.test(document.querySelector('[data-pdf-count]').textContent));
    await page.click('[data-pdf-close]');
    await page.waitForFunction(() => !document.querySelector('.pdf-search.on'));
    eq(await page.locator('.pdf-hl i').count(), 0);
    eq(await page.locator('[data-pdf-count]').innerText(), '');
  });
  await t('zoom: «Ingrandisci» allarga le pagine, «Riduci» le restringe, con limiti', async () => {
    const w0 = await pageWidth();
    await page.click('[data-pdf-zoomin]'); await page.waitForFunction((w) => document.querySelector('.pdf-page').getBoundingClientRect().width > w + 5, w0);
    const w1 = await pageWidth(); ok(w1 > w0 * 1.2, 'zoom in poco efficace: ' + w0 + '→' + w1);
    await page.click('[data-pdf-zoomout]'); await page.click('[data-pdf-zoomout]');
    await page.waitForFunction((w) => document.querySelector('.pdf-page').getBoundingClientRect().width < w - 5, w0);
    for (let i = 0; i < 12; i++) await page.click('[data-pdf-zoomout]');
    const wmin = await pageWidth(); ok(wmin >= w0 * 0.5 - 3, 'sotto il minimo: ' + wmin);
    for (let i = 0; i < 20; i++) await page.click('[data-pdf-zoomin]');
    const wmax = await pageWidth(); ok(wmax <= (w0 / 1) * 5 + 5, 'sopra il massimo: ' + wmax);
    ok(await page.locator('.pdf-body').evaluate((b) => b.scrollWidth > b.clientWidth), 'con zoom alto deve poter scorrere di lato');
  });
  await t('dopo lo zoom le pagine visibili vengono ridisegnate nitide e non vuote', async () => {
    await page.waitForSelector('.pdf-page canvas');
    await page.waitForFunction(() => { const c = document.querySelector('.pdf-page canvas'); return c && c.width > 0; });
    ok(await nonBlank('.pdf-page canvas'));
  });
  await t('doppio tocco: porta lo zoom a 2,5× e un secondo doppio tocco torna a 1×', async () => {
    await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list');
    await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
    await openDoc('Lungo');
    await page.waitForSelector('.pdf-page canvas');
    const w = await pageWidth();
    const dtap = () => page.locator('.pdf-body').evaluate(async (b) => {
      const mk = (type, touches) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: touches, changedTouches: touches });
      const tt = new Touch({ identifier: 1, target: b, clientX: 100, clientY: 300 });
      for (let k = 0; k < 2; k++) { b.dispatchEvent(mk('touchstart', [tt])); b.dispatchEvent(mk('touchend', [])); await new Promise((r) => setTimeout(r, 60)); }
    });
    await dtap(); await page.waitForFunction((w0) => document.querySelector('.pdf-page').getBoundingClientRect().width > w0 * 1.5, w);
    await page.waitForTimeout(450);
    await dtap(); await page.waitForFunction((w0) => Math.abs(document.querySelector('.pdf-page').getBoundingClientRect().width - w0) < 4, w);
  });
  await t('riapertura: ricorda la pagina e lo zoom', async () => {
    page.__promptAnswer = '9';
    await page.click('.pdf-pill'); await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '9 / 12');
    await page.click('[data-pdf-zoomin]');
    const w = await pageWidth();
    await page.waitForTimeout(1100); // il salvataggio parte dopo ~0,7 s di quiete
    await closeViewer();
    await openDoc('Lungo');
    await page.waitForTimeout(600);
    const got = await pill();
    const meta = await page.evaluate(() => N.db.getMeta('pdfpos:' + N.docs._state.docs.find((d) => d.name === 'Lungo').id));
    eq(got, '9 / 12', 'indicatore dopo la riapertura (meta ' + JSON.stringify(meta) + '): ');
    ok(Math.abs((await pageWidth()) - w) < 3, 'zoom non ripristinato');
    const saved = await page.evaluate(() => N.db.getMeta('pdfpos:' + N.docs._state.docs.find((d) => d.name === 'Lungo').id));
    eq(saved.page, 8);
  });
  await t('menu «Altro»: «Salva il testo come nota» crea una nota con il testo del PDF', async () => {
    await page.click('[data-pdf-more], button[aria-label="Altro"]');
    await page.click('.sheet [data-act="tonote"]');
    await page.waitForFunction(() => window.__app.S.notes.some((n) => /Lungo/.test(n.title || '')));
    const body = await page.evaluate(() => { const n = window.__app.S.notes.find((x) => /Lungo/.test(x.title || '')); return JSON.stringify(n); });
    ok(/Pagina numero 1/.test(body) && /Zucchero/.test(body) && /Fine documento/.test(body), body.slice(0, 200));
  });
  await t('menu «Altro»: «Vai a pagina» funziona', async () => {
    page.__promptAnswer = '2';
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="goto"]');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '2 / 12');
  });
  await t('menu «Altro»: «Esporta» scarica il PDF identico all’originale', async () => {
    await page.click('button[aria-label="Altro"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-act="export"]')]);
    eq(dl.suggestedFilename(), 'Lungo.pdf');
    ok(fs.readFileSync(await dl.path()).equals(PDF12), 'file diverso');
  });
  /* ---------- annotazioni ---------- */
  const docSize = () => page.evaluate(() => N.docs._state.docs.find((d) => d.name === 'Lungo').size);
  const pageBox = () => page.locator('.pdf-page[data-page="2"]').boundingBox();
  const stroke = async (fx0, fy0, fx1, fy1) => {
    const b = await pageBox(); const y0 = Math.max(b.y, 130);
    await page.mouse.move(b.x + b.width * fx0, y0 + 40 + fy0 * 100);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(b.x + b.width * (fx0 + (fx1 - fx0) * k / 8), y0 + 40 + (fy0 + (fy1 - fy0) * k / 8) * 100);
    await page.mouse.up();
  };
  const inkCount = () => page.locator('.pdf-ink path').count();
  const colorPixels = (test) => page.locator('.pdf-page canvas').evaluateAll((cs, src) => {
    const f = new Function('r', 'g', 'b', 'return ' + src);
    let n = 0;
    for (const c of cs) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (f(d[i], d[i + 1], d[i + 2])) n++; }
    return n;
  }, test);

  await t('annotazioni: il pulsante apre la barra e lo scorrimento resta libero quando è chiusa', async () => {
    ok(!(await page.locator('.pdf-tools.on').count()), 'la barra doveva essere chiusa');
    await page.click('[data-pdf-annot]'); await page.waitForSelector('.pdf-tools.on');
    ok(await page.locator('.pdf-body.inking').count() === 1);
    ok(await page.locator('[data-ink-save]').isDisabled(), 'Salva deve essere spento senza tratti');
  });
  await t('annotazioni: evidenziatore e penna disegnano tratti; «Annulla» li toglie uno alla volta', async () => {
    await stroke(0.1, 0.1, 0.8, 0.1); eq(await inkCount(), 1);
    await page.click('[data-ink-pen]'); await page.click('[data-ink-color="#e53935"]');
    await stroke(0.1, 0.5, 0.8, 0.6); eq(await inkCount(), 2);
    await page.click('[data-ink-undo]'); eq(await inkCount(), 1);
    await page.click('[data-ink-undo]'); eq(await inkCount(), 0);
    ok(await page.locator('[data-ink-undo]').isDisabled());
    ok(await page.locator('[data-ink-save]').isDisabled());
  });
  await t('annotazioni: il tratto in corso sparisce se arriva un secondo dito (zoom)', async () => {
    const b = await pageBox();
    await page.evaluate(({ x, y }) => {
      const svg = document.querySelector('.pdf-page[data-page="2"] .pdf-ink');
      const ev = (type, id, dx) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y, isPrimary: id === 1 }));
      ev('pointerdown', 1, 0); ev('pointermove', 1, 20); ev('pointerdown', 2, 60); ev('pointermove', 1, 40); ev('pointerup', 1, 40); ev('pointerup', 2, 60);
    }, { x: b.x + 60, y: Math.max(b.y, 130) + 200 });
    eq(await inkCount(), 0);
  });
  let sizeBefore;
  await t('annotazioni: «Salva» scrive i tratti dentro il PDF e riapre il lettore sullo stesso punto', async () => {
    await page.click('[data-ink-pen]'); await page.click('[data-ink-color="#e53935"]');
    await stroke(0.1, 0.5, 0.8, 0.6);
    await page.click('[data-ink-hl]'); await page.click('[data-ink-color="#ffeb3b"]');
    await stroke(0.1, 0.1, 0.8, 0.1); eq(await inkCount(), 2);
    sizeBefore = await docSize();
    await page.click('[data-ink-save]');
    await page.waitForFunction(() => /Annotazioni salvate/.test((document.querySelector('.toast') || {}).innerText || ''));
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    await page.waitForFunction(() => document.querySelector('.pdf-pill').textContent === '2 / 12');
    ok((await docSize()) > sizeBefore, 'il file non è cambiato');
    eq(await inkCount(), 0, 'i tratti devono essere dentro il PDF, non sopra');
  });
  await t('annotazioni: nel PDF salvato si vedono davvero giallo (evidenziatore) e rosso (penna)', async () => {
    await page.waitForFunction(() => document.querySelector('.pdf-page[data-page="2"] canvas'));
    await page.waitForTimeout(500);
    ok(await colorPixels('r>240&&g>235&&b>120&&b<200') > 200, 'nessun pixel giallo');
    ok(await colorPixels('r>170&&g<110&&b<110') > 20, 'nessun pixel rosso');
  });
  await t('annotazioni: il PDF modificato resta un PDF valido con 12 pagine (esportazione)', async () => {
    await page.click('button[aria-label="Altro"]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-act="export"]')]);
    const buf = fs.readFileSync(await dl.path());
    ok(!buf.equals(PDF12));
    const re = await PDFDocument.load(buf); eq(re.getPageCount(), 12);
  });
  await t('annotazioni: uscendo senza premere «Salva» i tratti vengono salvati comunque', async () => {
    const before = await docSize();
    await page.click('[data-pdf-annot]'); await page.waitForSelector('.pdf-tools.on');
    await page.click('[data-ink-pen]'); await page.click('[data-ink-color="#1e66f5"]');
    await stroke(0.2, 0.3, 0.7, 0.35); eq(await inkCount(), 1);
    await page.goBack();
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Lungo').size > b, before);
    await page.waitForFunction(() => !document.querySelector('.pdf-body'));
  });
  await t('dopo l’uscita siamo di nuovo nell’elenco dei documenti', async () => { ok(await page.locator('.docs-screen').count() === 1); });
  await t('PDF senza testo (scansione): la ricerca lo dice con «Nessun testo»', async () => {
    await openDoc('Scansione');
    await page.click('[data-pdf-search]'); await page.fill('[data-pdf-q]', 'ciao');
    await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === 'Nessun testo');
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="tonote"]');
    await page.waitForSelector('.toast'); ok(/non contiene testo/.test(await page.locator('.toast').last().innerText()));
    await closeViewer();
  });
  await t('un PDF rotto non blocca l’app: avviso chiaro', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Rotto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nroba senza senso\n%%EOF') }]);
    await page.waitForSelector('.docrow:has-text("Rotto")');
    const before = errors.length;
    await page.locator('.docrow:has-text("Rotto") .docmain').click();
    await page.waitForFunction(() => /Impossibile aprire/.test((document.querySelector('.toast') || {}).innerText || ''));
    errors.length = before; // l’errore di pdf.js in console qui è atteso
    ok(await page.locator('.pdf-body').count() === 0);
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close();

  /* ---------- offline: con il service worker attivo il lettore funziona senza rete ---------- */
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT' });
  const p2 = await ctx2.newPage(); p2.setDefaultTimeout(8000);
  const errors2 = [];
  p2.on('pageerror', (e) => errors2.push(String(e)));
  p2.on('dialog', (d) => d.accept());
  await t('offline: dopo un primo uso, il lettore si apre anche senza rete', async () => {
    await p2.goto(base); await p2.waitForSelector('#list');
    await p2.evaluate(() => navigator.serviceWorker.ready);
    await p2.click('button[aria-label="Menu"]'); await p2.click('.drawer .item:has-text("Documenti")'); await p2.waitForSelector('.docs-screen');
    await p2.click('.docs-plus'); await p2.click('.sheet [data-import]');
    await p2.locator('input[data-docs-input]').setInputFiles([{ name: 'Lungo.pdf', mimeType: 'application/pdf', buffer: PDF12 }]);
    await p2.waitForSelector('.docrow');
    await p2.locator('.docmain').click(); await p2.waitForSelector('.pdf-page canvas');
    await p2.goBack(); await p2.waitForFunction(() => !document.querySelector('.pdf-body'));
    await p2.waitForTimeout(500);
    await ctx2.setOffline(true);
    await p2.goto('about:blank'); await p2.goto(base); await p2.waitForSelector('#list');
    await p2.click('button[aria-label="Menu"]'); await p2.click('.drawer .item:has-text("Documenti")'); await p2.waitForSelector('.docs-screen');
    await p2.locator('.docmain').click(); await p2.waitForSelector('.pdf-page canvas');
    ok(await nonBlank_(p2), 'pagina vuota offline');
  });
  async function nonBlank_(pg) { return pg.locator('.pdf-page canvas').first().evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) return true; return false; }); }
  ok(errors2.length === 0, 'errori offline: ' + errors2.join(' | '));
  await ctx2.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
