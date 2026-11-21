// Test end-to-end di Allenamenti v8: recupero per gruppo, tabella dei massimali a scalare, badge di costanza.
// Esecuzione: node tests/workouts_v8.e2e.test.js
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

  // Un giorno fa: petto (9 serie) e bicipiti (3). Cinque giorni fa: gambe e dorso. Dodici giorni fa: glutei. Poi otto sessioni di sola panca.
  // In tutto 11 sessioni. Il tempo è relativo a «adesso» così il test vale in ogni giorno.
  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(async () => {
    const H = 36e5, now = Date.now();
    const sets = (n, reps, kg) => Array.from({ length: n }, () => ({ reps, kg, done: true }));
    const e = (id, name, group, s, extra) => Object.assign({ exerciseId: id, name, group, sets: s }, extra || {});
    const sess = (id, hoursAgo, exercises) => ({ id, dayId: 'd1', dayName: 'Allenamento', startedAt: now - hoursAgo * H - H, completedAt: now - hoursAgo * H, exercises });
    const extra = [];
    for (let i = 0; i < 8; i++) extra.push(sess('x' + i, (15 + i) * 24, [e('e1', 'Panca piana', 'Petto', sets(3, 8, 45))]));
    await window.N.db.workouts.put({
      id: 'program', updated: now, bodyWeights: [], reminder: { enabled: false, time: '18:00' },
      days: [{ id: 'd1', name: 'Allenamento', weekday: '', created: now - 60 * 24 * H, activeSession: null, exercises: [
        { id: 'e1', name: 'Panca piana', setCount: 3, reps: 8, kg: 50, group: 'Petto' },
        { id: 'e3', name: 'Dead hang', setCount: 2, reps: 30, kg: 0, group: 'Dorso', unit: 'time' }] }],
      sessions: [
        sess('s3', 12 * 24, [e('e6', 'Hip thrust', 'Glutei', sets(4, 8, 80))]),
        sess('s2', 5 * 24, [e('e4', 'Squat', 'Gambe', sets(4, 5, 80)), e('e5', 'Rematore al cavo', 'Dorso', sets(3, 10, 40)), e('e3', 'Dead hang', 'Dorso', sets(2, 30, 0), { unit: 'time' })]),
        sess('s1', 24, [e('e1', 'Panca piana', 'Petto', sets(9, 8, 50)), e('e2', 'Curl con manubri', 'Bicipiti', sets(3, 10, 12))])
      ].concat(extra)
    });
  });
  const openWorkouts = async () => { await page.click('#dock button[data-dock="workouts"]'); await page.waitForSelector('.workout-day-card'); };
  await page.reload(); await page.waitForSelector('#list');
  await openWorkouts();

  const tapZ = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: 'center' })); await loc.locator('path').first().tap(); };
  const rz = (view, id) => page.locator('[data-recovery] [data-rc-figure="' + view + '"] [data-zone="' + id + '"]');
  const rDetail = () => page.locator('[data-recovery-detail]').innerText();
  const cls = async (loc) => (await loc.getAttribute('class')) || '';

  /* ---------- recupero ---------- */
  await t('il recupero mostra quanti muscoli sono pronti, in recupero e mai allenati', async () => {
    eq(await page.locator('[data-recovery]').count(), 1);
    eq(await page.locator('[data-recovery-summary]').innerText(), '3 muscoli pronti · 2 in recupero · 8 mai allenati');
    has(await rDetail(), 'Tocca un muscolo, sul corpo o nell’elenco');
  });
  await t('i corpi sono colorati per stato: in recupero, pronto, mai allenato', async () => {
    ok((await cls(rz('front', 'petto'))).includes('st-wait'), 'petto');
    ok((await cls(rz('front', 'bicipiti'))).includes('st-wait'), 'bicipiti');
    ok((await cls(rz('front', 'quadricipiti'))).includes('st-ready'), 'quadricipiti');
    ok((await cls(rz('back', 'dorso'))).includes('st-ready'), 'dorso');
    ok((await cls(rz('back', 'glutei'))).includes('st-ready'), 'glutei');
    ok((await cls(rz('front', 'addome'))).includes('st-none'), 'addome');
    ok(/^Petto: pronto (oggi|domani|[a-zì]+) alle \d{1,2}[:.]\d{2}$/.test(await rz('front', 'petto').getAttribute('aria-label')), 'etichetta del petto');
    eq(await rz('front', 'addome').getAttribute('aria-label'), 'Addome: mai allenato');
    eq(await rz('back', 'dorso').getAttribute('aria-label'), 'Dorso: pronto');
  });
  await t('l’elenco mette prima chi sta per essere pronto, poi i più riposati, infine i mai allenati', async () => {
    const order = await page.locator('[data-recovery-zone]').evaluateAll((els) => els.map((e) => e.getAttribute('data-recovery-zone')));
    eq(order.slice(0, 5).join(','), 'bicipiti,petto,glutei,quadricipiti,dorso');
    eq(order.length, 13);
    const status = await page.locator('[data-recovery-zone]').evaluateAll((els) => els.map((e) => e.getAttribute('data-recovery-status')));
    eq(status.slice(0, 5).join(','), 'wait,wait,ready,ready,ready');
    ok(status.slice(5).every((s) => s === 'none'));
    has(await page.locator('[data-recovery-zone="bicipiti"]').innerText(), 'Bicipiti', 'tra 1 giorno');
    has(await page.locator('[data-recovery-zone="petto"]').innerText(), 'tra 2 giorni e 12 ore');
    has(await page.locator('[data-recovery-zone="glutei"]').innerText(), 'Pronto');
  });
  await t('toccando un muscolo si vede l’ultimo allenamento e come è stato stimato il recupero', async () => {
    await tapZ(rz('front', 'petto'));
    const d = await rDetail();
    has(d, 'Petto', 'In recupero', 'Ultimo allenamento: ieri · 9 serie', 'Recupero stimato: 72 ore + 12 per le 9 serie = 84 ore', 'tra 2 giorni e 12 ore');
    ok(/Pronto (oggi|domani|[a-zì]+) alle \d{1,2}[:.]\d{2}/.test(d), 'manca il quando: ' + d);
    ok((await cls(page.locator('[data-recovery-zone="petto"]'))).includes('sel'));
    eq(await rz('front', 'petto').getAttribute('aria-pressed'), 'true');
    await tapZ(rz('front', 'petto'));
    has(await rDetail(), 'Tocca un muscolo');
  });
  await t('anche toccando una riga dell’elenco si apre il dettaglio e si evidenzia il corpo', async () => {
    await page.locator('[data-recovery-zone="glutei"]').scrollIntoViewIfNeeded();
    await page.locator('[data-recovery-zone="glutei"]').tap();
    const d = await rDetail();
    has(d, 'Glutei', 'Pronto', 'Ultimo allenamento: 12 giorni fa · 4 serie', 'Recupero stimato: 72 ore', 'Pronto: puoi allenarlo.');
    ok(!d.includes('per le 4 serie'), 'con 4 serie non c’è nessun allungamento');
    eq(await rz('back', 'glutei').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-recovery-zone="glutei"]').tap();
    eq(await rz('back', 'glutei').getAttribute('aria-pressed'), 'false');
  });
  await t('un muscolo mai allenato lo dice', async () => {
    await tapZ(rz('front', 'addome'));
    has(await rDetail(), 'Addome', 'Mai allenato', 'Nessuna serie di lavoro registrata per addome');
    await tapZ(rz('front', 'addome'));
  });
  await t('un esercizio a tempo e uno a carico sommano nella stessa zona', async () => {
    await tapZ(rz('back', 'dorso'));
    has(await rDetail(), 'Dorso', 'Ultimo allenamento: 5 giorni fa · 5 serie', 'Recupero stimato: 72 ore');
    await tapZ(rz('back', 'dorso'));
  });
  await t('il recupero sta nello schermo senza scorrimento orizzontale', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 0, 'scorrimento orizzontale di ' + over + ' px');
  });

  /* ---------- tabella dei massimali ---------- */
  const openProgress = async (exerciseId) => {
    await page.locator('[data-workout-open-day]').first().click(); await page.waitForSelector('.workout-day-title');
    await page.locator('[data-workout-exercise="' + exerciseId + '"] .workout-exercise-more').click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('[data-progress-view]');
    await page.waitForTimeout(700);
  };
  const closeSheet = async () => { await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' }); };
  const backToOverview = async () => { await page.goBack(); await page.waitForSelector('.workout-day-card'); };
  await t('i progressi di un esercizio mostrano i carichi per 1, 3, 5, 8, 10 e 12 ripetizioni', async () => {
    await openProgress('e1');
    has(await page.locator('[data-workout-orm]').innerText(), '63,3 kg');
    eq(await page.locator('[data-workout-repmax] [data-repmax-reps]').count(), 6);
    const rows = await page.locator('[data-workout-repmax] [data-repmax-reps]').evaluateAll((els) => els.map((e) => e.getAttribute('data-repmax-reps') + '|' + e.innerText.replace(/\s+/g, ' ')));
    eq(rows.join(' ; '), '1|1 (massimale) 100% 62,5 kg ; 3|3 91% 57,5 kg ; 5|5 86% 55 kg ; 8|8 79% 50 kg ; 10|10 75% 47,5 kg ; 12|12 71% 45 kg');
    has(await page.locator('[data-workout-repmax]').innerText(), 'arrotondati a 2,5 kg', '63,3 kg');
  });
  await t('la tabella resta anche dopo il passaggio al grafico e alla tabella delle serie', async () => {
    await page.click('[data-progress-view="table"]'); await page.waitForSelector('[data-workout-table]');
    eq(await page.locator('[data-workout-repmax]').count(), 0);
    await page.click('[data-progress-view="chart"]');
    eq(await page.locator('[data-workout-repmax]').count(), 1);
    await closeSheet();
  });
  await t('per un esercizio a tempo non c’è né massimale né tabella', async () => {
    await page.locator('[data-workout-exercise="e3"] .workout-exercise-more').click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('[data-progress-view]');
    eq(await page.locator('[data-workout-orm]').count(), 0);
    eq(await page.locator('[data-workout-repmax]').count(), 0);
    await closeSheet(); await backToOverview();
  });

  /* ---------- traguardi ---------- */
  const expected = () => page.evaluate(() => { const L = window.N.workouts._logic; return L.badges(window.N.workouts._state.program.sessions, Date.now()).filter((b) => b.earned).length; });
  const badge = (id) => page.locator('[data-badge="' + id + '"]');
  await t('i traguardi compaiono con il conteggio di quelli ottenuti', async () => {
    await page.locator('[data-badges]').scrollIntoViewIfNeeded();
    eq(await page.locator('[data-badge]').count(), 12);
    const earned = await page.locator('[data-badge-earned="true"]').count();
    eq(earned, await expected(), 'conteggio dei badge ottenuti');
    eq(await page.locator('[data-badges-count]').innerText(), earned + ' / 12');
  });
  await t('con 11 sessioni sono ottenuti «Primo passo» e «10 sessioni»; «25 sessioni» è a 11 su 25', async () => {
    eq(await badge('sess-1').getAttribute('data-badge-earned'), 'true');
    eq(await badge('sess-10').getAttribute('data-badge-earned'), 'true');
    eq(await badge('sess-25').getAttribute('data-badge-earned'), 'false');
    has(await badge('sess-25').innerText(), '25 sessioni', '11 / 25');
    eq(await badge('sess-100').locator('.wb-bar').count(), 1, 'il bloccato ha la barra di avanzamento');
    eq(await badge('sess-1').locator('.wb-bar').count(), 0);
  });
  await t('toccando un traguardo un avviso dice cosa serve o quando l’hai ottenuto', async () => {
    await badge('sess-25').scrollIntoViewIfNeeded();
    await badge('sess-25').tap();
    has(await page.locator('.toast').innerText(), '25 sessioni', 'Completa 25 sessioni in totale', '11 di 25');
    await badge('sess-10').tap();
    has(await page.locator('.toast').innerText(), '10 sessioni', 'ottenuto il');
  });
  await t('il traguardo «Corpo intero» non è ottenuto: mancano parti del corpo nella stessa settimana', async () => {
    eq(await badge('body').getAttribute('data-badge-earned'), 'false');
    ok(/\d \/ 6/.test(await badge('body').innerText()), await badge('body').innerText());
  });
  await t('una sessione nuova può sbloccare un traguardo e il conteggio si aggiorna', async () => {
    await page.evaluate(async () => {
      const p = await window.N.db.workouts.get('program'), now = Date.now();
      for (let i = 0; i < 14; i++) p.sessions.push({ id: 'n' + i, dayId: 'd1', dayName: 'Allenamento', startedAt: now - i * 36e5 - 36e5, completedAt: now - i * 36e5, exercises: [{ exerciseId: 'e1', name: 'Panca piana', group: 'Petto', sets: [{ reps: 8, kg: 45, done: true }] }] });
      await window.N.db.workouts.put(p);
    });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts();
    await page.locator('[data-badges]').scrollIntoViewIfNeeded();
    eq(await badge('sess-25').getAttribute('data-badge-earned'), 'true', '25 sessioni');
    ok((await badge('sess-25').getAttribute('class')).includes('new'), 'appena ottenuto: segnato come nuovo');
    eq(await badge('sess-50').getAttribute('data-badge-earned'), 'false');
    eq(await page.locator('[data-badges-count]').innerText(), (await page.locator('[data-badge-earned="true"]').count()) + ' / 12');
  });

  /* ---------- casi limite ---------- */
  await t('senza sessioni non compaiono né il recupero né i traguardi', async () => {
    await page.evaluate(async () => { const p = await window.N.db.workouts.get('program'); p.sessions = []; await window.N.db.workouts.put(p); });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts();
    eq(await page.locator('[data-recovery]').count(), 0);
    eq(await page.locator('[data-badges]').count(), 0);
  });
  await t('con una sessione di solo riscaldamento il recupero dice che nessun muscolo è stato allenato', async () => {
    await page.evaluate(async () => {
      const p = await window.N.db.workouts.get('program'), now = Date.now();
      p.sessions = [{ id: 'w', dayId: 'd1', dayName: 'Allenamento', startedAt: now - 7200e3, completedAt: now - 3600e3, exercises: [{ exerciseId: 'e1', name: 'Panca piana', group: 'Petto', sets: [{ reps: 8, kg: 20, done: true, type: 'warmup' }] }] }];
      await window.N.db.workouts.put(p);
    });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts();
    eq(await page.locator('[data-recovery-summary]').innerText(), '0 muscoli pronti · 0 in recupero · 13 mai allenati');
    eq(await page.locator('[data-recovery-status="none"]').count(), 13);
    eq(await badge('sess-1').getAttribute('data-badge-earned'), 'true', 'la sessione è comunque una sessione');
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
