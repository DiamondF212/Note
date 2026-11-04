// Test end-to-end del dock in basso (Note · Strumenti · Documenti). Esecuzione: node tests/dock.e2e.test.js
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
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } }
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base); await page.waitForSelector('#dock');
  const box = (sel) => page.locator(sel).boundingBox();

  await t('il dock mostra Note, Strumenti, Documenti e «Note» è la voce attiva', async () => {
    const labels = await page.locator('#dock button').allInnerTexts();
    eq(labels.join('|'), 'Note|Strumenti|Documenti');
    ok(await page.locator('#dock button[data-dock="notes"].on').count() === 1, 'Note non attiva');
  });
  await t('il dock sta in basso, accanto al «+», senza sovrapporsi', async () => {
    const d = await box('#dock'), f = await box('#fab');
    ok(d.y + d.height <= 844 && d.y > 700, 'dock non in basso');
    ok(d.x + d.width <= f.x, 'dock e + si sovrappongono');
  });
  await t('nel menu laterale non ci sono più Tutte le note, Strumenti, Documenti', async () => {
    await page.click('button[aria-label="Menu"]'); await page.waitForSelector('.drawer');
    const txt = await page.locator('.drawer .item').allInnerTexts();
    for (const gone of ['Tutte le note', 'Strumenti', 'Documenti']) ok(!txt.some((x) => x.trim().startsWith(gone)), gone + ' è ancora nel menu');
    for (const keep of ['Promemoria', 'Calendario', 'Panoramica personale', 'Nota di oggi', 'Archivio', 'Cestino']) ok(txt.some((x) => x.includes(keep)), keep + ' manca');
    await page.goBack(); await page.waitForSelector('.drawer', { state: 'detached' });
  });
  await t('«Strumenti» e «Documenti» aprono le rispettive schermate e il dock torna al ritorno', async () => {
    await page.click('#dock button[data-dock="tools"]'); await page.waitForSelector('.tools-sheet');
    await page.goBack(); await page.waitForSelector('.tools-sheet', { state: 'detached' });
    await page.click('#dock button[data-dock="docs"]'); await page.waitForSelector('.docs-screen');
    await page.goBack(); await page.waitForSelector('.docs-screen', { state: 'detached' });
    ok(await page.locator('#dock').isVisible(), 'dock non visibile');
  });
  const viaMenu = async (voce) => { await page.click('button[aria-label="Menu"]'); await page.waitForSelector('.drawer'); await page.click('.drawer .item:has-text("' + voce + '")'); await page.waitForSelector('.drawer', { state: 'detached' }); };
  await t('nel cestino «Note» non è attiva; un tocco riporta a tutte le note', async () => {
    await viaMenu('Cestino');
    eq(await page.locator('#dock button[data-dock="notes"].on').count(), 0, 'Note attiva nel cestino');
    await page.click('#dock button[data-dock="notes"]');
    eq(await page.locator('#dock button[data-dock="notes"].on').count(), 1, 'Note non torna attiva');
  });
  await t('nel cestino il «+» sparisce e il dock si allarga a tutta la larghezza', async () => {
    await viaMenu('Cestino');
    eq(await page.locator('#dock.full').count(), 1, 'dock non allargato');
    ok(!(await page.locator('#fab').isVisible()), '+ ancora visibile');
    await page.click('#dock button[data-dock="notes"]');
    eq(await page.locator('#dock.full').count(), 0);
  });
  await t('durante la selezione di note il dock si nasconde', async () => {
    await page.evaluate(() => N.db.put({ id: 'dk1', kind: 'text', title: 'Prova dock', body: 'x', items: [], tags: [], folder: '', bg: { id: 'none' }, pinned: false, trashed: 0, reminder: null, reminded: false, hidden: false, created: Date.now(), updated: Date.now() }));
    const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'it-IT', serviceWorkers: 'block' });
    const dp = await dctx.newPage();
    await dp.goto(base); await dp.evaluate(() => N.db.put({ id: 'dk1', kind: 'text', title: 'Prova dock', body: 'x', items: [], tags: [], folder: '', bg: { id: 'none' }, pinned: false, trashed: 0, reminder: null, reminded: false, hidden: false, created: Date.now(), updated: Date.now() }));
    await dp.reload(); await dp.waitForSelector('.card');
    const c = await dp.locator('.card').first().boundingBox();
    await dp.mouse.move(c.x + 20, c.y + 20); await dp.mouse.down(); await dp.waitForTimeout(700); await dp.mouse.up();
    await dp.waitForSelector('.selbar');
    eq(await dp.locator('#dock.hidden').count(), 1, 'dock ancora visibile');
    await dctx.close();
  });
  await t('nessun errore in console', async () => { eq(errors.join(' | '), ''); });
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})();
