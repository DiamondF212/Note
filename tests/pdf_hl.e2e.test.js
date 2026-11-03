// Test end-to-end dell’evidenziazione che segue il testo. Esecuzione: node tests/pdf_hl.e2e.test.js
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

// PDF di prova: titolo + tre righe di testo a posizioni note (pagina 400x560, Helvetica corpo 14).
async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 560]);
  p.drawText('Titolo del documento', { x: 40, y: 500, size: 24, font });
  p.drawText('Primo rigo di prova per evidenziare', { x: 40, y: 450, size: 14, font });
  p.drawText('Secondo rigo con altre parole', { x: 40, y: 420, size: 14, font });
  p.drawText('Terzo rigo che resta senza colore', { x: 40, y: 390, size: 14, font });
  return Buffer.from(await doc.save());
}
async function makeScan() { const doc = await PDFDocument.create(); doc.addPage([300, 400]); return Buffer.from(await doc.save()); }

(async () => {
  const PDF = await makePdf(), SCAN = await makeScan();
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
    { name: 'Testi.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: 'Scansione.pdf', mimeType: 'application/pdf', buffer: SCAN }
  ]);
  await page.waitForSelector('.docrow:nth-child(2)');
  const openDoc = async (name) => { await page.locator('.docrow:has-text("' + name + '") .docmain').click(); await page.waitForSelector('.pdf-page canvas'); };

  // schermo ↔ pagina: (x, y) in unità pagina a zoom 1 (y dall'alto)
  const pt = async (x, y) => { const b = await page.locator('.pdf-page').first().boundingBox(); const cs = b.width / 400; return [b.x + x * cs, b.y + y * cs, cs]; };
  const drag = async (x0, y0, x1, y1) => {
    const [sx, sy] = await pt(x0, y0), [ex, ey] = await pt(x1, y1);
    await page.mouse.move(sx, sy); await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(sx + (ex - sx) * k / 8, sy + (ey - sy) * k / 8);
    await page.mouse.up();
  };
  // righe: linea di base a y = 560 - 450 = 110, 140, 170 (dall'alto)
  const quads = () => page.locator('.pdf-ink path.pdf-txthl').count();
  const quadBoxes = () => page.locator('.pdf-ink path.pdf-txthl').evaluateAll((ps) => ps.map((p) => { const b = p.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }));
  // pixel col colore dell'evidenziatore giallo (#ffeb3b al 40% su bianco ≈ 255,247,177); le frange colorate dell'antialiasing del testo non contano
  const yellow = (rows) => page.locator('.pdf-page canvas').first().evaluate((c, [r0, r1]) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; const sample = [];
    for (let y = Math.floor(r0 * c.height); y < Math.floor(r1 * c.height); y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i] >= 250 && d[i + 1] >= 242 && d[i + 1] <= 252 && d[i + 2] >= 165 && d[i + 2] <= 190) { n++; if (sample.length < 4) sample.push([x, y, d[i], d[i + 1], d[i + 2]].join(',')); }
    }
    return { n, sample };
  }, rows);

  await t('la barra si apre con «Evidenzia» già scelto', async () => {
    await openDoc('Testi');
    await page.click('[data-pdf-annot]'); await page.waitForSelector('.pdf-tools.on');
    ok(await page.locator('[data-ink-txt].on').count() === 1, 'lo strumento di partenza doveva essere «Evidenzia»');
    await page.waitForTimeout(800);
  });
  await t('trascinando su una parola si evidenzia la parola intera, non tutta la riga', async () => {
    await drag(92, 105, 110, 105);                 // dentro «di prova»
    await page.waitForFunction(() => document.querySelectorAll('.pdf-ink path.pdf-txthl').length === 1);
    const [q] = await quadBoxes();
    ok(q.w > 8 && q.w < 120, 'larghezza fuori misura: ' + q.w);
    ok(q.x > 41 && q.x <= 92, 'inizio sulla parola: ' + q.x);
    ok(q.x + q.w >= 110, 'fine oltre il rilascio: ' + (q.x + q.w));
    ok(q.y > 110 - 14 && q.y < 110 - 9, 'la fascia deve stare sopra la linea di base: ' + q.y);
    ok(q.h > 14 && q.h < 18, 'altezza ≈ corpo: ' + q.h);
  });
  await t('«Annulla» toglie l’evidenziazione', async () => {
    await page.click('[data-ink-undo]'); eq(await quads(), 0);
    ok(await page.locator('[data-ink-save]').isDisabled());
  });
  await t('dal primo al secondo rigo: due fasce (coda del primo + inizio del secondo), il terzo resta libero', async () => {
    await drag(150, 105, 120, 135);
    await page.waitForFunction(() => document.querySelectorAll('.pdf-ink path.pdf-txthl').length === 1);
    const d = await page.locator('.pdf-ink path.pdf-txthl').getAttribute('d');
    eq((d.match(/Z/g) || []).length, 2, 'rettangoli');
    const [q] = await quadBoxes();
    ok(q.y + q.h < 170 - 14, 'non deve toccare il terzo rigo: ' + (q.y + q.h));
  });
  await t('un secondo dito durante il trascinamento annulla la selezione in corso (zoom)', async () => {
    const [sx, sy] = await pt(60, 165);
    await page.evaluate(({ x, y }) => {
      const svg = document.querySelector('.pdf-page .pdf-ink');
      const ev = (type, id, dx) => svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', clientX: x + dx, clientY: y, isPrimary: id === 1 }));
      ev('pointerdown', 1, 0); ev('pointermove', 1, 30); ev('pointerdown', 2, 80); ev('pointermove', 1, 50); ev('pointerup', 1, 50); ev('pointerup', 2, 80);
    }, { x: sx, y: sy });
    await page.waitForTimeout(300);
    eq(await quads(), 1, 'doveva restare solo la fascia già fatta');
  });
  await t('il colore scelto vale per la fascia (rosa) e «Salva» la scrive nel PDF', async () => {
    await page.click('[data-ink-color="#ff80ab"]');
    await drag(45, 36, 150, 36);   // titolo
    await page.waitForFunction(() => document.querySelectorAll('.pdf-ink path.pdf-txthl').length === 2);
    ok(await page.locator('.pdf-ink path.pdf-txthl').nth(1).getAttribute('fill') === '#ff80ab');
    const before = await page.evaluate(() => N.docs._state.docs.find((d) => d.name === 'Testi').size);
    await page.click('[data-ink-save]');
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Testi').size > b, before);
    await page.waitForFunction(() => document.querySelectorAll('.pdf-body').length === 1 && document.querySelector('.pdf-pill'));
    await page.waitForSelector('.pdf-page canvas');
    await page.waitForTimeout(600);
    eq(await quads(), 0, 'dopo il salvataggio le fasce sono dentro il PDF');
  });
  await t('nel PDF salvato il giallo c’è sul primo e secondo rigo e NON sul terzo', async () => {
    ok((await yellow([90 / 560, 150 / 560])).n > 300, 'giallo mancante sui primi due righi');
    const third = await yellow([158 / 560, 185 / 560]); eq(third.n, 0, 'giallo sul terzo rigo, campione x,y,r,g,b: ' + third.sample.join(' | '));
  });
  await t('il testo resta nel PDF dopo l’evidenziazione (non è stato coperto o rasterizzato)', async () => {
    await page.click('[data-pdf-search]'); await page.fill('[data-pdf-q]', 'secondo rigo');
    await page.waitForFunction(() => document.querySelector('[data-pdf-count]').textContent === '1/1');
    await page.click('[data-pdf-close]');
  });
  await t('PDF scansione: nessun testo → messaggio che suggerisce «A mano», nessuna fascia', async () => {
    await page.goBack(); await page.waitForFunction(() => !document.querySelector('.pdf-body'));
    await openDoc('Scansione');
    await page.click('[data-pdf-annot]'); await page.waitForSelector('.pdf-tools.on'); await page.waitForTimeout(800);
    const b = await page.locator('.pdf-page').first().boundingBox();
    await page.mouse.move(b.x + 60, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + 160, b.y + 110, { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => /scansione/i.test((document.querySelector('.toast') || {}).innerText || ''));
    eq(await quads(), 0);
  });
  await t('nessuna richiesta verso l’esterno (tutto resta sul telefono)', async () => { eq(external.join(', '), ''); });
  ok(errors.length === 0, 'errori in console: ' + errors.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
