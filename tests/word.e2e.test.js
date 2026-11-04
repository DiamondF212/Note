// Test end-to-end dell'editor Word. Esecuzione: node tests/word.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
let passed = 0, failed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 14).join('\n       ')); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'word-'));
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// documento Word "vero" creato con la libreria docx (solo per i test): titolo, formati, elenchi, tabella, immagine, intestazione
async function makeFixture() {
  const D = require(process.env.DOCX_PATH || 'docx');
  const doc = new D.Document({
    numbering: { config: [{ reference: 'n', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: D.AlignmentType.START }] }] },
    sections: [{
      headers: { default: new D.Header({ children: [new D.Paragraph('INTESTAZIONE')] }) },
      children: [
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Relazione annuale')] }),
        new D.Paragraph({ children: [new D.TextRun('Testo '), new D.TextRun({ text: 'grassetto', bold: true }), new D.TextRun(' e '), new D.TextRun({ text: 'corsivo', italics: true }), new D.TextRun(' e '), new D.TextRun({ text: 'sottolineato', underline: {} }), new D.TextRun(' àèìòù €')] }),
        new D.Paragraph({ text: 'Primo punto', bullet: { level: 0 } }),
        new D.Paragraph({ text: 'Sotto punto', bullet: { level: 1 } }),
        new D.Paragraph({ text: 'Passo uno', numbering: { reference: 'n', level: 0 } }),
        new D.Paragraph({ text: 'Passo due', numbering: { reference: 'n', level: 0 } }),
        new D.Table({ rows: [new D.TableRow({ children: [new D.TableCell({ children: [new D.Paragraph('A1')] }), new D.TableCell({ children: [new D.Paragraph('B1')] })] }), new D.TableRow({ children: [new D.TableCell({ children: [new D.Paragraph('A2')] }), new D.TableCell({ children: [new D.Paragraph('B2')] })] })] }),
        new D.Paragraph({ children: [new D.ImageRun({ type: 'png', data: PNG1, transformation: { width: 20, height: 20 } })] }),
        new D.Paragraph('Fine documento')
      ]
    }]
  });
  return Buffer.from(await D.Packer.toBuffer(doc));
}

