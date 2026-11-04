// Test end-to-end delle conversioni note ↔ documenti. Esecuzione: node tests/convert.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 12).join('\n       ')); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(9000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url())});
  page.on('dialog', (d) => d.accept());

  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(async () => {
    const now = Date.now();
    await window.__app.N.db.put({ id: 'n-testo', kind: 'text', title: 'Spesa', body: 'latte\npane e burro', created: now, updated: now });
    await window.__app.N.db.put({ id: 'n-lista', kind: 'list', title: 'Da fare', items: [{ t: 'Chiamare', done: true }, { t: 'Scrivere', done: false }], created: now, updated: now });
  });
  const reload = async () => { await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list'); };
  await reload();
  const docs = () => page.evaluate(() => (N.docs._state.docs || []).map((d) => ({ id: d.id, name: d.name, type: d.type, origin: d.origin })));
  const dbDocs = () => page.evaluate(() => N.db.docs.all().then((a) => a.map((d) => ({ id: d.id, name: d.name, type: d.type, origin: d.origin, head: Array.from(new Uint8Array(d.data.slice(0, 4))) }))));
  const exportNote = async (title, rowText) => {
    await page.locator('.card:has-text("' + title + '")').click();
    await page.click('[data-k="down"]');
    await page.click('.sheet .item:has-text("' + rowText + '")');
  };
  const closeNote = async () => { await page.goBack(); await page.waitForSelector('#list'); };

  await t('Lista → Excel in Documenti: foglio «Da fare» con colonne Fatto e Voce, modificabile', async () => {
    await exportNote('Da fare', 'Documenti → Excel');
    await page.waitForSelector('.toast:has-text("Salvato in Documenti")');
    const d = (await dbDocs()).find((x) => x.name === 'Da fare');
    ok(d && d.type === 'xlsx' && d.origin === 'note', JSON.stringify(d));
    const rows = await page.evaluate(async (id) => { await N.docs.api.lib('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load((await N.db.docs.get(id)).data.slice(0)); const ws = wb.getWorksheet('Da fare'); const o = []; ws.eachRow((r) => o.push([r.getCell(1).value, r.getCell(2).value])); return [o, ws.getCell('A1').font.bold]; }, d.id);
    eq(JSON.stringify(rows[0]), JSON.stringify([['Fatto', 'Voce'], ['Sì', 'Chiamare'], ['No', 'Scrivere']])); eq(rows[1], true);
  });

  await t('Nota di testo → Word in Documenti: titolo e paragrafi', async () => {
    await closeNote();
    await exportNote('Spesa', 'Documenti → Word');
    await page.waitForSelector('.toast:has-text("«Spesa»")');
    const d = (await dbDocs()).find((x) => x.name === 'Spesa' && x.type === 'docx');
    ok(d && d.origin === 'note', JSON.stringify(d));
    const html = await page.evaluate(async (id) => { await N.docs.api.lib('mammoth'); return (await mammoth.convertToHtml({ arrayBuffer: (await N.db.docs.get(id)).data.slice(0) })).value; }, d.id);
    ok(/<h1>Spesa<\/h1>/.test(html) && /<p>latte<\/p>/.test(html) && /<p>pane e burro<\/p>/.test(html), html);
  });

  await t('Nota → PDF in Documenti: file PDF valido', async () => {
    await closeNote();
    await exportNote('Da fare', 'Documenti → PDF');
    await page.waitForSelector('.toast:has-text("Salvato in Documenti")');
    const d = (await dbDocs()).find((x) => x.type === 'pdf' && x.name === 'Da fare');
    ok(d && d.head.join() === '37,80,68,70', JSON.stringify(d)); // «%PDF»
  });

  await t('I tre documenti compaiono in Documenti e il Word/Excel creato dalla nota si salva sul posto', async () => {
    await closeNote();
    await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');
    eq(await page.locator('.docrow').count(), 3);
    await page.locator('.docrow:has-text("Da fare"):has-text("Excel") .docmain').click(); await page.waitForSelector('.xl-grid .xl-c');
    await page.click('.xl-c[data-r="3"][data-c="1"]'); await page.click('.xl-c[data-r="3"][data-c="1"]');
    await page.fill('[data-xl-input]', 'Pagare'); await page.press('[data-xl-input]', 'Enter');
    await page.click('[aria-label="Salva"]'); await page.waitForSelector('.toast:has-text("Salvato")');
    eq((await dbDocs()).filter((x) => x.type === 'xlsx').length, 1, 'nessuna copia «(modificato)»');
  });

  await t('Excel → lista: dalle colonne Fatto + Voce nasce una nota-lista con le voci spuntate', async () => {
    await page.evaluate(() => { document.querySelector('[data-xl-scroll]').scrollLeft = 0; }); await page.waitForTimeout(300); // la colonna B è larga: la griglia era scorsa a destra
    await page.click('.xl-ch[data-ch="0"]'); await page.click('.xl-bar [data-x="ext"]'); await page.click('.xl-ch[data-ch="1"]');
    await page.click('[aria-label="Altro"]'); await page.click('.sheet [data-act="list"]');
    await page.waitForSelector('.toast:has-text("Lista creata con 3 voci")');
    const n = await page.evaluate(() => window.__app.S.notes.filter((x) => x.title === 'Da fare' && x.kind === 'list').map((x) => JSON.stringify(x.items)));
    ok(n.length === 2, 'originale + nuova: ' + n.length);
    ok(n.includes('[{"t":"Chiamare","done":true},{"t":"Scrivere","done":false},{"t":"Pagare","done":false}]'), n.join(' / '));
  });

  await t('Excel → lista da una sola colonna (cella selezionata)', async () => {
    await page.click('.xl-c[data-r="1"][data-c="1"]');
    await page.click('[aria-label="Altro"]'); await page.click('.sheet [data-act="list"]');
    await page.waitForSelector('.toast:has-text("Lista creata con 4 voci")'); // «Voce» + 3 voci
  });

  await t('Nessuna richiesta esterna e nessun errore imprevisto', async () => {
    eq(external.join(','), '');
    eq(errors.join(' | '), '');
  });

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
