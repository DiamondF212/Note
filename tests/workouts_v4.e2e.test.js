// Test end-to-end di Allenamenti v3 e v4: backup, riscaldamento, confronto, volume, massimale,
// progressione automatica, sostituzioni, grafico settimanale e riepilogo mensile.
// Esecuzione: node tests/workouts_v4.e2e.test.js
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'it-IT', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wk-'));

  // Una scheda già avviata: una giornata, due esercizi e quattro sessioni passate.
  await page.goto(base); await page.waitForSelector('#list');
  await page.evaluate(async () => {
    const DAY = 864e5, now = Date.now();
    const sets = (reps, kg) => reps.map((r) => ({ reps: r, kg, done: true }));
    const sess = (id, ago, e1, e2) => ({ id, dayId: 'd1', dayName: 'Petto', startedAt: now - ago * DAY - 3600e3, completedAt: now - ago * DAY, exercises: [
      { exerciseId: 'e1', name: 'Panca piana', group: 'Petto', sets: e1 }, { exerciseId: 'e2', name: 'Curl con manubri', group: 'Bicipiti', sets: e2 }] });
    await window.N.db.workouts.put({
      id: 'program', updated: now, bodyWeights: [], reminder: { enabled: false, time: '18:00' },
      days: [{ id: 'd1', name: 'Petto', weekday: '', created: now - 60 * DAY, activeSession: null, exercises: [
        { id: 'e1', name: 'Panca piana', setCount: 3, reps: 8, kg: 50, group: 'Petto' },
        { id: 'e2', name: 'Curl con manubri', setCount: 3, reps: 12, kg: 10, group: 'Bicipiti' }] }],
      sessions: [
        sess('s-old', 40, sets([8, 8, 8], 45), sets([12, 12, 12], 8)),
        sess('s0', 10, sets([8, 8, 8], 47.5), sets([12, 12, 12], 10)),
        sess('s1', 3, sets([8, 8, 8], 50), sets([12, 12, 12], 10)),
        sess('s2', 1, sets([8, 8, 9], 50), sets([12, 12, 12], 10))
      ]
    });
  });
  await page.reload(); await page.waitForSelector('#list');
  await page.click('#dock button[data-dock="workouts"]');
  await page.waitForSelector('.workout-screen');
  await page.waitForSelector('.workout-day-card');

  const program = () => page.evaluate(() => JSON.parse(JSON.stringify(window.N.workouts._state.program)));
  const openDay = async () => { await page.locator('[data-workout-open-day]').first().click(); await page.waitForSelector('.workout-day-title'); };
  const toOverview = async () => { await page.goBack(); await page.waitForSelector('.workout-day-card'); };
  const closeSheet = async () => { await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' }); };
  const card = (id) => page.locator('[data-workout-exercise="' + id + '"]');

  /* ---------- panoramica ---------- */
  await t('la panoramica mostra il grafico settimanale, il volume per gruppo e il riepilogo del mese', async () => {
    const expected = await page.evaluate(() => {
      const L = window.N.workouts._logic, p = window.N.workouts._state.program, n = new Date();
      return { bars: L.weeklyVolumeSeries(p.sessions, Date.now(), 8).filter((w) => w.volume > 0).length, month: L.monthlySummary(p, n.getFullYear(), n.getMonth()) };
    });
    eq(await page.locator('.wk-bar').count(), expected.bars);
    eq(await page.locator('.wk-bar.current').count() <= 1, true);
    ok((await page.locator('[data-volume-summary]').innerText()).includes('Questa settimana'));
    const groups = await page.locator('[data-workout-volume]').innerText();
    ok(groups.includes('Petto') && groups.includes('Bicipiti'), 'gruppi mancanti: ' + groups);
    const card = await page.locator('[data-workout-month]').innerText();
    ok(card.includes('Riepilogo di') && card.includes(expected.month.sessions + (expected.month.sessions === 1 ? ' sessione' : ' sessioni')), card);
  });
  await t('il riepilogo mensile scorre tra i mesi e non va oltre quello in corso', async () => {
    await page.click('[data-workout-month]');
    await page.waitForSelector('[data-workout-monthly-sheet]');
    eq(await page.locator('[data-month-next]').isDisabled(), true);
    const now = await page.locator('[data-month-title]').innerText();
    const expected = await page.evaluate(() => { const n = new Date(); return window.N.workouts._logic.monthlySummary(window.N.workouts._state.program, n.getFullYear(), n.getMonth()); });
    if (expected.sessions) {
      ok((await page.locator('.workout-month-grid').innerText()).includes('Sessioni'));
      ok((await page.locator('[data-month-day="Petto"]').innerText()).includes(expected.topDays[0].count === 1 ? 'volta' : 'volte'));
    } else eq(await page.locator('[data-month-empty]').count(), 1);
    await page.click('[data-month-prev]');
    ok((await page.locator('[data-month-title]').innerText()) !== now);
    eq(await page.locator('[data-month-next]').isDisabled(), false);
    await page.click('[data-month-next]');
    eq(await page.locator('[data-month-title]').innerText(), now);
    await closeSheet();
  });

  /* ---------- backup ---------- */
  await t('il backup si esporta in un file JSON leggibile', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-workout-export]')]);
    ok(/^allenamenti-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), download.suggestedFilename());
    await download.saveAs(path.join(tmp, 'backup.json'));
    const data = JSON.parse(fs.readFileSync(path.join(tmp, 'backup.json'), 'utf8'));
    eq(data.app, 'mie-note-allenamenti'); eq(data.version, 1);
    eq(data.program.days.length, 1); eq(data.program.sessions.length, 4);
    eq(data.program.days[0].exercises[0].group, 'Petto');
  });
  const importFile = async (file) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-workout-import]')]);
    await chooser.setFiles(file);
  };
  await t('un file che non è un backup viene rifiutato senza toccare i dati', async () => {
    fs.writeFileSync(path.join(tmp, 'bad.json'), '{"qualcosa":1}');
    await importFile(path.join(tmp, 'bad.json'));
    await page.waitForSelector('.toast');
    ok((await page.locator('.toast').innerText()).includes('non è un backup'));
    eq((await program()).sessions.length, 4);
    eq(await page.locator('[data-workout-import-confirm]').count(), 0);
  });
  await t('importando un backup si chiede conferma e poi i dati vengono sostituiti', async () => {
    const data = JSON.parse(fs.readFileSync(path.join(tmp, 'backup.json'), 'utf8'));
    data.program.days[0].name = 'Dal backup'; data.program.sessions = data.program.sessions.slice(0, 1);
    fs.writeFileSync(path.join(tmp, 'altro.json'), JSON.stringify(data));
    await importFile(path.join(tmp, 'altro.json'));
    await page.waitForSelector('[data-workout-import-confirm]');
    eq(await page.locator('[data-import-summary]').innerText(), 'Il backup contiene 1 giornata e 1 sessione.');
    await page.click('[data-workout-import-confirm]');
    await page.waitForSelector('[data-workout-import-confirm]', { state: 'detached' });
    await page.waitForSelector('.workout-day-card:has-text("Dal backup")');
    eq((await program()).sessions.length, 1);
    await page.waitForTimeout(300);
    eq(await page.evaluate(async () => (await window.N.db.workouts.get('program')).days[0].name), 'Dal backup', 'non salvato');
  });
  await t('reimportando il backup originale si torna ai dati di prima', async () => {
    await importFile(path.join(tmp, 'backup.json'));
    await page.waitForSelector('[data-workout-import-confirm]');
    await page.click('[data-workout-import-confirm]');
    await page.waitForSelector('.workout-day-card:has-text("Petto")');
    const p = await program();
    eq(p.sessions.length, 4); eq(p.days[0].exercises.length, 2); eq(p.days[0].exercises[0].group, 'Petto');
  });

  /* ---------- giornata: confronto e progressione ---------- */
  await t('nella giornata il confronto mostra la differenza con la sessione precedente', async () => {
    await openDay();
    const text = await page.locator('[data-workout-compare]').innerText();
    ok(text.includes('+50 kg di volume') && text.includes('Panca piana'), text);
  });
  await t('la progressione consiglia ripetizioni o peso secondo l’esercizio', async () => {
    eq(await page.locator('[data-workout-progression]').count(), 2);
    const reps = await card('e1').locator('[data-workout-progression]').innerText();
    eq(await card('e1').locator('[data-workout-progression]').getAttribute('data-workout-progression'), 'reps');
    ok(reps.includes('Aumenta le ripetizioni') && reps.includes('3 × 8 → 3 × 9'), reps);
    const weight = await card('e2').locator('[data-workout-progression]').innerText();
    eq(await card('e2').locator('[data-workout-progression]').getAttribute('data-workout-progression'), 'weight');
    ok(weight.includes('Aumenta il peso') && weight.includes('10 → 11 kg') && weight.includes('3 × 8'), weight);
  });
  await t('premendo la spunta l’obiettivo si aggiorna e si può annullare', async () => {
    await card('e1').locator('[data-workout-progress-apply]').click();
    await card('e1').locator('[data-workout-progression]').waitFor({ state: 'detached' });
    ok((await card('e1').locator('.workout-target-row').innerText()).includes('3 × 9'));
    await page.waitForTimeout(300);
    eq(await page.evaluate(async () => (await window.N.db.workouts.get('program')).days[0].exercises[0].reps), 9, 'non salvato');
    await page.locator('.toast button').click();
    await card('e1').locator('[data-workout-progression]').waitFor();
    ok((await card('e1').locator('.workout-target-row').innerText()).includes('3 × 8'));
    await card('e1').locator('[data-workout-progress-apply]').click();
    await card('e1').locator('[data-workout-progression]').waitFor({ state: 'detached' });
    eq((await program()).days[0].exercises[0].reps, 9);
  });

  /* ---------- sessione ---------- */
  await t('in sessione la progressione aggiorna carico e ripetizioni delle serie non ancora fatte', async () => {
    await page.click('[data-workout-start]');
    await card('e2').locator('.workout-set-row').first().waitFor();
    await card('e2').locator('[data-workout-progress-apply]').click();
    await card('e2').locator('[data-workout-progression]').waitFor({ state: 'detached' });
    const kgs = await card('e2').locator('[data-set-kg]').evaluateAll((els) => els.map((e) => e.value));
    const reps = await card('e2').locator('[data-set-reps]').evaluateAll((els) => els.map((e) => e.value));
    eq(kgs.join(','), '11,11,11'); eq(reps.join(','), '8,8,8');
  });
  await t('il riscaldamento suggerito aggiunge tre serie e non conta nel volume', async () => {
    await card('e1').locator('[data-workout-warmup]').click();
    await card('e1').locator('.workout-set-row[data-type="warmup"]').nth(2).waitFor();
    eq(await card('e1').locator('.workout-set-row[data-type="warmup"]').count(), 3);
    eq(await card('e1').locator('[data-workout-warmup]').count(), 0);
    const kgs = await card('e1').locator('.workout-set-row[data-type="warmup"] [data-set-kg]').evaluateAll((els) => els.map((e) => e.value));
    eq(kgs.join(','), '25,35,42.5');
  });
  await t('in sessione si può sostituire un esercizio solo per oggi, senza cambiare la scheda', async () => {
    await card('e2').locator('.workout-exercise-swap').click();
    await page.waitForSelector('[data-workout-substitute]');
    eq(await page.locator('[data-sub-mode="today"]').getAttribute('aria-pressed'), 'true');
    ok(await page.locator('[data-sub-name="Curl ai cavi"]').count() === 1, 'manca Curl ai cavi');
    await page.locator('[data-sub-use="Curl ai cavi"]').click();
    await page.waitForSelector('[data-workout-substitute]', { state: 'detached' });
    const text = await card('e2').innerText();
    ok(text.includes('Curl ai cavi') && text.includes('Oggi al posto di Curl con manubri'), text);
    eq(await card('e2').locator('[data-workout-progression]').count(), 0, 'la progressione non vale per l’esercizio sostituito');
    const p = await program();
    eq(p.days[0].exercises[1].name, 'Curl con manubri');
    const entry = p.days[0].activeSession.exercises.find((e) => e.exerciseId === 'e2');
    ok(entry.substitute === true && entry.name === 'Curl ai cavi' && entry.group === 'Bicipiti');
    const expected = await page.evaluate(() => window.N.workouts._logic.substituteKg(11, 'manubri', 'cavi'));
    eq(Number(await card('e2').locator('[data-set-kg]').first().inputValue()), expected);
  });
  await t('dopo aver fatto delle serie l’esercizio non si può sostituire a metà', async () => {
    await card('e1').locator('.workout-set-row:not([data-type="warmup"]) [data-set-done]').first().click();
    await card('e1').locator('.workout-set-row.completed').first().waitFor();
    await card('e1').locator('.workout-exercise-swap').click();
    await page.waitForSelector('.toast');
    ok((await page.locator('.toast').innerText()).includes('Hai già fatto serie'));
    eq(await page.locator('[data-workout-substitute]').count(), 0);
  });
  await t('la sessione conclusa conserva la sostituzione ma non sporca i progressi dell’esercizio originale', async () => {
    await page.click('[data-workout-finish]');
    await page.waitForSelector('[data-workout-start]');
    const p = await program();
    const last = p.sessions[p.sessions.length - 1];
    const e2 = last.exercises.find((e) => e.exerciseId === 'e2');
    ok(e2.substitute === true && e2.name === 'Curl ai cavi');
    eq(await page.evaluate(() => window.N.workouts._logic.exerciseHistory(window.N.workouts._state.program, 'e2').length), 4, 'la sostituzione di oggi non entra nei progressi');
  });

  /* ---------- sostituzione nella scheda ---------- */
  await t('fuori sessione la sostituzione cambia la scheda, con un carico di partenza prudente', async () => {
    const before = (await program()).days[0].exercises[0];
    await card('e1').locator('.workout-exercise-swap').click();
    await page.waitForSelector('[data-workout-substitute]');
    eq(await page.locator('[data-sub-mode]').count(), 0, 'fuori sessione non c’è «solo oggi»');
    await page.click('[data-sub-group="Spalle"]');
    await page.waitForSelector('[data-sub-name="Military press"]');
    await page.click('[data-sub-group="Petto"]');
    const first = await page.locator('[data-sub-name]').first().innerText();
    ok(first.includes('stesso movimento'), first);
    await page.locator('[data-sub-use="Chest press"]').click();
    await page.waitForSelector('[data-workout-substitute]', { state: 'detached' });
    await page.waitForSelector('[data-workout-exercise] strong:has-text("Chest press")');
    const after = (await program()).days[0].exercises[0];
    const kg = await page.evaluate(() => window.N.workouts._logic.substituteKg(50, 'bilanciere', 'macchina'));
    ok(after.id !== before.id && after.name === 'Chest press' && after.group === 'Petto', JSON.stringify(after));
    eq(after.kg, kg); eq(after.setCount, before.setCount); eq(after.reps, before.reps);
    eq((await program()).sessions.filter((s) => s.exercises.some((e) => e.exerciseId === 'e1')).length, 5, 'la cronologia resta');
  });

  /* ---------- modulo esercizio e massimale ---------- */
  await t('il gruppo muscolare si sceglie nel modulo dell’esercizio e si salva', async () => {
    await card('e2').locator('.workout-exercise-more').click();
    await page.getByText('Modifica obiettivo').click();
    await page.locator('[data-workout-exercise-group]').selectOption('Spalle');
    await page.click('[data-workout-save-exercise]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    eq((await program()).days[0].exercises[1].group, 'Spalle');
  });
  await t('nei progressi di un esercizio compare il massimale stimato', async () => {
    await card('e2').locator('.workout-exercise-more').click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('[data-workout-orm]');
    const text = await page.locator('[data-workout-orm]').innerText();
    ok(text.includes('Massimale stimato') && text.includes('14 kg'), text);
    await closeSheet();
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  fs.rmSync(tmp, { recursive: true, force: true });
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
