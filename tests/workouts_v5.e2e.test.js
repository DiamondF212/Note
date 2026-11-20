// Test end-to-end di Allenamenti v5: riscaldamento articolare, confronto tra due periodi, storico in tabella.
// Esecuzione: node tests/workouts_v5.e2e.test.js
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

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port + '/';
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/repl/tools/bin/chromium') ? '/repl/tools/bin/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block' });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Una giornata con due esercizi e quattro sessioni: una 40 giorni fa, le altre negli ultimi 10 giorni.
  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(async () => {
    const DAY = 864e5, now = Date.now();
    const sets = (reps, kg) => reps.map((r) => ({ reps: r, kg, done: true }));
    const sess = (id, ago, e1, e2) => ({ id, dayId: 'd1', dayName: 'Petto', startedAt: now - ago * DAY - 3600e3, completedAt: now - ago * DAY, exercises: [
      { exerciseId: 'e1', name: 'Panca piana', group: 'Petto', sets: e1 }, { exerciseId: 'e2', name: 'Curl con manubri', group: 'Bicipiti', sets: e2 }] });
    const newest = sets([8, 8, 9], 50); newest.unshift({ reps: 5, kg: 20, done: true, type: 'warmup' });
    await window.N.db.workouts.put({
      id: 'program', updated: now, bodyWeights: [], reminder: { enabled: false, time: '18:00' },
      days: [{ id: 'd1', name: 'Petto', weekday: '', created: now - 60 * DAY, activeSession: null, exercises: [
        { id: 'e1', name: 'Panca piana', setCount: 3, reps: 8, kg: 50, group: 'Petto' },
        { id: 'e2', name: 'Curl con manubri', setCount: 3, reps: 12, kg: 10, group: 'Bicipiti' }] }],
      sessions: [
        sess('s-old', 40, sets([8, 8, 8], 45), sets([12, 12, 12], 8)),
        sess('s0', 10, sets([8, 8, 8], 47.5), sets([12, 12, 12], 10)),
        sess('s1', 3, sets([8, 8, 8], 50), sets([12, 12, 12], 10)),
        sess('s2', 1, newest, sets([12, 12, 12], 10))
      ]
    });
  });
  const openWorkouts = async () => { await page.click('#dock button[data-dock="workouts"]'); await page.waitForSelector('.workout-day-card'); };
  await page.reload(); await page.waitForSelector('#list');
  await openWorkouts();

  const program = () => page.evaluate(() => JSON.parse(JSON.stringify(window.N.workouts._state.program)));
  const openDay = async () => { await page.locator('[data-workout-open-day]').first().click(); await page.waitForSelector('.workout-day-title'); };
  const toOverview = async () => { await page.goBack(); await page.waitForSelector('.workout-day-card'); };
  const closeSheet = async () => { await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' }); };
  const planSize = () => page.evaluate(() => window.N.workouts._logic.mobilityPlan(window.N.workouts._state.program.days[0]).length);
  const today = () => page.evaluate(() => window.N.workouts._logic.dayKey(Date.now()));

  /* ---------- riscaldamento articolare ---------- */
  await t('la giornata propone il riscaldamento articolare con i movimenti giusti', async () => {
    await openDay();
    const n = await planSize();
    ok(n >= 4 && n <= 6, 'movimenti: ' + n);
    const card = await page.locator('[data-workout-mobility]').innerText();
    ok(card.includes('Riscaldamento articolare') && card.includes('0 / ' + n + ' fatti oggi'), card);
    await page.click('[data-workout-mobility]');
    await page.waitForSelector('[data-workout-mobility-sheet]');
    eq(await page.locator('[data-mobility-id]').count(), n);
    const text = await page.locator('[data-workout-mobility-sheet]').innerText();
    ok(text.includes('Cerchi con le braccia') && text.includes('Cerchi dei polsi'), text);
    ok(!text.includes('Cerchi delle caviglie'), 'una giornata di petto e bicipiti non ha le caviglie');
  });
  await t('spuntando i movimenti la scheda si aggiorna, si salva e vale solo per oggi', async () => {
    const n = await planSize();
    await page.locator('[data-mobility-id]').first().click();
    eq(await page.locator('[data-mobility-id]').first().getAttribute('aria-pressed'), 'true');
    eq(await page.locator('[data-mobility-count]').innerText(), '1 di ' + n);
    ok((await page.locator('[data-workout-mobility]').innerText()).includes('1 / ' + n + ' fatti oggi'), 'la scheda dietro non si aggiorna');
    await page.waitForTimeout(250);
    const saved = (await program()).days[0].mobility;
    eq(saved.date, await today()); eq(saved.done.length, 1);
    await page.click('[data-mobility-all]');
    ok((await page.locator('[data-mobility-count]').innerText()).includes('Completato'));
    ok((await page.locator('[data-workout-mobility].done').count()) === 1, 'manca lo stato completato');
    ok((await page.locator('[data-workout-mobility]').innerText()).includes('Completato oggi'));
    await page.click('[data-mobility-all]');
    eq(await page.locator('[data-mobility-count]').innerText(), '0 di ' + n);
    await page.locator('[data-mobility-id]').nth(1).click();
    await page.waitForTimeout(250);
    eq(await page.evaluate(() => window.N.workouts._logic.makeBackup(window.N.workouts._state.program).program.days[0].mobility.done.length), 1, 'il backup deve includerlo');
    await closeSheet();
  });
  await t('dopo il riavvio la spunta c’è ancora, ma il giorno dopo la lista riparte vuota', async () => {
    const n = await planSize();
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts(); await openDay();
    ok((await page.locator('[data-workout-mobility]').innerText()).includes('1 / ' + n + ' fatti oggi'));
    await page.evaluate(async () => {
      const p = await window.N.db.workouts.get('program');
      p.days[0].mobility.date = '2020-01-01';
      await window.N.db.workouts.put(p);
    });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts(); await openDay();
    ok((await page.locator('[data-workout-mobility]').innerText()).includes('0 / ' + n + ' fatti oggi'));
    await toOverview();
  });

  /* ---------- confronto tra periodi ---------- */
  await t('il confronto tra due periodi si apre con le ultime 4 settimane e mostra la tabella', async () => {
    await page.click('[data-workout-periods]');
    await page.waitForSelector('[data-workout-periods-sheet]');
    eq(await page.locator('[data-period-preset="settimane"]').getAttribute('aria-pressed'), 'true');
    const table = await page.locator('[data-period-table]').innerText();
    ok(table.includes('Sessioni') && table.includes('Volume (kg)') && table.includes('Sessioni a settimana'), table);
  });
  await t('scegliendo le date i numeri e le differenze cambiano', async () => {
    const keys = await page.evaluate(() => {
      const k = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return window.N.workouts._logic.dayKey(d.getTime()); };
      return { a: [k(60), k(31)], b: [k(30), k(0)] };
    });
    await page.locator('[data-period-a-from]').fill(keys.a[0]);
    await page.locator('[data-period-a-to]').fill(keys.a[1]);
    await page.locator('[data-period-b-from]').fill(keys.b[0]);
    await page.locator('[data-period-b-to]').fill(keys.b[1]);
    eq(await page.locator('[data-period-preset][aria-pressed="true"]').count(), 0, 'con date a mano nessun confronto rapido è attivo');
    const row = (await page.locator('[data-period-table] .workout-period-row:has-text("Sessioni"):not(:has-text("settimana"))').first().innerText()).replace(/\s+/g, ' ');
    ok(row.includes('1') && row.includes('3') && row.includes('+2 (+200%)'), row);
    const ex = await page.locator('[data-period-exercise="Panca piana"]').innerText();
    ok(ex.includes('→') && ex.includes('%'), ex);
    ok((await page.locator('[data-period-groups]').innerText()).includes('Petto'));
  });
  await t('date incoerenti e periodi senza sessioni vengono spiegati', async () => {
    const keys = await page.evaluate(() => { const k = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return window.N.workouts._logic.dayKey(d.getTime()); }; return { late: k(1), early: k(5), old: k(300), old2: k(280) }; });
    await page.locator('[data-period-b-from]').fill(keys.late);
    await page.locator('[data-period-b-to]').fill(keys.early);
    ok((await page.locator('[data-period-error]').innerText()).includes('quella iniziale deve venire prima'));
    await page.locator('[data-period-a-from]').fill(keys.old);
    await page.locator('[data-period-a-to]').fill(keys.old2);
    await page.locator('[data-period-b-from]').fill(keys.early);
    await page.locator('[data-period-b-to]').fill(keys.late);
    ok((await page.locator('[data-period-empty]').innerText()).includes('periodo A'));
  });
  await t('i confronti rapidi riempiono le date e si possono cambiare', async () => {
    await page.click('[data-period-preset="mese"]');
    eq(await page.locator('[data-period-preset="mese"]').getAttribute('aria-pressed'), 'true');
    const month = await page.evaluate(() => { const n = new Date(); return window.N.workouts._logic.dayKey(new Date(n.getFullYear(), n.getMonth(), 1).getTime()); });
    eq(await page.locator('[data-period-b-from]').inputValue(), month);
    eq(await page.locator('[data-period-error]').count(), 0);
    await page.click('[data-period-preset="mesi"]');
    ok((await page.locator('[data-period-table]').count()) === 1);
    await closeSheet();
  });

  /* ---------- storico in tabella ---------- */
  const openTable = async () => {
    await openDay();
    await page.locator('[data-workout-exercise="e1"] .workout-exercise-more').click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('[data-progress-view]');
    await page.click('[data-progress-view="table"]');
    await page.waitForSelector('[data-workout-table]');
  };
  const column = (n) => page.locator('[data-table-row]:not(.head) span:nth-child(' + n + ')').evaluateAll((els) => els.map((e) => e.firstChild.textContent.trim()));
  const kgs = async () => (await column(3)).map((x) => Number(x.replace(',', '.')));
  await t('la tabella elenca tutte le serie, dalla più recente', async () => {
    await openTable();
    eq(await page.locator('[data-table-row]').count(), 12, '4 sessioni × 3 serie, senza riscaldamento');
    eq(await page.locator('[data-table-sort="t"]').getAttribute('aria-sort'), 'descending');
    const newest = await page.evaluate(() => new Date(Math.max(...window.N.workouts._state.program.sessions.map((s) => s.completedAt))).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }));
    eq((await column(1))[0], newest);
    ok((await page.locator('[data-table-summary]').innerText()).includes('12 serie completate · carico massimo 50 kg'));
  });
  await t('toccando le intestazioni la tabella si ordina e si inverte', async () => {
    await page.click('[data-table-sort="kg"]');
    eq(await page.locator('[data-table-sort="kg"]').getAttribute('aria-sort'), 'descending');
    let v = await kgs();
    ok(v.every((x, i) => i === 0 || v[i - 1] >= x), 'kg non decrescenti: ' + v);
    eq(v[0], 50);
    await page.click('[data-table-sort="kg"]');
    eq(await page.locator('[data-table-sort="kg"]').getAttribute('aria-sort'), 'ascending');
    v = await kgs();
    ok(v.every((x, i) => i === 0 || v[i - 1] <= x), 'kg non crescenti: ' + v);
    eq(v[0], 45);
    await page.click('[data-table-sort="reps"]');
    const r = (await column(4)).map(Number);
    ok(r.every((x, i) => i === 0 || r[i - 1] >= x), 'rip: ' + r);
  });
  await t('il riscaldamento compare solo se lo chiedi', async () => {
    eq(await page.locator('.workout-table-row.warm').count(), 0);
    await page.click('[data-table-warm]');
    eq(await page.locator('[data-table-row]').count(), 13);
    eq(await page.locator('.workout-table-row.warm').count(), 1);
    ok((await page.locator('.workout-table-row.warm').innerText()).includes('risc.'));
    eq(await page.locator('[data-table-warm]').getAttribute('aria-pressed'), 'true');
    ok((await page.locator('[data-table-summary]').innerText()).includes('carico massimo 50 kg'), 'il riscaldamento non conta per il massimo');
  });
  await t('si torna al grafico senza perdere il massimale stimato', async () => {
    await page.click('[data-progress-view="chart"]');
    await page.waitForSelector('[data-workout-orm]');
    eq(await page.locator('[data-workout-table]').count(), 0);
    await closeSheet();
  });
  await t('un esercizio senza serie completate non offre né grafico né tabella', async () => {
    await page.evaluate(async () => {
      const p = await window.N.db.workouts.get('program');
      p.days[0].exercises.push({ id: 'e3', name: 'Dip alle parallele', setCount: 3, reps: 8, kg: 0 });
      await window.N.db.workouts.put(p);
    });
    await page.reload(); await page.waitForSelector('#list'); await openWorkouts(); await openDay();
    await page.locator('[data-workout-exercise="e3"] .workout-exercise-more').click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('.workout-progress');
    eq(await page.locator('[data-progress-view]').count(), 0);
    eq(await page.locator('[data-workout-table]').count(), 0);
    ok((await page.locator('.workout-progress').innerText()).includes('Ancora nessun dato'));
    await closeSheet(); await toOverview();
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
