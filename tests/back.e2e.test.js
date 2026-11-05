// Test end-to-end del tasto/gesto Indietro di Android: selezione, ricerca, cestino, archivio e cartelle
// devono essere «livelli» (uno alla volta), altrimenti Indietro chiude l'app. Esecuzione: node tests/back.e2e.test.js
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

const mk = (id, extra) => Object.assign({ id, kind: 'text', title: 'Nota ' + id, body: 'testo ' + id, items: [], tags: [], folder: '', bg: { id: 'none' }, pinned: false, trashed: 0, reminder: null, reminded: false, hidden: false, created: Date.now(), updated: Date.now() }, extra || {});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base); await page.waitForSelector('#dock');
  await page.evaluate(async (notes) => { for (const n of notes) await N.db.put(n); }, [mk('a1'), mk('a2', { folder: 'Lavoro' }), mk('t1', { trashed: Date.now() }), mk('ar1', { archived: true })]);
  await page.reload(); await page.waitForSelector('.card');

  const title = () => page.locator('#top h1').innerText();
  const depth = () => page.evaluate(() => (history.state && history.state.l) || 0);
  const back = async () => { await page.goBack(); await page.waitForTimeout(80); };
  const viaMenu = async (voce) => { await page.click('button[aria-label="Menu"]'); await page.waitForSelector('.drawer'); await page.click('.drawer .item:has-text("' + voce + '")'); await page.waitForSelector('.drawer', { state: 'detached' }); await page.waitForTimeout(80); };
  const longPress = async (sel) => { const c = await page.locator(sel).first().boundingBox(); await page.mouse.move(c.x + 20, c.y + 20); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForSelector('.selbar'); };

  await t('nella home non c\'è nessun livello: Indietro uscirebbe dall\'app (comportamento corretto)', async () => {
    eq(await depth(), 0);
  });
  await t('dal Cestino, Indietro torna alla home e non resta nessun livello', async () => {
    await viaMenu('Cestino'); eq(await title(), 'Cestino'); eq(await depth(), 1);
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('dall\'Archivio, Indietro torna alla home', async () => {
    await viaMenu('Archivio'); eq(await title(), 'Archivio');
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('in una cartella, Indietro torna a tutte le note', async () => {
    await viaMenu('Lavoro'); eq(await title(), 'Lavoro');
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('cambiare sezione dal menu (Cestino → Archivio) non accumula livelli', async () => {
    await viaMenu('Cestino'); await viaMenu('Archivio'); eq(await title(), 'Archivio'); eq(await depth(), 1);
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('la ricerca: il primo Indietro la svuota, il secondo esce dall\'archivio', async () => {
    await viaMenu('Archivio');
    await page.fill('#q', 'Nota'); await page.waitForTimeout(50);
    await back(); eq(await page.inputValue('#q'), ''); eq(await title(), 'Archivio');
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('la ricerca nella home: Indietro la svuota e poi si è di nuovo alla home', async () => {
    await page.fill('#q', 'zzz'); await page.waitForTimeout(50);
    await back(); eq(await page.inputValue('#q'), ''); eq(await depth(), 0);
  });
  await t('la selezione: Indietro la annulla senza uscire', async () => {
    await longPress('.card');
    ok(await page.locator('.selbar').count() === 1, 'selezione non attiva');
    await back(); eq(await page.locator('.selbar').count(), 0, 'selezione ancora attiva'); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('selezione dentro il Cestino: Indietro toglie la selezione, poi il Cestino', async () => {
    await viaMenu('Cestino'); await longPress('.card');
    await back(); eq(await page.locator('.selbar').count(), 0); eq(await title(), 'Cestino');
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('«Annulla selezione» con la X non lascia livelli sospesi', async () => {
    await longPress('.card'); await page.click('.selbar button[aria-label="Annulla selezione"]'); await page.waitForTimeout(80);
    eq(await page.locator('.selbar').count(), 0); eq(await depth(), 0);
  });
  await t('il tocco su «Note» nel dock dal Cestino non lascia livelli sospesi', async () => {
    await viaMenu('Cestino'); await page.click('#dock button[data-dock="notes"]'); await page.waitForTimeout(80);
    eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('nota aperta da una cartella: Indietro chiude la nota, poi la cartella', async () => {
    await viaMenu('Lavoro'); await page.click('.card'); await page.waitForSelector('.editor');
    await back(); eq(await page.locator('.editor').count(), 0); eq(await title(), 'Lavoro');
    await back(); eq(await title(), 'Note'); eq(await depth(), 0);
  });
  await t('un pannello aperto sopra un filtro si chiude per primo', async () => {
    await viaMenu('Cestino');
    await page.click('button[aria-label="Menu"]'); await page.waitForSelector('.drawer');
    await back(); eq(await page.locator('.drawer').count(), 0); eq(await title(), 'Cestino');
    await back(); eq(await title(), 'Note');
  });
  await t('nessun errore in console', async () => { eq(errors.length, 0, errors.join(' | ')); });

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
