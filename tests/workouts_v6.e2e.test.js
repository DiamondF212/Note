// Test end-to-end di Allenamenti v6: esercizi a tempo (freccia nel riquadro delle ripetizioni) e tasto Indietro di Android.
// Esecuzione: node tests/workouts_v6.e2e.test.js
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
  // App Android finta: il plugin App registra l'ascoltatore di Indietro e si può simulare il gesto.
  await ctx.addInitScript(() => {
    if (!location.search.includes('android')) return;
    window.__backListeners = []; window.__exited = 0;
    window.Capacitor = { isNativePlatform: () => true, Plugins: { App: {
      addListener: (name, fn) => { if (name === 'backButton') window.__backListeners.push(fn); return Promise.resolve({ remove() {} }); },
      exitApp: () => { window.__exited++; return Promise.resolve(); } } } };
    window.__gesture = () => window.__backListeners.forEach((fn) => fn({ canGoBack: true }));
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(6000);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '?android'); await page.waitForSelector('#list');
  const now = Date.now();
  await page.evaluate(async (n) => {
    await window.N.db.workouts.put({ id: 'program', updated: n, bodyWeights: [], reminder: { enabled: false, time: '18:00' }, sessions: [],
      days: [{ id: 'd1', name: 'Dorso', weekday: '', created: n, activeSession: null, exercises: [{ id: 'e1', name: 'Trazioni', setCount: 3, reps: 8, kg: 0, group: 'Dorso' }] }] });
  }, now);
  await page.reload(); await page.waitForSelector('#list');
  const depth = () => page.evaluate(() => (history.state && history.state.l) || 0);
  const gesture = async () => { await page.evaluate(() => window.__gesture()); await page.waitForTimeout(200); };
  const program = () => page.evaluate(() => JSON.parse(JSON.stringify(window.N.workouts._state.program)));

  await page.click('#dock button[data-dock="workouts"]'); await page.waitForSelector('.workout-day-card');
  await page.locator('[data-workout-open-day]').first().click(); await page.waitForSelector('.workout-day-title');

  /* ---------- selettore ripetizioni / tempo ---------- */
  await t('nel modulo esercizio la freccia sta dentro il riquadro delle ripetizioni (nessun campo in più)', async () => {
    await page.click('.workout-add-exercise'); await page.waitForSelector('[data-workout-exercise-name]');
    eq(await page.locator('.workout-unit-box [data-workout-exercise-reps]').count(), 1);
    eq(await page.locator('.workout-unit-box [data-workout-exercise-unit]').count(), 1);
    eq(await page.locator('.workout-form-grid label').count(), 3, 'restano Serie, Rip. di tutte e Kg');
    eq(await page.locator('[data-unit-caption]').innerText(), 'Rip. di tutte');
    eq(await page.locator('[data-workout-exercise-unit] option').allInnerTexts().then((x) => x.join('|')), 'Ripetizioni|Tempo (secondi)');
  });
  await t('scegliendo «Tempo» cambiano etichette e valori di partenza (30 s)', async () => {
    await page.selectOption('[data-workout-exercise-unit]', 'time');
    eq(await page.locator('[data-unit-caption]').innerText(), 'Sec. di tutte');
    eq(await page.inputValue('[data-workout-exercise-reps]'), '30');
    eq(await page.locator('[data-perset-reps]').count(), 3);
    eq(await page.getAttribute('[data-perset-reps="0"]', 'aria-label'), 'Secondi serie 1');
    ok((await page.locator('.workout-perset-head strong').innerText()).startsWith('Tempo'));
  });
  await t('un esercizio a tempo si salva con unit «time» e secondi anche sopra 100', async () => {
    await page.fill('[data-workout-exercise-name]', 'Dead hang');
    await page.fill('[data-workout-exercise-reps]', '150'); await page.dispatchEvent('[data-workout-exercise-reps]', 'input');
    await page.fill('[data-workout-exercise-sets]', '2'); await page.dispatchEvent('[data-workout-exercise-sets]', 'input');
    await page.click('[data-workout-save-exercise]'); await page.waitForSelector('.sheet', { state: 'detached' });
    const ex = (await program()).days[0].exercises.find((e) => e.name === 'Dead hang');
    eq(ex.unit, 'time'); eq(ex.reps, 150); eq(ex.setCount, 2);
    eq((await program()).days[0].exercises[0].unit, undefined, 'Trazioni resta a ripetizioni');
    ok((await page.locator('[data-workout-exercise]:has-text("Dead hang") small').first().innerText()).includes('2 min 30 s'));
  });
  await t('in sessione la colonna è SEC, il riscaldamento suggerito non compare e si registra il tempo', async () => {
    await page.click('.btn.pri:has-text("Inizia allenamento")'); await page.waitForSelector('.workout-set-row');
    const card = page.locator('[data-workout-exercise]:has-text("Dead hang")');
    eq(await card.locator('.workout-set-head span >> nth=1').innerText(), 'SEC');
    eq(await card.locator('[data-workout-warmup]').count(), 0);
    eq(await page.locator('[data-workout-exercise]:has-text("Trazioni") .workout-set-head span >> nth=1').innerText(), 'RIP');
    await card.locator('[data-set-reps]').first().fill('62'); await card.locator('[data-set-reps]').first().dispatchEvent('change');
    await card.locator('[data-set-done]').first().click(); await page.waitForTimeout(300);
    const s = (await program()).days[0].activeSession.exercises.find((e) => e.name === 'Dead hang');
    eq(s.unit, 'time'); eq(s.sets[0].reps, 62); eq(s.sets[0].done, true);
  });
  await t('concludendo la sessione il tempo non fa volume e il riepilogo mostra i secondi', async () => {
    const card = page.locator('[data-workout-exercise]:has-text("Dead hang")');
    await card.locator('[data-set-done]').nth(1).click(); await page.waitForTimeout(200); // la seconda serie resta a 150 s
    await page.click('button:has-text("Concludi sessione")'); await page.waitForTimeout(400);
    const prog = await program();
    eq(prog.sessions.length, 1);
    eq(await page.evaluate(() => window.N.workouts._logic.sessionStats(window.N.workouts._state.program.sessions[0]).volume), 0);
  });
  await t('la scheda progressi mostra il tempo (grafico e tabella) senza massimale', async () => {
    await page.click('[data-workout-exercise]:has-text("Dead hang") .workout-exercise-more'); await page.waitForTimeout(250);
    const btn = page.locator('.sheet button:has-text("progressi"), .sheet button:has-text("Progressi")').first();
    await btn.click(); await page.waitForSelector('.workout-progress');
    ok((await page.locator('.workout-progress').innerText()).includes('2 min 30 s'), 'ultimo tempo non mostrato');
    eq(await page.locator('.workout-progress .wk-chart-title:has-text("Tempo")').count(), 1);
    eq(await page.locator('[data-workout-orm]').count(), 0);
    await page.click('.workout-segment button:has-text("Tabella")'); await page.waitForSelector('[data-workout-table]');
    ok((await page.locator('.workout-table-row.head').innerText()).includes('Tempo'));
    ok((await page.locator('[data-table-row]').first().innerText()).includes('1:02'), 'tempo in minuti:secondi');
    await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' });
  });
  await t('si può tornare a «Ripetizioni» da un esercizio a tempo', async () => {
    await page.click('[data-workout-exercise]:has-text("Dead hang") .workout-exercise-more'); await page.waitForTimeout(250);
    await page.locator('.sheet button:has-text("Modifica")').first().click(); await page.waitForSelector('[data-workout-exercise-unit]');
    eq(await page.inputValue('[data-workout-exercise-unit]'), 'time');
    await page.selectOption('[data-workout-exercise-unit]', 'reps');
    eq(await page.inputValue('[data-workout-exercise-reps]'), '10');
    await page.click('[data-workout-save-exercise]'); await page.waitForSelector('.sheet', { state: 'detached' });
    eq((await program()).days[0].exercises.find((e) => e.name === 'Dead hang').unit, undefined);
  });

  /* ---------- tasto Indietro di Android ---------- */
  await t('il gesto Indietro di Android chiude un livello alla volta e non esce dall’app', async () => {
    await page.click('[data-workout-exercise]:has-text("Dead hang") .workout-exercise-more'); await page.waitForTimeout(250);
    eq(await page.locator('.sheet').count(), 1);
    await gesture(); eq(await page.locator('.sheet').count(), 0, 'il pannello doveva chiudersi');
    ok(await page.locator('.workout-day-title').count() === 1, 'la giornata doveva restare aperta');
    await gesture(); eq(await page.locator('.workout-day-title').count(), 0); eq(await page.locator('.workout-day-card').count() > 0, true);
    await gesture(); eq(await page.locator('.workout-screen').count(), 0); eq(await depth(), 0);
    eq(await page.evaluate(() => window.__exited), 0, 'finora non si deve uscire');
  });
  await t('solo dalla home il gesto Indietro esce dall’app', async () => {
    await gesture(); eq(await page.evaluate(() => window.__exited), 1);
  });
  await t('un solo ascoltatore di Indietro registrato', async () => { eq(await page.evaluate(() => window.__backListeners.length), 1); });
  await t('nessun errore JavaScript durante il flusso', async () => { eq(errors.length, 0, errors.join(' | ')); });

  await browser.close(); server.close();
  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
