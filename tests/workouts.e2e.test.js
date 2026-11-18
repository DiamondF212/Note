// Test end-to-end della sezione Allenamenti. Esecuzione: node tests/workouts.e2e.test.js
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

  await t('la migrazione v2 aggiunge l’archivio allenamenti senza perdere note e documenti', async () => {
    await page.goto(base + 'icon.svg');
    await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('mie-note', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('notes', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'k' });
        db.createObjectStore('docs', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result, tx = db.transaction(['notes', 'meta', 'docs'], 'readwrite');
        tx.objectStore('notes').put({ id: 'old-note', kind: 'text', title: 'Nota esistente', body: 'Da conservare', items: [], tags: [], folder: '', bg: { id: 'none' }, pinned: false, trashed: 0, created: 1, updated: 1 });
        tx.objectStore('docs').put({ id: 'old-doc', name: 'Documento esistente', type: 'pdf', size: 1, data: new ArrayBuffer(1), created: 1, updated: 1 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    }));
    await page.goto(base); await page.waitForSelector('#list');
    const result = await page.evaluate(async () => {
      const req = indexedDB.open('mie-note');
      const info = await new Promise((resolve) => { req.onsuccess = () => { const d = req.result; const x = { version: d.version, stores: Array.from(d.objectStoreNames) }; d.close(); resolve(x); }; });
      return { info, note: window.__app.S.notes.find((n) => n.id === 'old-note')?.title, docs: await window.N.db.docs.all() };
    });
    eq(result.info.version, 3); ok(result.info.stores.includes('workouts'), 'manca l’archivio workouts');
    eq(result.note, 'Nota esistente'); eq(result.docs[0].name, 'Documento esistente');
  });

  const openWorkouts = async () => {
    await page.click('#dock button[data-dock="workouts"]');
    await page.waitForSelector('.workout-screen');
  };
  await t('la sezione mostra il messaggio iniziale e l’archivio resta locale', async () => {
    await openWorkouts();
    ok(await page.locator('.workout-empty').innerText().then((x) => x.includes('La tua scheda parte da qui')));
    const noNetwork = await page.evaluate(() => window.N.workouts._state.program.sessions.length === 0);
    ok(noNetwork);
  });
  await t('crea una routine con giorno della settimana', async () => {
    await page.click('[data-workout-add-first]');
    await page.locator('[data-workout-day-name]').fill('Petto e tricipiti');
    await page.locator('[data-workout-day-weekday]').selectOption('Lunedì');
    await page.click('[data-workout-save-day]');
    await page.waitForSelector('.workout-day-title');
    eq(await page.locator('.workout-day-title').innerText(), 'Petto e tricipiti');
    ok(await page.locator('.workout-day-badge').first().innerText().then((x) => x.toLocaleLowerCase('it-IT').includes('lunedì')));
  });
  await t('aggiunge un esercizio con obiettivi di serie, ripetizioni e kg', async () => {
    await page.click('[data-workout-add-exercise]');
    await page.locator('[data-workout-exercise-name]').fill('Panca piana');
    await page.locator('[data-workout-exercise-sets]').fill('3');
    await page.locator('[data-workout-exercise-reps]').fill('8');
    await page.locator('[data-workout-exercise-kg]').fill('50');
    await page.click('[data-workout-save-exercise]');
    await page.waitForSelector('[data-workout-exercise]');
    ok(await page.locator('[data-workout-exercise]').innerText().then((x) => x.includes('3 serie · 8 rip · 50 kg')));
  });
  await t('registra serie diverse e salva una sessione nello storico', async () => {
    await page.click('[data-workout-start]');
    await page.waitForSelector('[data-set-reps]');
    await page.locator('[data-set-reps]').nth(0).fill('8');
    await page.locator('[data-set-kg]').nth(0).fill('50');
    await page.locator('[data-set-reps]').nth(1).fill('7');
    await page.locator('[data-set-kg]').nth(1).fill('52.5');
    await page.locator('[data-set-done]').nth(0).click();
    await page.locator('[data-set-done]').nth(1).click();
    await page.click('[data-workout-finish]');
    await page.waitForSelector('[data-workout-history]');
    const stored = await page.evaluate(async () => window.N.db.workouts.get('program'));
    eq(stored.sessions.length, 1);
    eq(stored.sessions[0].exercises[0].sets[1].kg, 52.5);
    eq(stored.sessions[0].exercises[0].sets[1].reps, 7);
    eq(stored.sessions[0].exercises[0].sets.filter((s) => s.done).length, 2);
  });
  await t('scheda e cronologia sopravvivono al riavvio dell’app', async () => {
    await page.goto('about:blank');
    await page.goto(base); await page.waitForSelector('#list'); await openWorkouts();
    await page.waitForSelector('[data-workout-open-day]');
    eq(await page.locator('.workout-day-main').innerText().then((x) => x.includes('Petto e tricipiti')), true);
    await page.locator('[data-workout-open-day]').click();
    await page.waitForSelector('[data-workout-history]');
    eq(await page.locator('[data-workout-history]').count(), 1);
    ok(await page.locator('.workout-history-row').innerText().then((x) => x.includes('2 serie')));
  });
  await t('registra una seconda sessione e mostra i grafici dei progressi per esercizio', async () => {
    await page.goto('about:blank'); await page.goto(base); await openWorkouts();
    await page.locator('[data-workout-open-day]').first().click();
    await page.waitForSelector('[data-workout-start]');
    await page.click('[data-workout-start]');
    await page.waitForSelector('[data-set-reps]');
    await page.locator('[data-set-reps]').nth(0).fill('6');
    await page.locator('[data-set-kg]').nth(0).fill('55');
    await page.locator('[data-set-done]').nth(0).click();
    await page.click('[data-workout-finish]');
    await page.waitForFunction(() => window.N.workouts._state.program.sessions.length === 2);
    await page.locator('.workout-exercise-more').first().click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('.wk-chart');
    eq(await page.locator('.wk-chart').count(), 2);
    ok(await page.locator('.workout-progress').innerText().then((x) => x.includes('2 sessioni registrate')));
    await page.goBack();
    await page.waitForSelector('.wk-chart', { state: 'detached' });
  });
  await t('crea anche una routine personale senza giorno fisso', async () => {
    await page.goBack(); await page.waitForSelector('.workout-screen');
    await page.locator('.workout-add-day').click();
    await page.locator('[data-workout-day-name]').fill('Mobilità');
    await page.click('[data-workout-save-day]');
    await page.waitForFunction(() => window.N.workouts._state.program.days.length === 2);
    const days = await page.evaluate(() => window.N.workouts._state.program.days);
    eq(days[1].name, 'Mobilità'); eq(days[1].weekday, '');
  });
  const dragHandle = async (handle, toY) => {
    await handle.scrollIntoViewIfNeeded();
    const b = await handle.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x, (y + toY) / 2, { steps: 6 });
    await page.mouse.move(x, toY, { steps: 10 });
    await page.mouse.up();
  };
  const dayNames = () => page.evaluate(() => window.N.workouts._state.program.days.map((d) => d.name));
  const storedDayNames = () => page.evaluate(async () => (await window.N.db.workouts.get('program')).days.map((d) => d.name));
  await t('trascinando la maniglia si riordinano i giorni e l’ordine resta dopo il riavvio', async () => {
    await page.waitForSelector('.workout-day-title'); // la giornata appena creata deve essere aperta prima di tornare indietro
    await page.goBack(); await page.waitForSelector('.workout-day-card');
    eq(await page.locator('.workout-grip').count(), 2);
    eq((await dayNames()).join('|'), 'Petto e tricipiti|Mobilità');
    const first = await page.locator('.workout-day-card').nth(0).boundingBox();
    await dragHandle(page.locator('.workout-day-card .workout-grip').nth(1), first.y + 4);
    await page.waitForFunction(() => window.N.workouts._state.program.days[0].name === 'Mobilità');
    eq((await dayNames()).join('|'), 'Mobilità|Petto e tricipiti');
    eq(await page.locator('.workout-day-card').nth(0).innerText().then((x) => x.includes('Mobilità')), true);
    eq(await page.locator('.workout-day-number').nth(0).innerText(), '01');
    eq(await page.locator('.workout-day-number').nth(1).innerText(), '02');
    await page.waitForTimeout(350);
    eq((await storedDayNames()).join('|'), 'Mobilità|Petto e tricipiti');
    await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list'); await openWorkouts();
    await page.waitForSelector('.workout-day-card');
    eq(await page.locator('.workout-day-card').nth(0).innerText().then((x) => x.includes('Mobilità')), true);
  });
  await t('con la tastiera le frecce sulla maniglia spostano il giorno e lo salvano', async () => {
    await page.locator('.workout-day-card .workout-grip').nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => window.N.workouts._state.program.days[0].name === 'Petto e tricipiti');
    eq(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('workout-grip')), true);
    await page.keyboard.press('ArrowDown');
    eq((await dayNames()).join('|'), 'Petto e tricipiti|Mobilità');
    await page.waitForTimeout(350);
    eq((await storedDayNames()).join('|'), 'Petto e tricipiti|Mobilità');
  });
  await t('gli esercizi di un giorno si riordinano col trascinamento, anche durante una sessione', async () => {
    await page.locator('.workout-day-card:has-text("Petto e tricipiti") [data-workout-open-day]').click();
    await page.waitForSelector('[data-workout-exercise]');
    eq(await page.locator('.workout-grip').count(), 0);
    for (const nome of ['Croci ai cavi', 'Dip']) {
      await page.click('[data-workout-add-exercise]');
      await page.locator('[data-workout-exercise-name]').fill(nome);
      await page.click('[data-workout-save-exercise]');
      await page.waitForFunction((n) => window.N.workouts._state.program.days.some((d) => d.exercises.some((e) => e.name === n)), nome);
    }
    const names = () => page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    eq(await names(), 'Panca piana|Croci ai cavi|Dip');
    await page.waitForFunction(() => document.querySelectorAll('.workout-exercise-card .workout-grip').length === 3);
    eq(await page.locator('.workout-exercise-card .workout-grip').count(), 3);
    const first = await page.locator('.workout-exercise-card').nth(0).boundingBox();
    await dragHandle(page.locator('.workout-exercise-card .workout-grip').nth(2), first.y + 4);
    await page.waitForFunction(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises[0].name === 'Dip');
    eq(await names(), 'Dip|Panca piana|Croci ai cavi');
    eq(await page.locator('.workout-exercise-card').nth(0).innerText().then((x) => x.includes('Dip')), true);
    await page.click('[data-workout-start]');
    await page.waitForSelector('[data-set-reps]');
    await page.locator('.workout-exercise-card .workout-grip').nth(0).focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises[0].name === 'Panca piana');
    const sessione = await page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').activeSession.exercises.map((e) => e.name).join('|'));
    eq(sessione, 'Panca piana|Dip|Croci ai cavi');
    await page.waitForTimeout(350);
    const salvato = await page.evaluate(async () => (await window.N.db.workouts.get('program')).days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    eq(salvato, 'Panca piana|Dip|Croci ai cavi');
  });
  await t('il trascinamento funziona anche con veri eventi touch (dito sul telefono)', async () => {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const names = () => page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    const prima = await names();
    const first = await page.locator('.workout-exercise-card').nth(0).boundingBox();
    const handle = page.locator('.workout-exercise-card .workout-grip').nth(2);
    await handle.scrollIntoViewIfNeeded();
    const b = await handle.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2, toY = first.y + 4;
    await touch('touchStart', x, y);
    for (let i = 1; i <= 14; i++) await touch('touchMove', x, y + (toY - y) * i / 14);
    await touch('touchEnd');
    await page.waitForFunction((p) => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|') !== p, prima);
    const dopo = await names();
    eq(dopo.split('|')[0], prima.split('|')[2]);
    eq(dopo.split('|').length, 3);
    await page.waitForTimeout(350);
    const salvato = await page.evaluate(async () => (await window.N.db.workouts.get('program')).days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    eq(salvato, dopo);
  });
  await t('un semplice tocco sulla maniglia non cambia l’ordine', async () => {
    const prima = await page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    await page.locator('.workout-exercise-card .workout-grip').nth(1).click();
    await page.waitForTimeout(300);
    const dopo = await page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|'));
    eq(dopo, prima);
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
