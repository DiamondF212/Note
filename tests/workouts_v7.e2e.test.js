// Test end-to-end di Allenamenti v7: mappa dei muscoli, equilibrio muscolare, confronto con due corpi.
// Esecuzione: node tests/workouts_v7.e2e.test.js
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
async function t(name, fn) { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log(' FAIL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 12).join('\n       ')); } }
const ok = (c, m) => { if (!c) throw new Error(m || 'condizione falsa'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' atteso «' + b + '» ottenuto «' + a + '»'); };
const has = (text, ...parts) => parts.forEach((p) => ok(text.includes(p), 'manca «' + p + '» in: ' + text));

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Sessioni: una 40 giorni fa, le altre negli ultimi 10 giorni. Negli ultimi 30 giorni: 18 serie di lavoro.
  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(async () => {
    const DAY = 864e5, now = Date.now();
    const sets = (reps, kg) => reps.map((r) => ({ reps: r, kg, done: true }));
    const e = (id, name, group, s, extra) => Object.assign({ exerciseId: id, name, group, sets: s }, extra || {});
    const sess = (id, ago, exercises) => ({ id, dayId: 'd1', dayName: 'Allenamento', startedAt: now - ago * DAY - 3600e3, completedAt: now - ago * DAY, exercises });
    const warm = sets([8, 8, 8], 50); warm.unshift({ reps: 5, kg: 20, done: true, type: 'warmup' });
    await window.N.db.workouts.put({
      id: 'program', updated: now, bodyWeights: [], reminder: { enabled: false, time: '18:00' },
      days: [{ id: 'd1', name: 'Allenamento', weekday: '', created: now - 60 * DAY, activeSession: null, exercises: [
        { id: 'e1', name: 'Panca piana', setCount: 3, reps: 8, kg: 50, group: 'Petto' }] }],
      sessions: [
        sess('s-old', 40, [e('e1', 'Panca piana', 'Petto', sets([8, 8, 8], 45)), e('e4', 'Squat', 'Gambe', sets([5, 5, 5], 70))]),
        sess('s0', 10, [e('e1', 'Panca piana', 'Petto', sets([8, 8, 8], 47.5))]),
        sess('s1', 3, [e('e1', 'Panca piana', 'Petto', sets([8, 8, 8], 50)), e('e2', 'Rematore al cavo', 'Dorso', sets([10, 10], 40)),
          e('e3', 'Dead hang', 'Dorso', sets([30, 40], 0), { unit: 'time' }), e('e4', 'Squat', 'Gambe', sets([5, 5, 5, 5], 80)), e('e5', 'Leg curl seduto', 'Gambe', sets([10], 30))]),
        sess('s2', 1, [e('e1', 'Panca piana', 'Petto', warm)])
      ]
    });
  });
  const openWorkouts = async () => { await page.click('#dock button[data-dock="workouts"]'); await page.waitForSelector('.workout-day-card'); };
  await page.reload(); await page.waitForSelector('#list');
  await openWorkouts();

  const zone = (view, id) => page.locator('[data-muscle-map] [data-bm-figure="' + view + '"] [data-zone="' + id + '"]');
  const lvOf = async (loc) => ((await loc.getAttribute('class')).match(/lv(\d)/) || [])[1];
  const detail = () => page.locator('[data-muscle-detail]').innerText();
  const summary = () => page.locator('[data-bm-summary]').innerText();
  // Un dito tocca la forma del muscolo, non il centro del riquadro (che per braccia e spalle cade tra le due metà).
  const tapZ = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: 'center' })); await loc.locator('path').first().tap(); };
  const closeSheet = async () => { await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' }); };

  /* ---------- mappa ---------- */
  await t('la panoramica mostra la mappa con due corpi, 30 giorni e i muscoli colorati', async () => {
    eq(await page.locator('[data-muscle-map]').count(), 1);
    eq(await page.locator('[data-muscle-map] [data-bm-figure]').count(), 2);
    eq(await page.locator('[data-muscle-map] [data-muscle-days="30"]').getAttribute('aria-pressed'), 'true');
    has(await summary(), '18 serie di lavoro negli ultimi 30 giorni');
    eq(await lvOf(zone('front', 'petto')), '4', 'il petto è il più allenato');
    eq(await lvOf(zone('back', 'dorso')), '2');
    eq(await lvOf(zone('front', 'quadricipiti')), '2');
    eq(await lvOf(zone('back', 'femorali')), '1');
    eq(await lvOf(zone('front', 'addome')), '0', 'l’addome non è allenato');
    has(await detail(), 'Tocca un muscolo per vedere esercizi, ripetizioni e carichi');
  });
  await t('i corpi stanno nello schermo e le zone sono abbastanza grandi da toccare', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, 'scorrimento orizzontale di ' + over + ' px');
    for (const [view, id] of [['front', 'petto'], ['front', 'quadricipiti'], ['back', 'dorso'], ['back', 'glutei']]) {
      await zone(view, id).scrollIntoViewIfNeeded();
      const box = await zone(view, id).boundingBox();
      ok(box && box.width >= 40 && box.height >= 30, id + ' troppo piccolo: ' + JSON.stringify(box));
    }
  });
  await t('toccando un muscolo compaiono esercizi, ripetizioni e carichi; un secondo tocco lo chiude', async () => {
    await zone('front', 'petto').scrollIntoViewIfNeeded();
    await tapZ(zone('front', 'petto'));
    const d = await detail();
    has(d, 'Petto', '9 serie', 'Panca piana', '9 serie · 3 sessioni', 'Rip 8', '47,5–50 kg', 'migliore 50 kg × 8');
    ok(!d.includes('20 kg'), 'il riscaldamento non conta');
    eq(await zone('front', 'petto').getAttribute('aria-pressed'), 'true');
    ok(((await zone('front', 'petto').getAttribute('class')) || '').includes('sel'));
    await tapZ(zone('front', 'petto'));
    has(await detail(), 'Tocca un muscolo');
    eq(await zone('front', 'petto').getAttribute('aria-pressed'), 'false');
  });
  await t('un muscolo del retro mostra anche gli esercizi a tempo; uno non allenato lo dice', async () => {
    await tapZ(zone('back', 'dorso'));
    const d = await detail();
    has(d, 'Dorso', '4 serie', 'Rematore al cavo', 'Rip 10', '40 kg', 'migliore 40 kg × 10', 'Dead hang', 'Tempo 30 s – 40 s', 'migliore 40 s');
    eq(await page.locator('[data-muscle-map] [data-bm-exercise]').count(), 2);
    await tapZ(zone('front', 'addome'));
    has(await detail(), 'Nessuna serie per addome in questo periodo');
    await tapZ(zone('front', 'addome'));
  });
  await t('spalle e polpacci compaiono su entrambi i lati e si evidenziano insieme', async () => {
    await tapZ(zone('front', 'spalle'));
    eq(await zone('back', 'spalle').getAttribute('aria-pressed'), 'true');
    await tapZ(zone('back', 'spalle'));
    eq(await zone('front', 'spalle').getAttribute('aria-pressed'), 'false');
  });
  await t('cambiando periodo cambiano numeri e colori, e il muscolo scelto resta aperto', async () => {
    await tapZ(zone('front', 'petto'));
    await page.locator('[data-muscle-map] [data-muscle-days="7"]').tap();
    has(await summary(), '15 serie di lavoro negli ultimi 7 giorni');
    has(await detail(), 'Petto', '6 serie', '2 sessioni');
    await page.locator('[data-muscle-map] [data-muscle-days="90"]').tap();
    has(await summary(), '24 serie di lavoro negli ultimi 3 mesi');
    has(await detail(), '12 serie', '4 sessioni', '45–50 kg');
    eq(await page.locator('[data-muscle-map] [data-muscle-days="90"]').getAttribute('aria-pressed'), 'true');
    await tapZ(zone('front', 'petto'));
    await page.locator('[data-muscle-map] [data-muscle-days="30"]').tap();
  });
  await t('da tastiera Invio apre e richiude il muscolo', async () => {
    await zone('front', 'quadricipiti').focus();
    await page.keyboard.press('Enter');
    has(await detail(), 'Quadricipiti', 'Squat', 'Rip 5', '80 kg');
    await zone('front', 'quadricipiti').focus();
    await page.keyboard.press('Enter');
    has(await detail(), 'Tocca un muscolo');
  });

  /* ---------- equilibrio ---------- */
  await t('l’equilibrio mostra tre coppie con barre, numeri e consigli', async () => {
    eq(await page.locator('[data-balance-row]').count(), 3);
    const pt = page.locator('[data-balance-row="spinta-trazione"]');
    eq(await pt.getAttribute('data-balance-status'), 'low-b');
    has(await pt.innerText(), 'Spinta / Trazione', 'Da bilanciare', 'Spinta · 9 serie', 'Trazione · 4 serie', 'aggiungi rematori');
    const qf = page.locator('[data-balance-row="quadricipiti-femorali"]');
    eq(await qf.getAttribute('data-balance-status'), 'few');
    has(await qf.innerText(), 'Pochi dati', 'Servono almeno 6 serie');
    eq(await qf.locator('[data-balance-advice]').count(), 0);
    const ab = page.locator('[data-balance-row="alto-basso"]');
    eq(await ab.getAttribute('data-balance-status'), 'low-b');
    has(await ab.innerText(), 'Parte alta · 13 serie', 'Parte bassa · 5 serie', 'Gambe e glutei restano indietro');
    const widths = await pt.locator('.bm-balance-bar span').evaluateAll((els) => els.map((e) => Math.round(parseFloat(e.style.width))));
    eq(widths.join('/'), '69/31');
  });
  await t('i pulsanti del periodo dell’equilibrio e della mappa vanno insieme', async () => {
    await page.locator('[data-balance] [data-muscle-days="90"]').tap();
    eq(await page.locator('[data-muscle-map] [data-muscle-days="90"]').getAttribute('aria-pressed'), 'true');
    has(await summary(), '24 serie');
    has(await page.locator('[data-balance-row="spinta-trazione"]').innerText(), 'Spinta · 12 serie', 'Trazione · 4 serie');
    await page.locator('[data-balance] [data-muscle-days="30"]').tap();
  });

  /* ---------- confronto con due corpi ---------- */
  const sheetBodies = () => page.locator('[data-workout-periods-sheet] [data-period-bodies]');
  const pZone = (name, id) => page.locator('[data-workout-periods-sheet] [data-period-body="' + name + '"] [data-zone="' + id + '"]');
  const pDetail = () => page.locator('[data-period-detail]').innerText();
  await t('il confronto mostra i due corpi dei periodi con la stessa scala di colore', async () => {
    await page.locator('[data-workout-periods]').scrollIntoViewIfNeeded();
    await page.click('[data-workout-periods]');
    await page.waitForSelector('[data-workout-periods-sheet]');
    await page.waitForTimeout(800);
    eq(await sheetBodies().count(), 1);
    eq(await sheetBodies().locator('[data-period-body]').count(), 2);
    has(await page.locator('[data-period-body="A"] figcaption').innerText(), 'Periodo A', '6 serie');
    has(await page.locator('[data-period-body="B"] figcaption').innerText(), 'Periodo B', '18 serie');
    eq(await lvOf(pZone('A', 'petto')), '2', 'A: 3 serie su una scala di 9');
    eq(await lvOf(pZone('B', 'petto')), '4', 'B: 9 serie, il massimo');
    eq(await page.locator('[data-period-view="front"]').getAttribute('aria-pressed'), 'true');
    has(await pDetail(), 'Tocca un muscolo per vedere gli esercizi dei due periodi');
  });
  await t('toccando un muscolo si vedono gli esercizi dei due periodi, con la differenza', async () => {
    await pZone('A', 'petto').scrollIntoViewIfNeeded();
    await tapZ(pZone('A', 'petto'));
    const d = await pDetail();
    has(d, 'Petto', 'A 3 → B 9 serie (+6)', 'Periodo A · 3 serie', 'Periodo B · 9 serie', 'Panca piana', '45 kg', '47,5–50 kg', 'migliore 45 kg × 8', 'migliore 50 kg × 8');
    eq(await pZone('A', 'petto').getAttribute('aria-pressed'), 'true');
    eq(await pZone('B', 'petto').getAttribute('aria-pressed'), 'true', 'si evidenzia in entrambi i corpi');
    await tapZ(pZone('B', 'quadricipiti'));
    has(await pDetail(), 'Quadricipiti', 'A 3 → B 4 serie (+1)', 'Squat', '70 kg', '80 kg');
  });
  await t('con «Dietro» i corpi si girano e il muscolo non visibile si deseleziona', async () => {
    await page.locator('[data-period-view="back"]').tap();
    eq(await page.locator('[data-workout-periods-sheet] [data-bm-view="back"]').count(), 2);
    eq(await page.locator('[data-period-view="back"]').getAttribute('aria-pressed'), 'true');
    has(await pDetail(), 'Tocca un muscolo');
    await tapZ(pZone('B', 'dorso'));
    const d = await pDetail();
    has(d, 'A 0 → B 4 serie (+4)', 'Periodo A · 0 serie', 'Nessuna serie per dorso in questo periodo', 'Rematore al cavo', 'Dead hang');
    await page.locator('[data-period-view="front"]').tap();
    has(await pDetail(), 'Tocca un muscolo');
  });
  await t('cambiando le date i corpi si aggiornano', async () => {
    await page.locator('[data-period-a-from]').fill('2020-01-01');
    await page.locator('[data-period-a-to]').fill('2020-01-31');
    await page.waitForTimeout(150);
    has(await page.locator('[data-period-body="A"] figcaption').innerText(), '0 serie');
    eq(await lvOf(pZone('A', 'petto')), '0');
    eq(await lvOf(pZone('B', 'petto')), '4');
    await pZone('B', 'petto').scrollIntoViewIfNeeded();
    await tapZ(pZone('B', 'petto'));
    has(await pDetail(), 'A 0 → B 9 serie (+9)', 'Nessuna serie per petto in questo periodo');
  });
  await t('date incoerenti tolgono i corpi, non li lasciano vecchi', async () => {
    await page.locator('[data-period-b-from]').fill('2030-02-01');
    await page.locator('[data-period-b-to]').fill('2030-01-01');
    await page.waitForTimeout(150);
    eq(await sheetBodies().count(), 0);
    ok((await page.locator('[data-period-error]').innerText()).includes('Controlla le date'));
    await closeSheet();
  });

  /* ---------- casi limite ---------- */
  await t('senza sessioni non compaiono né la mappa né l’equilibrio', async () => {
    await page.evaluate(async () => { const p = await window.N.db.workouts.get('program'); p.sessions = []; await window.N.db.workouts.put(p); });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts();
    eq(await page.locator('[data-muscle-map]').count(), 0);
    eq(await page.locator('[data-balance]').count(), 0);
  });
  await t('con una sola sessione la mappa c’è e il confronto tra periodi no', async () => {
    await page.evaluate(async () => {
      const p = await window.N.db.workouts.get('program'), now = Date.now();
      p.sessions = [{ id: 'solo', dayId: 'd1', dayName: 'Allenamento', startedAt: now - 3600e3, completedAt: now, exercises: [{ exerciseId: 'e9', name: 'Curl con manubri', group: 'Bicipiti', sets: [{ reps: 12, kg: 10, done: true }] }] }];
      await window.N.db.workouts.put(p);
    });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts();
    eq(await page.locator('[data-muscle-map]').count(), 1);
    eq(await page.locator('[data-workout-periods]').count(), 0);
    eq(await lvOf(zone('front', 'bicipiti')), '4');
    await tapZ(zone('front', 'bicipiti'));
    has(await detail(), 'Bicipiti', '1 serie', 'Curl con manubri', 'Rip 12', '10 kg');
    eq(await page.locator('[data-balance-row][data-balance-status="few"]').count(), 3, 'con una serie solo, tutte le coppie hanno pochi dati');
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
