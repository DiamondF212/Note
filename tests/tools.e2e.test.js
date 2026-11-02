// Test end-to-end (Playwright + Chromium). Esecuzione: node tests/tools.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
const SHOT = process.env.SHOTS || '';
let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const mk = async (opts) => {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' }, opts));
    await ctx.grantPermissions([], {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.errors = errors;
    return { ctx, page };
  };
  const openTools = async (page, tab) => {
    if (!(await page.locator('.tools-sheet').count())) {
      await page.click('button[aria-label="Menu"]');
      await page.click('.drawer .item:has-text("Strumenti")');
      await page.waitForSelector('.tools-sheet');
    }
    if (tab) await page.click('.tools-tab[data-tab="' + tab + '"]');
  };
  const closeTools = async (page) => { await page.goBack(); await page.waitForSelector('.tools-sheet', { state: 'detached' }); };
  const shot = async (page, n) => { if (SHOT) await page.screenshot({ path: path.join(SHOT, n + '.png') }); };

  /* ---------- apertura e navigazione ---------- */
  let { ctx, page } = await mk();
  await page.goto(base); await page.waitForSelector('#list');
  await t('la voce «Strumenti» è nel menu laterale e apre il pannello', async () => {
    await openTools(page);
    eq(await page.locator('.tools-tab').count(), 4);
    ok(await page.locator('.tools-sheet h3').innerText() === 'Strumenti');
    await shot(page, '01-unita');
  });
  await t('il tasto Indietro chiude il pannello', async () => { await closeTools(page); eq(await page.locator('.tools-sheet').count(), 0); });
  await t('le 4 schede si alternano', async () => {
    await openTools(page);
    for (const id of ['unit', 'disc', 'time', 'pad']) {
      await page.click('.tools-tab[data-tab="' + id + '"]');
      eq(await page.locator('.tools-pane:not(.hidden)').getAttribute('data-pane'), id);
    }
  });

  /* ---------- convertitore ---------- */
  await t('convertitore: 1 m = 3,28 ft (valore iniziale + categoria predefinita)', async () => {
    await page.click('.tools-tab[data-tab="unit"]');
    eq(await page.inputValue('#tools-unit-from'), 'm'); eq(await page.inputValue('#tools-unit-to'), 'ft');
    eq(await page.inputValue('#tools-unit-out'), '3,280839895');
  });
  await t('convertitore: aggiornamento in tempo reale mentre si scrive', async () => {
    await page.fill('#tools-unit-in', '10'); eq(await page.inputValue('#tools-unit-out'), '32,80839895');
    await page.fill('#tools-unit-in', ''); eq(await page.inputValue('#tools-unit-out'), '');
  });
  await t('convertitore: virgola decimale e valori non validi', async () => {
    await page.fill('#tools-unit-in', '2,5'); eq(await page.inputValue('#tools-unit-out'), '8,202099738');
    await page.fill('#tools-unit-in', 'abc'); eq(await page.inputValue('#tools-unit-out'), '—');
    ok((await page.innerText('#tools-unit-note')).includes('non valido'));
  });
  await t('convertitore: peso kg → libbre', async () => {
    await page.click('.tools-chips [data-cat="mass"]'); await page.fill('#tools-unit-in', '70');
    eq(await page.inputValue('#tools-unit-from'), 'kg'); eq(await page.inputValue('#tools-unit-to'), 'lb');
    eq(await page.inputValue('#tools-unit-out'), '154,3235835');
  });
  await t('convertitore: temperatura 100 °C = 212 °F, 0 °F = −17,78 °C', async () => {
    await page.click('.tools-chips [data-cat="temp"]'); await page.fill('#tools-unit-in', '100');
    eq(await page.inputValue('#tools-unit-out'), '212');
    await page.fill('#tools-unit-in', '0'); await page.selectOption('#tools-unit-from', 'F'); await page.selectOption('#tools-unit-to', 'C');
    eq(await page.inputValue('#tools-unit-out'), '-17,77777778');
    await page.fill('#tools-unit-in', '-500'); await page.selectOption('#tools-unit-from', 'C'); await page.selectOption('#tools-unit-to', 'F');
    eq(await page.inputValue('#tools-unit-out'), '—'); ok((await page.innerText('#tools-unit-note')).includes('zero assoluto'));
  });
  await t('convertitore: pulsante inverti scambia unità e porta il risultato nel campo', async () => {
    await page.fill('#tools-unit-in', '100'); await page.selectOption('#tools-unit-from', 'C'); await page.selectOption('#tools-unit-to', 'F');
    await page.click('#tools-unit-swap');
    eq(await page.inputValue('#tools-unit-from'), 'F'); eq(await page.inputValue('#tools-unit-to'), 'C');
    eq(await page.inputValue('#tools-unit-in'), '212'); eq(await page.inputValue('#tools-unit-out'), '100');
  });
  await t('convertitore: tutte le categorie hanno menu popolati e risultato numerico', async () => {
    const cats = await page.$$eval('.tools-chips [data-cat]', (b) => b.map((x) => x.dataset.cat));
    eq(cats.length, 10);
    for (const c of cats.filter((x) => x !== 'base')) {
      await page.click('.tools-chips [data-cat="' + c + '"]'); await page.fill('#tools-unit-in', '1');
      ok((await page.locator('#tools-unit-from option').count()) >= 3, c + ' unità'); ok(/\d/.test(await page.inputValue('#tools-unit-out')), c + ' risultato');
    }
  });
  await t('convertitore: scelta ricordata alla riapertura', async () => {
    await page.click('.tools-chips [data-cat="volume"]'); await page.fill('#tools-unit-in', '3'); await page.selectOption('#tools-unit-to', 'ml');
    await closeTools(page); await openTools(page, 'unit');
    eq(await page.inputValue('#tools-unit-in'), '3'); eq(await page.inputValue('#tools-unit-to'), 'ml'); eq(await page.inputValue('#tools-unit-out'), '3000');
  });

  /* ---------- sconti ---------- */
  await t('sconti: 100 € con 20% → finale 80 €, risparmio 20 €', async () => {
    await page.click('.tools-tab[data-tab="disc"]');
    await page.fill('#tools-price', '100'); await page.fill('#tools-pct1', '20');
    const norm = (s) => s.replace(/\s/g, ' ');
    eq(norm(await page.innerText('#tools-final')), '80,00 €'); eq(norm(await page.innerText('#tools-saved')), '20,00 €');
    await shot(page, '02-sconti');
  });
  await t('sconti: tempo reale, virgola e chip rapidi', async () => {
    await page.fill('#tools-price', '59,90'); await page.click('.tools-chips [data-pct="15"]');
    eq(await page.inputValue('#tools-pct1'), '15');
    eq((await page.innerText('#tools-final')).replace(/\s/g, ' '), '50,92 €'); eq((await page.innerText('#tools-saved')).replace(/\s/g, ' '), '8,98 €');
  });
  await t('sconti: secondo sconto a cascata', async () => {
    await page.fill('#tools-price', '100'); await page.fill('#tools-pct1', '20'); await page.fill('#tools-pct2', '10');
    eq((await page.innerText('#tools-final')).replace(/\s/g, ' '), '72,00 €'); ok((await page.innerText('#tools-eff')).includes('28'));
  });
  await t('sconti: errori (oltre 100%, negativo, prezzo non valido)', async () => {
    await page.fill('#tools-pct2', ''); await page.fill('#tools-pct1', '120');
    ok((await page.innerText('#tools-disc-err')).includes('100%')); eq(await page.innerText('#tools-final'), '—');
    await page.fill('#tools-pct1', '-5'); ok((await page.innerText('#tools-disc-err')).includes('negativo'));
    await page.fill('#tools-pct1', '10'); await page.fill('#tools-price', 'xx'); ok((await page.innerText('#tools-disc-err')).length > 0);
    await page.fill('#tools-price', '50'); eq(await page.innerText('#tools-disc-err'), '');
  });
  await t('sconti: valori ricordati e pulsante Azzera', async () => {
    await closeTools(page); await openTools(page, 'disc');
    eq(await page.inputValue('#tools-price'), '50'); eq(await page.inputValue('#tools-pct1'), '10');
    await page.click('#tools-disc-reset'); eq(await page.inputValue('#tools-price'), ''); eq(await page.innerText('#tools-final'), '—');
  });

  await closeTools(page);
  ok(page.errors.length === 0, 'errori in console: ' + page.errors.join(' | '));
  await ctx.close();

  /* ---------- cronometro e timer con orologio simulato ---------- */
  ({ ctx, page } = await mk());
  await page.clock.install({ time: new Date('2026-10-31T10:00:00') });
  await page.goto(base); await page.waitForSelector('#list');
  await openTools(page, 'time');
  await t('cronometro: avvio, scorrimento, parziali, pausa, ripresa, reset', async () => {
    eq(await page.innerText('#tools-sw-disp'), '00:00,00');
    eq(await page.isDisabled('#tools-sw-lap'), true); eq(await page.isDisabled('#tools-sw-reset'), true);
    await page.click('#tools-sw-start'); eq(await page.innerText('#tools-sw-start'), 'Pausa');
    await page.clock.runFor(12340);
    ok(/^00:1[23],/.test(await page.innerText('#tools-sw-disp')), await page.innerText('#tools-sw-disp'));
    await page.click('#tools-sw-lap'); await page.clock.runFor(5000); await page.click('#tools-sw-lap');
    eq(await page.locator('.tools-lap').count(), 2);
    ok((await page.locator('.tools-lap').first().innerText()).includes('Parziale 2'), 'ordine: più recente in alto');
    ok(/\+00:0[5-6],/.test(await page.locator('.tools-lap').first().innerText()));
    await page.click('#tools-sw-start'); eq(await page.innerText('#tools-sw-start'), 'Riprendi');
    const frozen = await page.innerText('#tools-sw-disp'); await page.clock.runFor(4000); eq(await page.innerText('#tools-sw-disp'), frozen, 'in pausa non avanza');
    await page.click('#tools-sw-start'); await page.clock.runFor(1000);
    ok(/^00:(18|19),/.test(await page.innerText('#tools-sw-disp')), await page.innerText('#tools-sw-disp'));
    await shot(page, '03-cronometro');
    await page.click('#tools-sw-reset'); eq(await page.innerText('#tools-sw-disp'), '00:00,00'); eq(await page.locator('.tools-lap').count(), 0);
  });
  await t('cronometro: continua a girare a pannello chiuso e dopo il ricaricamento', async () => {
    await page.click('#tools-sw-start'); await page.clock.runFor(2000);
    await closeTools(page); await page.clock.runFor(30000);
    await page.reload(); await page.waitForSelector('#list'); await openTools(page, 'time');
    const v = await page.innerText('#tools-sw-disp'); ok(/^00:(3[2-9]|4\d)/.test(v), 'valore ' + v);
    await page.click('#tools-sw-reset');
  });
  await t('conto alla rovescia: impostazione min/sec, avvio, pausa, ripresa', async () => {
    await page.click('#tools-mode-cd');
    await page.fill('#tools-cd-min', '0'); await page.fill('#tools-cd-sec', '10');
    eq(await page.innerText('#tools-cd-disp'), '00:10');
    await page.click('#tools-cd-start'); eq(await page.innerText('#tools-cd-start'), 'Pausa');
    ok(await page.locator('#tools-cd-set.hidden').count() === 1, 'campi nascosti durante il conto');
    await page.clock.runFor(3100); eq(await page.innerText('#tools-cd-disp'), '00:07');
    await page.click('#tools-cd-start'); await page.clock.runFor(5000); eq(await page.innerText('#tools-cd-disp'), '00:07', 'pausa');
    await page.click('#tools-cd-start'); await page.clock.runFor(2000); eq(await page.innerText('#tools-cd-disp'), '00:05');
    await shot(page, '04-conto');
  });
  await t('conto alla rovescia: avviso visivo al termine (pannello aperto sulla scheda Timer)', async () => {
    await page.clock.runFor(5200);
    eq(await page.innerText('#tools-cd-disp'), '00:00'); ok(await page.locator('#tools-cd-disp.done').count() === 1, 'display in allarme');
    ok(await page.locator('.tools-cd.is-done').count() === 1); eq(await page.innerText('#tools-cd-start'), 'Nuovo');
    eq(await page.locator('.tools-alarm').count(), 0, 'sulla scheda Timer l\'avviso è nella scheda stessa');
    await shot(page, '05-scaduto');
    await page.click('#tools-cd-reset'); eq(await page.innerText('#tools-cd-start'), 'Avvio');
  });
  await t('conto alla rovescia: preset e validazione (0:00 non permesso)', async () => {
    await page.click('#tools-cd-presets [data-s="180"]'); eq(await page.inputValue('#tools-cd-min'), '3'); eq(await page.inputValue('#tools-cd-sec'), '0'); eq(await page.innerText('#tools-cd-disp'), '03:00');
    await page.fill('#tools-cd-min', '0'); await page.fill('#tools-cd-sec', '0');
    ok((await page.innerText('#tools-cd-err')).includes('almeno'));
    await page.click('#tools-cd-start'); eq(await page.innerText('#tools-cd-start'), 'Avvio', 'non parte con 0');
    await page.fill('#tools-cd-min', '1'); await page.fill('#tools-cd-sec', '90'); eq(await page.innerText('#tools-cd-disp'), '02:30', '90 s normalizzati');
  });
  await t('conto alla rovescia: allarme anche a pannello chiuso, e sopravvive al ricaricamento', async () => {
    await page.fill('#tools-cd-min', '0'); await page.fill('#tools-cd-sec', '20'); await page.click('#tools-cd-start');
    await closeTools(page); await page.clock.runFor(8000);
    await page.reload(); await page.waitForSelector('#list'); await openTools(page, 'time');
    { const v = await page.innerText('#tools-cd-disp'); const sec = Number(v.slice(3)); ok(v.startsWith('00:') && sec >= 1 && sec <= 12, 'riprende: ' + v); }
    await closeTools(page);
    eq(await page.locator('.tools-alarm').count(), 0); await page.clock.runFor(14000);
    eq(await page.locator('.tools-alarm').count(), 1, 'overlay con pannello chiuso');
    await page.click('.tools-alarm .btn.pri'); await page.waitForSelector('.tools-sheet');
    eq(await page.locator('.tools-alarm').count(), 0); ok(await page.locator('#tools-cd-disp.done').count() === 1);
    await page.click('#tools-cd-reset');
  });
  await t('conto alla rovescia: scaduto mentre si è su un\'altra scheda → avviso ma niente cambio scheda', async () => {
    await page.click('#tools-cd-presets [data-s="30"]'); await page.click('#tools-cd-start');
    await page.click('.tools-tab[data-tab="pad"]'); await page.clock.runFor(31000);
    eq(await page.locator('.tools-alarm').count(), 1); eq(await page.locator('.tools-pane:not(.hidden)').getAttribute('data-pane'), 'pad');
    await page.click('.tools-alarm .btn:has-text("Chiudi")'); await page.click('.tools-tab[data-tab="time"]'); await page.click('#tools-cd-reset');
  });
  ok(page.errors.length === 0, 'errori in console: ' + page.errors.join(' | '));
  await ctx.close();

  /* ---------- blocco note ---------- */
  ({ ctx, page } = await mk());
  await page.goto(base); await page.waitForSelector('#list');
  await openTools(page, 'pad');
  await t('appunti: salvataggio automatico in localStorage', async () => {
    await page.fill('#tools-pad', 'Comprare latte\nChiamare Marco');
    await page.waitForTimeout(700);
    eq(await page.evaluate(() => localStorage.getItem('lmn.tools.pad')), 'Comprare latte\nChiamare Marco');
    eq(await page.innerText('#tools-pad-status'), 'Salvato'); ok((await page.innerText('#tools-pad-count')).startsWith('4 parole'));
    await shot(page, '06-appunti');
  });
  await t('appunti: salvati subito anche se si chiude il pannello senza attendere', async () => {
    await page.fill('#tools-pad', 'veloce'); await closeTools(page);
    eq(await page.evaluate(() => localStorage.getItem('lmn.tools.pad')), 'veloce');
  });
  await t('appunti: persistono dopo il ricaricamento', async () => {
    await page.reload(); await page.waitForSelector('#list'); await openTools(page, 'pad');
    eq(await page.inputValue('#tools-pad'), 'veloce');
  });
  await t('appunti: non creano note nel database principale', async () => {
    const n = await page.evaluate(() => window.__app.S.notes.length); eq(n, 0);
  });
  await t('appunti: «Salva come nota» crea una nota vera', async () => {
    await page.fill('#tools-pad', 'Idea regalo\nLibro di cucina');
    await page.click('#tools-pad-tonote');
    const r = await page.evaluate(() => window.__app.S.notes.map((n) => [n.title, n.body]));
    eq(JSON.stringify(r), JSON.stringify([['Idea regalo', 'Idea regalo\nLibro di cucina']]));
    const inDb = await page.evaluate(() => window.__app.N.db.all().then((a) => a.length)); eq(inDb, 1);
  });
  await t('appunti: Svuota (con conferma) cancella il testo; Annulla lo conserva', async () => {
    page.once('dialog', (d) => d.dismiss()); await page.click('#tools-pad-clear'); ok((await page.inputValue('#tools-pad')).length > 0);
    page.once('dialog', (d) => d.accept()); await page.click('#tools-pad-clear'); eq(await page.inputValue('#tools-pad'), '');
    eq(await page.evaluate(() => localStorage.getItem('lmn.tools.pad')), '');
  });
  ok(page.errors.length === 0, 'errori in console: ' + page.errors.join(' | '));
  await ctx.close();


  /* ---------- basi numeriche ---------- */
  ({ ctx, page } = await mk());
  await page.goto(base); await page.waitForSelector('#list'); await openTools(page, 'unit');
  await page.click('.tools-chips [data-cat="base"]');
  await t('basi: 255 decimale → binario, tabella con BIN/OCT/DEC/HEX', async () => {
    eq(await page.inputValue('#tools-base-from'), '10'); eq(await page.inputValue('#tools-base-to'), '2');
    eq(await page.inputValue('#tools-base-out'), '11111111');
    eq(await page.locator('.tools-baserow').count(), 4);
    const rows = await page.$$eval('.tools-baserow', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')));
    eq(rows.join('|'), 'BIN 11111111|OCT 377|DEC 255|HEX FF');
    ok(await page.locator('.tools-convbox.hidden').count() === 1, 'pannello unità nascosto'); await shot(page, '07-basi');
  });
  await t('basi: ogni coppia tra bin, oct, dec, hex (e viceversa)', async () => {
    const cases = [['10', '255', 'FF', '377', '11111111'], ['16', 'FF', '255', '377', '11111111'], ['2', '11111111', '255', '377', 'FF'], ['8', '377', '255', 'FF', '11111111']];
    const map = { '2': 'BIN', '8': 'OCT', '10': 'DEC', '16': 'HEX' };
    for (const from of ['2', '8', '10', '16']) for (const to of ['2', '8', '10', '16']) {
      const src = { '2': '11111111', '8': '377', '10': '255', '16': 'FF' };
      await page.selectOption('#tools-base-from', from); await page.selectOption('#tools-base-to', to); await page.fill('#tools-base-in', src[from]);
      eq(await page.inputValue('#tools-base-out'), src[to], from + '→' + to);
    }
  });
  await t('basi: digitando in tempo reale, minuscole, negativi e virgola', async () => {
    await page.selectOption('#tools-base-from', '16'); await page.selectOption('#tools-base-to', '10');
    await page.fill('#tools-base-in', 'ff'); eq(await page.inputValue('#tools-base-out'), '255');
    await page.fill('#tools-base-in', '-a'); eq(await page.inputValue('#tools-base-out'), '-10');
    await page.selectOption('#tools-base-from', '10'); await page.selectOption('#tools-base-to', '2');
    await page.fill('#tools-base-in', '10,5'); eq(await page.inputValue('#tools-base-out'), '1010,1');
    await page.fill('#tools-base-in', '0.1'); eq(await page.inputValue('#tools-base-out'), '0,000110011001'); ok((await page.innerText('#tools-base-note')).includes('approssimato'));
  });
  await t('basi: basi personalizzate 3–36 (es. base 36)', async () => {
    await page.selectOption('#tools-base-from', '36'); await page.selectOption('#tools-base-to', '10'); await page.fill('#tools-base-in', 'zz');
    eq(await page.inputValue('#tools-base-out'), '1295');
    eq(await page.locator('#tools-base-from option').count(), 35);
  });
  await t('basi: errore su cifra non valida, poi si riprende', async () => {
    await page.selectOption('#tools-base-from', '2'); await page.selectOption('#tools-base-to', '10'); await page.fill('#tools-base-in', '1012');
    eq(await page.inputValue('#tools-base-out'), '—'); ok((await page.innerText('#tools-base-note')).includes('«2»')); ok(await page.locator('#tools-base-note.bad').count() === 1);
    await page.fill('#tools-base-in', '101'); eq(await page.inputValue('#tools-base-out'), '5'); eq(await page.locator('#tools-base-note.bad').count(), 0);
    await page.fill('#tools-base-in', ''); eq(await page.inputValue('#tools-base-out'), '');
  });
  await t('basi: inverti scambia le basi e porta il risultato nel campo', async () => {
    await page.selectOption('#tools-base-from', '10'); await page.selectOption('#tools-base-to', '16'); await page.fill('#tools-base-in', '4095');
    eq(await page.inputValue('#tools-base-out'), 'FFF'); await page.click('#tools-base-swap');
    eq(await page.inputValue('#tools-base-from'), '16'); eq(await page.inputValue('#tools-base-to'), '10'); eq(await page.inputValue('#tools-base-in'), 'FFF'); eq(await page.inputValue('#tools-base-out'), '4095');
  });
  await t('basi: numero enorme senza perdite e scelta ricordata alla riapertura', async () => {
    await page.selectOption('#tools-base-from', '10'); await page.selectOption('#tools-base-to', '16'); await page.fill('#tools-base-in', '340282366920938463463374607431768211455');
    eq(await page.inputValue('#tools-base-out'), 'F'.repeat(32));
    await closeTools(page); await openTools(page, 'unit');
    eq(await page.locator('.tools-basebox:not(.hidden)').count(), 1); eq(await page.inputValue('#tools-base-to'), '16'); eq(await page.inputValue('#tools-base-out'), 'F'.repeat(32));
    await page.click('.tools-chips [data-cat="length"]'); eq(await page.locator('.tools-convbox:not(.hidden)').count(), 1); eq(await page.inputValue('#tools-unit-from'), 'm');
  });
  ok(page.errors.length === 0, 'errori in console: ' + page.errors.join(' | '));
  await ctx.close();

  /* ---------- timer in background ---------- */
  ({ ctx, page } = await mk());
  await page.addInitScript(() => {
    window.__ln = { calls: [] };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
      checkPermissions: async () => ({ display: 'prompt' }), requestPermissions: async () => { window.__ln.calls.push(['perm']); return { display: 'granted' }; },
      createChannel: async (o) => { window.__ln.calls.push(['channel', o.id, o.importance]); },
      cancel: async (o) => { window.__ln.calls.push(['cancel', o.notifications[0].id]); },
      schedule: async (o) => { const n = o.notifications[0]; window.__ln.calls.push(['schedule', n.id, +n.schedule.at, n.schedule.allowWhileIdle, n.title]); }
    } } };
    window.__workers = 0; const W = window.Worker; window.Worker = function (u) { window.__workers++; return new W(u); };
  });
  await page.clock.install({ time: new Date('2026-10-31T10:00:00') });
  await page.goto(base); await page.waitForSelector('#list'); await openTools(page, 'time'); await page.click('#tools-mode-cd');
  const calls = () => page.evaluate(() => window.__ln.calls.map((c) => c[0]));
  await t('background: avvio programma una notifica di sistema alla scadenza (con permesso richiesto)', async () => {
    await page.fill('#tools-cd-min', '0'); await page.fill('#tools-cd-sec', '30'); await page.click('#tools-cd-start'); await page.waitForTimeout(150);
    const c = await page.evaluate(() => window.__ln.calls);
    ok(c.some((x) => x[0] === 'perm'), 'permesso'); ok(c.some((x) => x[0] === 'channel' && x[1] === 'lmn-timer' && x[2] === 5), 'canale ad alta priorità');
    const sch = c.filter((x) => x[0] === 'schedule'); eq(sch.length, 1); eq(sch[0][1], 7101); eq(sch[0][3], true, 'allowWhileIdle'); eq(sch[0][4], 'Tempo scaduto');
    const endExp = await page.evaluate(() => window.__app && JSON.parse(localStorage.getItem('lmn.tools.cd')).end); eq(sch[0][2], endExp, 'orario = fine del conto');
  });
  await t('background: pausa annulla la notifica, ripresa la riprogramma con il tempo residuo', async () => {
    await page.clock.runFor(10000); await page.click('#tools-cd-start'); await page.waitForTimeout(100);
    eq((await calls()).filter((x) => x === 'schedule').length, 1); ok((await calls()).slice(-1)[0] === 'cancel', 'cancel dopo pausa');
    await page.click('#tools-cd-start'); await page.waitForTimeout(150);
    const sch = await page.evaluate(() => window.__ln.calls.filter((c) => c[0] === 'schedule')); eq(sch.length, 2);
    const now = await page.evaluate(() => Date.now()); const left = sch[1][2] - now; ok(left > 18000 && left <= 20500, 'residuo ' + left);
  });
  await t('background: a scadenza con notifica di sistema non si duplica l\'avviso interno, ma resta quello a schermo', async () => {
    await closeTools(page); await page.clock.runFor(21000);
    eq(await page.locator('.tools-alarm').count(), 1); eq(await page.locator('.toast:has-text("Tempo scaduto")').count(), 0, 'niente doppione');
    await page.click('.tools-alarm .btn:has-text("Chiudi")');
  });
  await t('background: reset annulla la notifica programmata', async () => {
    await openTools(page, 'time'); await page.click('#tools-cd-reset'); await page.click('#tools-cd-presets [data-s="60"]'); await page.click('#tools-cd-start'); await page.waitForTimeout(100);
    await page.click('#tools-cd-reset'); await page.waitForTimeout(100); ok((await calls()).slice(-1)[0] === 'cancel');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('lmn.tools.cd')).native), false);
  });
  await t('background: il controllo è affidato a un Web Worker', async () => {
    ok((await page.evaluate(() => window.__workers)) >= 1, 'worker non creato');
  });
  await ctx.close();

  ({ ctx, page } = await mk());
  await page.goto(base); await page.waitForSelector('#list'); await openTools(page, 'time'); await page.click('#tools-mode-cd');
  await t('background: in tempo reale scade anche con pannello chiuso e pagina nascosta', async () => {
    await page.fill('#tools-cd-min', '0'); await page.fill('#tools-cd-sec', '2'); await page.click('#tools-cd-start'); await closeTools(page);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForSelector('.tools-alarm', { timeout: 5000 });
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('lmn.tools.cd')).state), 'done');
  });
  await ctx.close();

  /* ---------- layout su schermi piccoli e tema chiaro ---------- */
  for (const [w, hgt, scheme] of [[320, 568, 'dark'], [360, 640, 'light'], [412, 915, 'dark'], [768, 1024, 'light']]) {
    ({ ctx, page } = await mk({ viewport: { width: w, height: hgt }, colorScheme: scheme }));
    await page.goto(base); await page.waitForSelector('#list'); await openTools(page);
    await t('layout ' + w + 'x' + hgt + ' (' + scheme + '): nessuno scroll orizzontale in ogni scheda', async () => {
      for (const id of ['unit', 'disc', 'time', 'pad']) {
        await page.click('.tools-tab[data-tab="' + id + '"]');
        if (id === 'time') { await page.click('#tools-mode-cd'); }
        const m = await page.evaluate(() => { const s = document.querySelector('.tools-sheet'); return { doc: document.documentElement.scrollWidth - innerWidth, sheet: s.scrollWidth - s.clientWidth, top: s.getBoundingClientRect().top }; });
        ok(m.doc <= 0 && m.sheet <= 0, id + ' overflow ' + JSON.stringify(m)); ok(m.top >= 0, 'sheet fuori schermo');
        const small = await page.$$eval('.tools-pane:not(.hidden) button, .tools-pane:not(.hidden) select, .tools-pane:not(.hidden) input', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 32 && !e.classList.contains('chip')).map((e) => e.id || e.className));
        ok(small.length === 0, 'elementi troppo piccoli: ' + small.join(','));
      }
      await page.click('.tools-tab[data-tab="unit"]'); await shot(page, '10-layout-' + w + '-' + scheme);
    });
    await ctx.close();
  }

  /* ---------- offline vero con service worker ---------- */
  ({ ctx, page } = await mk({ serviceWorkers: 'allow' }));
  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForTimeout(800);
  await t('offline: tools.js è nella cache del service worker', async () => {
    const hit = await page.evaluate(async () => !!(await caches.match('./tools.js'))); ok(hit, 'tools.js non in cache');
    const keys = await page.evaluate(() => caches.keys()); ok(keys.includes('le-mie-note-v8'), keys.join());
  });
  await ctx.setOffline(true);
  await page.reload(); await page.waitForSelector('#list');
  await t('offline: ricaricando senza rete gli strumenti funzionano', async () => {
    await openTools(page, 'unit'); await page.fill('#tools-unit-in', '5'); await page.click('.tools-chips [data-cat="temp"]');
    await page.fill('#tools-unit-in', '37'); eq(await page.inputValue('#tools-unit-out'), '98,6');
    await page.click('.tools-tab[data-tab="disc"]'); await page.fill('#tools-price', '200'); await page.fill('#tools-pct1', '25');
    eq((await page.innerText('#tools-final')).replace(/\s/g, ' '), '150,00 €');
    await page.click('.tools-tab[data-tab="pad"]'); await page.fill('#tools-pad', 'offline ok'); await page.waitForTimeout(500);
    eq(await page.evaluate(() => localStorage.getItem('lmn.tools.pad')), 'offline ok');
  });
  await ctx.close();

  /* ---------- regressione sulle funzioni esistenti + scorciatoia ---------- */
  ({ ctx, page } = await mk());
  await page.goto(base + '?tools=disc'); await page.waitForSelector('#list');
  await t('scorciatoia ?tools=disc apre direttamente la scheda Sconti', async () => {
    await page.waitForSelector('.tools-sheet'); eq(await page.locator('.tools-pane:not(.hidden)').getAttribute('data-pane'), 'disc');
  });
  await closeTools(page);
  await t('regressione: l\'app crea ancora una nota e la mostra in elenco', async () => {
    await page.click('#fab'); await page.click('.fabs button:first-child');
    await page.waitForSelector('.editor'); await page.fill('.ed-title', 'Prova'); await page.waitForTimeout(900);
    const n = await page.evaluate(() => window.__app.S.notes.filter((x) => x.title === 'Prova').length); eq(n, 1);
  });
  await t('regressione: altre voci del menu (Calendario, Panoramica) si aprono ancora', async () => {
    await page.goBack(); await page.waitForSelector('.editor', { state: 'detached' });
    await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Calendario")'); await page.waitForSelector('.calendar-wrap'); await page.goBack();
    await page.waitForSelector('.calendar-wrap', { state: 'detached' });
    await page.click('button[aria-label="Menu"]'); await page.click('.drawer .item:has-text("Panoramica")'); await page.waitForSelector('.dash');
  });
  ok(page.errors.length === 0, 'errori in console: ' + page.errors.join(' | '));
  await ctx.close();

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