(async () => {
  const FIX = await makeFixture();
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(9000);
  const errors = [], external = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:)/.test(r.url())) external.push(r.url()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(base); await page.waitForSelector('#list');
  await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Documenti")'); await page.waitForSelector('.docs-screen');

  const ed = '[data-word-editor]';
  const docs = () => page.evaluate(() => N.docs._state.docs.map((d) => ({ id: d.id, name: d.name, type: d.type, size: d.size, origin: d.origin })));
  const byName = async (n) => (await docs()).find((d) => d.name === n);
  const bytesOf = (id) => page.evaluate(async (id) => Array.from(new Uint8Array((await N.db.docs.get(id)).data)), id).then((a) => Buffer.from(a));
  const html = () => page.locator(ed).evaluate((e) => e.innerHTML);
  const w = (k) => page.click('.word-bar [data-w="' + k + '"]');
  const closeEditor = async () => { await page.goBack(); await page.waitForSelector('.docs-screen'); await page.waitForTimeout(500); };
  const htmlOf = async (id) => { const b = await bytesOf(id); return page.evaluate(async (a) => (await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(a).buffer }, { styleMap: ['u => u', 'strike => s'] })).value, Array.from(b)); };
  const unz = (buf, name) => { const f = path.join(tmp, name); fs.writeFileSync(f, buf); const dir = f + '_x'; fs.rmSync(dir, { recursive: true, force: true }); cp.execFileSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', f, dir]); return { f, dir }; };

  await t('Nuovo Word: crea «Nuovo documento» e apre l’editor vuoto con la barra', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-new="docx"]');
    await page.waitForSelector(ed);
    eq(await page.locator('.word-bar .wbtn').count() >= 18, true);
    const d = await byName('Nuovo documento'); ok(d && d.type === 'docx' && d.origin === 'note', JSON.stringify(d));
  });

  await t('Scrittura: titolo, grassetto/corsivo/sottolineato, elenco puntato e numerato, tabella → salvataggio', async () => {
    await page.locator(ed).click();
    await w('h1'); await page.keyboard.type('Verbale àè€'); await page.keyboard.press('Enter');
    await w('p'); await w('bold'); await page.keyboard.type('forte'); await w('bold'); await page.keyboard.type(' '); await w('italic'); await page.keyboard.type('obliquo'); await w('italic');
    await page.keyboard.press('Enter');
    await w('ul'); await page.keyboard.type('uno'); await page.keyboard.press('Enter'); await page.keyboard.type('due'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await w('ol'); await page.keyboard.type('primo'); await page.keyboard.press('Enter'); await page.keyboard.type('secondo'); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await w('table'); await page.waitForSelector('[data-table-ok]');
    await page.locator('.sheet .seg').nth(0).locator('button').last().click(); // 4 righe
    await page.click('[data-table-ok]');
    await page.waitForSelector(ed + ' table');
    await page.locator(ed + ' td').first().click(); await page.keyboard.type('X1');
    const h = await html();
    ok(/<h1>Verbale/.test(h) && /<strong>forte|<b>forte/.test(h) && /<em>obliquo|<i>obliquo/.test(h) && /<ul>/.test(h) && /<ol>/.test(h), h);
    const u0 = await page.evaluate(() => N.docs._state.docs.find((d) => d.name === 'Nuovo documento').updated);
    await page.click('.word-save'); await page.waitForFunction((u) => N.docs._state.docs.find((d) => d.name === 'Nuovo documento').updated !== u, u0); // il documento nuovo pesa già >1000 byte: si attende che «updated» cambi
    const out = await htmlOf((await byName('Nuovo documento')).id);
    ok(/<h1>Verbale àè€<\/h1>/.test(out), out);
    ok(/<strong>forte<\/strong>/.test(out) && /<em>obliquo<\/em>/.test(out), out);
    ok(/<ul><li>uno<\/li><li>due<\/li><\/ul>/.test(out), out);
    ok(/<ol><li>primo<\/li><li>secondo<\/li><\/ol>/.test(out), out);
    ok(/<table>/.test(out) && out.includes('X1'), out);
    eq((await docs()).filter((d) => d.type === 'docx').length, 1, 'nessuna copia per un documento creato qui');
  });

  await t('Il .docx salvato è valido: XML ben formato e LibreOffice lo converte in PDF con il testo', async () => {
    const buf = await bytesOf((await byName('Nuovo documento')).id);
    const { f, dir } = unz(buf, 'nuovo.docx');
    for (const part of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', '[Content_Types].xml', 'word/_rels/document.xml.rels']) {
      cp.execFileSync('python3', ['-c', 'import sys,xml.dom.minidom as m; m.parse(sys.argv[1])', path.join(dir, part)]);
    }
    cp.execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, f], { timeout: 120000, stdio: 'ignore', env: Object.assign({}, process.env, { HOME: tmp }) });
    const txt = cp.execFileSync('pdftotext', [path.join(tmp, 'nuovo.pdf'), '-']).toString();
    ok(txt.includes('Verbale àè€') && txt.includes('forte obliquo') && txt.includes('secondo') && txt.includes('X1'), txt);
  });

  await t('Esce con modifiche non salvate → salvataggio automatico', async () => {
    await page.locator(ed).click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' ZETA');
    const before = (await docs()).find((d) => d.name === 'Nuovo documento').size;
    await closeEditor();
    await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Nuovo documento').size !== b, before);
    ok((await htmlOf((await byName('Nuovo documento')).id)).includes('ZETA'));
  });

  await t('Importa un .docx vero: contenuto, formati, elenchi annidati, tabella e immagine', async () => {
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Relazione.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: FIX }]);
    await page.waitForSelector('.docrow:has-text("Relazione")');
    await page.locator('.docrow:has-text("Relazione") .docmain').click(); await page.waitForSelector(ed + ' h1');
    const h = await html();
    ok(h.includes('Relazione annuale') && /<strong>grassetto<\/strong>/.test(h) && /<em>corsivo<\/em>/.test(h) && /<u>sottolineato<\/u>/.test(h) && h.includes('àèìòù €'), h);
    ok(/<ul>[\s\S]*Primo punto[\s\S]*<ul>[\s\S]*Sotto punto/.test(h) && /<ol>[\s\S]*Passo uno[\s\S]*Passo due/.test(h), h);
    ok(/<table>/.test(h) && h.includes('B2') && /<img /.test(h) && h.includes('Fine documento'), h);
    ok(!h.includes('INTESTAZIONE'), 'l’intestazione non è mostrata (limite dichiarato)');
  });

  await t('Aprire e chiudere senza modifiche non crea copie', async () => {
    await closeEditor();
    eq((await docs()).filter((d) => d.type === 'docx').length, 2);
  });

  await t('Modifica di un .docx importato: l’originale resta identico, nasce «(modificato)»', async () => {
    const orig = await byName('Relazione'); const before = await bytesOf(orig.id);
    await page.locator('.docrow:has-text("Relazione") .docmain').click(); await page.waitForSelector(ed + ' h1');
    await page.locator(ed + ' h1').click(); await page.keyboard.press('End'); await page.keyboard.type(' 2026');
    await page.click('.word-save'); await page.waitForSelector('.toast:has-text("Copia creata")');
    const cop = await byName('Relazione (modificato)'); ok(cop && cop.origin === 'note', JSON.stringify(cop));
    ok(Buffer.compare(before, await bytesOf(orig.id)) === 0, 'originale modificato!');
    eq(await page.locator('.ds-title').last().innerText(), 'Relazione (modificato)');
    const out = await htmlOf(cop.id);
    ok(out.includes('Relazione annuale 2026') && /<strong>grassetto<\/strong>/.test(out) && /<u>sottolineato<\/u>/.test(out) && out.includes('Sotto punto') && out.includes('Passo due') && out.includes('B2') && /<img /.test(out) && out.includes('àèìòù €'), out);
  });

  await t('Secondo salvataggio: aggiorna la copia, non ne crea un’altra', async () => {
    await page.locator(ed).click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' ancora');
    await page.click('.word-save'); await page.waitForSelector('.toast:has-text("Salvato")');
    eq((await docs()).filter((d) => d.type === 'docx').length, 3);
    ok((await htmlOf((await byName('Relazione (modificato)')).id)).includes('ancora'));
  });

  await t('Il .docx della copia è valido anche per LibreOffice (elenchi, tabella, immagine)', async () => {
    const buf = await bytesOf((await byName('Relazione (modificato)')).id);
    const { f, dir } = unz(buf, 'copia.docx');
    ok(fs.readdirSync(path.join(dir, 'word/media')).length === 1, 'immagine conservata');
    cp.execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, f], { timeout: 120000, stdio: 'ignore', env: Object.assign({}, process.env, { HOME: tmp }) });
    const txt = cp.execFileSync('pdftotext', ['-layout', path.join(tmp, 'copia.pdf'), '-']).toString();
    ok(txt.includes('Relazione annuale 2026') && txt.includes('Sotto punto') && txt.includes('1.') && txt.includes('A2') && txt.includes('Fine documento'), txt);
  });

  await t('Inserisci immagine dal telefono: compare e viene salvata nel .docx', async () => {
    const jpg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 150; const g = c.getContext('2d'); g.fillStyle = '#0a0'; g.fillRect(0, 0, 300, 150); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg')); return Array.from(new Uint8Array(await b.arrayBuffer())); });
    const before = await page.locator(ed + ' img').count();
    await page.locator('input[data-word-img]').setInputFiles({ name: 'verde.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
    await page.waitForFunction((n) => document.querySelectorAll('[data-word-editor] img').length === n + 1, before);
    const sz = (await byName('Relazione (modificato)')).size;
    await page.click('.word-save'); await page.waitForFunction((b) => N.docs._state.docs.find((d) => d.name === 'Relazione (modificato)').size !== b, sz);
    const { dir } = unz(await bytesOf((await byName('Relazione (modificato)')).id), 'img.docx');
    eq(fs.readdirSync(path.join(dir, 'word/media')).length, before + 1);
  });

  await t('Esporta come PDF: nuovo PDF in Documenti con testo, accenti, «?» per i simboli mancanti, immagine, più pagine', async () => {
    await page.locator(ed).click(); await page.keyboard.press('Control+End');
    await page.keyboard.type(' 😀 fine');
    for (let i = 0; i < 60; i++) { await page.keyboard.press('Enter'); await page.keyboard.type('Riga ' + i); }
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="pdf"]');
    await page.waitForSelector('.toast:has-text("PDF creato")');
    const p = (await docs()).find((d) => d.type === 'pdf' && d.name === 'Relazione (modificato)'); ok(p, 'PDF assente');
    const info = await page.evaluate(async (id) => {
      await N.docs.api.lib('pdfjs'); const full = await N.db.docs.get(id); const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(full.data.slice(0)) }).promise; let text = '';
      for (let i = 1; i <= pdf.numPages; i++) { const t = await (await pdf.getPage(i)).getTextContent(); text += t.items.map((x) => x.str).join(' ') + '\n'; }
      return { n: pdf.numPages, text };
    }, p.id);
    ok(info.n >= 2, 'pagine ' + info.n); ok(info.text.includes('Relazione annuale 2026') && info.text.includes('àèìòù €') && info.text.includes('?') && info.text.includes('Riga 59') && info.text.includes('Passo due') && info.text.includes('B2'), info.text.slice(0, 400));
  });

  await t('Salva il testo come nota (nessun errore)', async () => {
    await page.click('button[aria-label="Altro"]'); await page.click('.sheet [data-act="note"]');
    await page.waitForTimeout(400);
    eq(await page.evaluate(() => N.docs._state.docs.length > 0), true);
  });

  await t('Incolla: solo testo semplice, niente HTML dal clipboard', async () => {
    await page.locator(ed).click(); await page.keyboard.press('Control+End');
    await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'INCOLLATO'); dt.setData('text/html', '<script>window.__x=1</script><b style="color:red">INCOLLATO</b>'); document.querySelector('[data-word-editor]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    const h = await html();
    ok(h.includes('INCOLLATO') && !/color:\s*red|<script/.test(h), h.slice(-300));
    eq(await page.evaluate(() => window.__x), undefined);
  });

  await t('sanitize: toglie script, stili, immagini esterne e attributi; tiene dati utili', async () => {
    const r = await page.evaluate(() => N.wordView._logic.sanitize('<div onclick="x()"><p style="text-align:center;color:red">a<script>alert(1)</script><b>b</b></p><img src="http://evil/x.png"><img src="data:image/png;base64,AAAA" onerror="x()"><a href="javascript:x()">link</a><table><tr><td colspan="2">c</td></tr></table><iframe src="x"></iframe></div>'));
    ok(!/script|onclick|onerror|evil|iframe|javascript|color:\s*red|<a /.test(r), r);
    ok(/text-align: center/.test(r) && /<b>b<\/b>/.test(r) && /link/.test(r) && /colspan="2"/.test(r) && /data:image\/png/.test(r), r);
  });

  await t('domToModel: paragrafo vuoto senza a capo fantasma, elenchi annidati, testo sciolto, tabella in tabella', async () => {
    const m = await page.evaluate(() => {
      const el = document.createElement('div');
      el.innerHTML = '<p><br></p>testo sciolto<h4>Quattro</h4><ul><li>a<ul><li>b</li></ul></li><ol><li>c</li></ol></ul><ol><li>x</li></ol><table><tr><td><table><tr><td>in</td></tr></table></td><td colspan="2">due</td></tr></table><p>riga<br>due<br></p>';
      return N.wordView._logic.domToModel(el).map((b) => b.t === 'tbl' ? { t: 'tbl', cells: b.rows[0].map((c) => c.blocks.map((x) => x.runs.map((r) => r.text).join('')).join('+') + ':' + c.span) } : { t: b.t, style: b.style, ord: b.ord, list: b.list, level: b.level, text: b.runs.map((r) => (r.br ? '<br>' : r.text)).join('') });
    });
    eq(JSON.stringify(m[0]), JSON.stringify({ t: 'p', style: 'n', text: '' }), 'vuoto');
    eq(m[1].text, 'testo sciolto'); eq(m[2].style, 'h3');
    eq(m[3].level + ',' + m[3].ord, '0,false'); eq(m[4].level + ',' + m[4].ord, '1,false'); eq(m[5].level + ',' + m[5].ord, '1,true');
    ok(m[5].list !== m[3].list && m[6].list !== m[3].list && m[6].ord === true && m[6].level === 0, JSON.stringify(m));
    eq(JSON.stringify(m[7].cells), JSON.stringify(['in:1', 'due:2']));
    eq(m[8].text, 'riga<br>due', 'br finale non conta');
  });

  await t('Un file .docx corrotto dà un messaggio, non blocca l’app', async () => {
    await page.goBack(); await page.waitForSelector('.docs-screen');
    await page.click('.docs-plus'); await page.click('.sheet [data-import]');
    await page.locator('input[data-docs-input]').setInputFiles([{ name: 'Rotto.docx', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('PK'), Buffer.from('non uno zip')]) }]);
    await page.waitForSelector('.docrow:has-text("Rotto")');
    await page.locator('.docrow:has-text("Rotto") .docmain').click();
    await page.waitForSelector('.toast:has-text("Impossibile aprire")');
    eq(await page.locator(ed).count(), 0);
  });

  await t('Nessuna richiesta esterna e nessun errore imprevisto', async () => {
    eq(external.join(','), '');
    const real = errors.filter((e) => !/file Word non leggibile|Impossibile aprire|Can't find end of central directory|zip|Failed to load resource/i.test(e));
    eq(real.join(' | '), '');
  });

  await browser.close(); server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
