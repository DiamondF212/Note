// Test end-to-end della sezione Documenti. Esecuzione: node tests/docs.e2e.test.js
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

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const ZIP = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(60, 1)]);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => { if (d.type() === 'prompt') d.accept(page.__promptAnswer || 'x'); else d.accept(); });

  /* ---------- migrazione del database: le note vecchie devono sopravvivere ---------- */
  await t('migrazione: un archivio versione 1 con una nota passa alla 3 senza perdere nulla', async () => {
    await page.goto(base + 'icon.svg');
    await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('mie-note', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('notes', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'k' }); };
      r.onsuccess = () => { const d = r.result; const tx = d.transaction(['notes', 'meta'], 'readwrite');
        tx.objectStore('notes').put({ id: 'vecchia1', kind: 'text', title: 'Nota storica', body: 'non deve sparire', created: 1, updated: 1 });
        tx.objectStore('meta').put({ k: 'folders', v: ['Casa'] });
        tx.oncomplete = () => { d.close(); res(); }; tx.onerror = () => rej(tx.error); };
      r.onerror = () => rej(r.error);
    }));
    await page.goto(base); await page.waitForSelector('#list');
    const info = await page.evaluate(async () => {
      const notes = window.__app.S.notes.map((n) => n.title);
      const v = await new Promise((res) => { const r = indexedDB.open('mie-note'); r.onsuccess = () => { const d = r.result; const o = { version: d.version, stores: Array.from(d.objectStoreNames) }; d.close(); res(o); }; });
      return { notes, v, folders: window.__app.S.folders };
    });
    ok(info.notes.includes('Nota storica'), 'la nota storica è sparita: ' + info.notes);
     eq(info.v.version, 3); ok(info.v.stores.includes('docs'), 'manca l’archivio docs'); ok(info.v.stores.includes('workouts'), 'manca l’archivio workouts');
    eq(info.folders[0], 'Casa');
  });

  const openDocs = async () => { await page.click('.dock button:has-text("Documenti")'); await page.waitForSelector('.docs-screen'); };
  const importFiles = async (files) => {
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    const input = page.locator('input[data-docs-input]');
    await input.setInputFiles(files);
  };

  await t('«Documenti» nel dock in basso apre una schermata vuota', async () => {
    await openDocs();
    eq(await page.locator('.docs-empty').count(), 1);
    eq(await page.locator('.ds-title').innerText(), 'Documenti');
  });
  await t('importa un PDF, un Word e un Excel; compaiono in elenco con il tipo giusto', async () => {
    await importFiles([
      { name: 'Contratto.pdf', mimeType: 'application/pdf', buffer: PDF },
      { name: 'Lettera.docx', mimeType: 'application/octet-stream', buffer: ZIP },
      { name: 'Conti.xlsx', mimeType: 'application/octet-stream', buffer: ZIP }
    ]);
    await page.waitForSelector('.docrow:nth-child(3)');
    eq(await page.locator('.docrow').count(), 3);
    const txt = await page.locator('.docs-list').innerText();
    ok(/Contratto/.test(txt) && /Lettera/.test(txt) && /Conti/.test(txt), txt);
    ok(/PDF/.test(txt) && /Word/.test(txt) && /Excel/.test(txt));
  });
  await t('un file non riconosciuto viene rifiutato con un messaggio chiaro', async () => {
    await importFiles([{ name: 'foto.zip', mimeType: 'application/zip', buffer: ZIP }, { name: 'finto.pdf', mimeType: 'application/pdf', buffer: Buffer.from('solo testo') }]);
    await page.waitForSelector('.toast');
    ok(/non riconosciuti/.test(await page.locator('.toast').innerText()));
    eq(await page.locator('.docrow').count(), 3);
  });
  await t('importare due volte lo stesso nome non sovrascrive: «Contratto (2)»', async () => {
    await importFiles([{ name: 'Contratto.pdf', mimeType: 'application/pdf', buffer: PDF }]);
    await page.waitForSelector('.docrow:nth-child(4)');
    ok(/Contratto \(2\)/.test(await page.locator('.docs-list').innerText()));
  });
  await t('il filtro per tipo funziona', async () => {
    await page.click('.docs-seg [data-f="pdf"]'); eq(await page.locator('.docrow').count(), 2);
    await page.click('.docs-seg [data-f="xlsx"]'); eq(await page.locator('.docrow').count(), 1);
    await page.click('.docs-seg [data-f="all"]'); eq(await page.locator('.docrow').count(), 4);
  });
  await t('i documenti restano dopo aver ricaricato l’app (archivio locale)', async () => {
    await page.goto('about:blank'); // evita lo stato residuo della cronologia della pagina precedente
    await page.goto(base); await page.waitForSelector('#list'); await openDocs();
    eq(await page.locator('.docrow').count(), 4);
  });
  await t('rinomina un documento', async () => {
    page.__promptAnswer = 'Contratto affitto';
    await page.locator('.docrow:has-text("Contratto (2)") .ibtn').click();
    await page.click('.sheet [data-act="rename"]');
    await page.waitForFunction(() => /Contratto affitto/.test(document.querySelector('.docs-list').innerText));
    ok(!/Contratto \(2\)/.test(await page.locator('.docs-list').innerText()));
  });
  await t('esporta: il file scaricato è identico all’originale', async () => {
    await page.locator('.docrow:has-text("Contratto affitto") .ibtn').click();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.sheet [data-act="export"]')]);
    eq(dl.suggestedFilename(), 'Contratto affitto.pdf');
    const buf = fs.readFileSync(await dl.path());
    ok(buf.equals(PDF), 'contenuto diverso dall’originale');
  });
  await t('elimina un documento (con conferma)', async () => {
    await page.locator('.docrow:has-text("Lettera") .ibtn').click();
    await page.click('.sheet [data-act="delete"]');
    await page.waitForFunction(() => document.querySelectorAll('.docrow').length === 3);
    ok(!/Lettera/.test(await page.locator('.docs-list').innerText()));
  });
  await t('aprire un documento illeggibile (file finto) avvisa invece di rompersi', async () => {
    await page.locator('.docrow:has-text("Conti") .docmain').click();
    await page.waitForSelector('.toast:has-text("Impossibile")');
  });
  await t('il tasto Indietro chiude la sezione e le note sono intatte', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen', { state: 'detached' });
    const titles = await page.evaluate(() => window.__app.S.notes.map((n) => n.title));
    ok(titles.includes('Nota storica'));
  });
  await t('le librerie in vendor/ si caricano e si inizializzano (pdf.js, pdf-lib, mammoth, ExcelJS)', async () => {
    const r = await page.evaluate(async () => {
      const a = N.docs.api; const out = {};
      for (const k of ['pdfjs', 'pdflib', 'mammoth', 'exceljs']) { try { await a.lib(k); out[k] = 'ok'; } catch (e) { out[k] = String(e.message); } }
      return out;
    });
    for (const k of Object.keys(r)) eq(r[k], 'ok', k + ': ');
  });
  const real = errors.filter((e) => !/Corrupted zip|end of central directory|file Excel non leggibile/i.test(e)); // errori attesi dal file Excel finto
  ok(real.length === 0, 'errori in console: ' + real.join(' | '));
  await ctx.close(); await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
