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
    // In sessione le card sono alte: si trascina la seconda sopra la prima, misurando dopo lo scorrimento.
    // La barra in basso copre la fine dello schermo: si porta la maniglia a metà altezza, ben sopra la barra.
    await page.evaluate(() => {
      const body = document.querySelector('.workout-body'), grip = document.querySelectorAll('.workout-exercise-card .workout-grip')[1];
      if (body && grip) body.scrollTop += grip.getBoundingClientRect().top - 560;
    });
    const handle = page.locator('.workout-exercise-card .workout-grip').nth(1);
    const first = await page.locator('.workout-exercise-card').nth(0).boundingBox();
    const b = await handle.boundingBox();
    const x = b.x + b.width / 2, y = b.y + b.height / 2, toY = Math.max(first.y + 4, 130);
    await touch('touchStart', x, y);
    for (let i = 1; i <= 14; i++) await touch('touchMove', x, y + (toY - y) * i / 14);
    await touch('touchEnd');
    await page.waitForFunction((p) => window.N.workouts._state.program.days.find((d) => d.name === 'Petto e tricipiti').exercises.map((e) => e.name).join('|') !== p, prima);
    const dopo = await names();
    eq(dopo.split('|')[0], prima.split('|')[1]);
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
  /* ---------- ripetizioni per serie, tipi di serie, RPE, note ---------- */
  const toOverview = async () => { await page.waitForSelector('.workout-day-title'); await page.goBack(); await page.waitForSelector('.workout-day-card'); };
  const closeSheet = async () => { await page.goBack(); await page.waitForSelector('.sheet', { state: 'detached' }); };
  const squat = () => page.evaluate(() => window.N.workouts._state.program.days.find((d) => d.name === 'Gambe').exercises[0]);
  await t('aggiungendo un esercizio si scelgono ripetizioni e tipo per ogni serie, e una nota fissa', async () => {
    await toOverview();
    await page.locator('.workout-add-day').click();
    await page.locator('[data-workout-day-name]').fill('Gambe');
    await page.locator('[data-workout-day-weekday]').selectOption('Venerdì');
    await page.click('[data-workout-save-day]');
    await page.waitForSelector('.workout-day-title');
    await page.click('[data-workout-add-exercise]');
    await page.locator('[data-workout-exercise-name]').fill('Squat');
    await page.locator('[data-workout-exercise-kg]').fill('40');
    eq(await page.locator('[data-perset-reps]').count(), 3);
    eq(await page.locator('[data-perset-reps]').nth(0).inputValue(), '10');
    await page.locator('[data-perset-reps="0"]').fill('12');
    await page.locator('[data-perset-reps="1"]').fill('10');
    await page.locator('[data-perset-reps="2"]').fill('8');
    await page.locator('[data-perset-type="0"]').selectOption('warmup');
    await page.locator('[data-workout-exercise-sets]').fill('2');
    eq(await page.locator('[data-perset-reps]').count(), 2);
    await page.locator('[data-workout-exercise-sets]').fill('3');
    eq(await page.locator('[data-perset-reps]').count(), 3);
    eq(await page.locator('[data-perset-reps="2"]').inputValue(), '8', 'cambiando il numero di serie non si perdono i valori');
    eq(await page.locator('[data-perset-type="0"]').inputValue(), 'warmup');
    await page.locator('[data-workout-exercise-note]').fill('  sedile in posizione 4  ');
    await page.click('[data-workout-save-exercise]');
    await page.waitForSelector('[data-workout-exercise]');
    const card = await page.locator('[data-workout-exercise]').innerText();
    ok(card.includes('3 serie · 12/10/8 rip · 40 kg'), card);
    ok(card.includes('12 · 10 · 8'), card);
    eq(await page.locator('[data-exercise-fixed-note]').innerText(), 'sedile in posizione 4');
    const ex = await squat();
    eq(JSON.stringify(ex.setReps), '[12,10,8]'); eq(JSON.stringify(ex.setTypes), '["warmup","normal","normal"]'); eq(ex.reps, 12); eq(ex.note, 'sedile in posizione 4');
  });
  await t('modificando l’esercizio compaiono i valori per serie; «Rip. di tutte» le riallinea', async () => {
    await page.locator('.workout-exercise-more').first().click();
    await page.getByText('Modifica obiettivo').click();
    await page.waitForSelector('[data-perset-reps]');
    eq(await page.locator('[data-perset-reps="1"]').inputValue(), '10');
    eq(await page.locator('[data-perset-type="0"]').inputValue(), 'warmup');
    eq(await page.locator('[data-workout-exercise-note]').inputValue(), 'sedile in posizione 4');
    await page.locator('[data-workout-exercise-reps]').fill('9');
    eq(await page.locator('[data-perset-reps]').evaluateAll((els) => els.map((e) => e.value).join(',')), '9,9,9');
    await closeSheet();
    eq((await squat()).setReps.join(','), '12,10,8', 'annullando non cambia nulla');
  });
  await t('aprendo un modulo, il cursore non ruba il campo che hai già scelto', async () => {
    // Nello stesso istante: apre il modulo e porta il cursore sul campo Kg, prima che scatti il focus automatico sul nome.
    await page.evaluate(() => { document.querySelector('[data-workout-add-exercise]').click(); document.querySelector('[data-workout-exercise-kg]').focus(); });
    await page.waitForTimeout(450);
    eq(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-workout-exercise-kg')), true);
    await closeSheet();
    await page.evaluate(() => { document.querySelector('[data-workout-add-exercise]').click(); });
    await page.waitForTimeout(450);
    eq(await page.evaluate(() => document.activeElement && document.activeElement.hasAttribute('data-workout-exercise-name')), true, 'se non scegli nulla il cursore va sul nome');
    await closeSheet();
  });
  await t('in sessione ogni serie parte dal suo obiettivo; tipo, RPE e note si registrano e si salvano', async () => {
    await page.click('[data-workout-start]');
    await page.waitForSelector('[data-set-reps]');
    eq(await page.locator('[data-set-reps]').evaluateAll((els) => els.map((e) => e.value).join(',')), '12,10,8');
    eq(await page.locator('.workout-set-row').nth(0).getAttribute('data-type'), 'warmup');
    ok((await page.locator('[data-set-type]').nth(0).innerText()).toLowerCase().includes('risc'));
    const badge = page.locator('[data-set-type]').nth(1);
    for (const atteso of ['warmup', 'drop', 'normal', 'warmup', 'drop']) { await badge.click(); eq(await page.locator('.workout-set-row').nth(1).getAttribute('data-type'), atteso); }
    await page.locator('[data-set-rpe]').nth(1).fill('8.5'); await page.locator('[data-set-rpe]').nth(1).press('Tab');
    await page.locator('[data-set-rpe]').nth(2).fill('11'); await page.locator('[data-set-rpe]').nth(2).press('Tab');
    eq(await page.locator('[data-set-rpe]').nth(2).inputValue(), '', 'un RPE oltre 10 viene scartato');
    for (let i = 0; i < 3; i++) await page.locator('[data-set-done]').nth(i).click();
    eq((await page.locator('[data-exercise-note-toggle]').first().innerText()).trim(), 'Aggiungi una nota');
    await page.click('[data-exercise-note-toggle]');
    eq((await page.locator('[data-exercise-note-toggle]').first().innerText()).trim(), 'Nota di oggi', 'aprendo la nota l’etichetta cambia');
    await page.locator('textarea[data-exercise-note]').fill('spalla fastidiosa'); await page.locator('textarea[data-exercise-note]').press('Tab');
    await page.locator('[data-session-note]').fill('Giornata stanca ma buona'); await page.locator('[data-session-note]').press('Tab');
    eq(await page.locator('#workout-session-summary').innerText(), '3 / 3 serie completate · 720 kg di volume');
    await page.waitForTimeout(350);
    const saved = await page.evaluate(async () => (await window.N.db.workouts.get('program')).days.find((d) => d.name === 'Gambe').activeSession);
    eq(saved.note, 'Giornata stanca ma buona'); eq(saved.exercises[0].note, 'spalla fastidiosa');
    eq(JSON.stringify(saved.exercises[0].sets.map((x) => [x.type || 'normal', x.rpe == null ? null : x.rpe, x.done])), '[["warmup",null,true],["drop",8.5,true],["normal",null,true]]');
  });
  await t('la sessione conclusa conserva tipi, RPE e note; il riscaldamento non entra nel volume né nei progressi', async () => {
    await page.click('[data-workout-finish]');
    await page.waitForSelector('[data-workout-history]');
    const row = await page.locator('[data-workout-history]').first().innerText();
    ok(row.includes('3 serie · 720 kg · con nota'), row);
    await page.locator('[data-workout-history]').first().click();
    await page.waitForSelector('.workout-session-details');
    const d = await page.locator('.workout-session-details').innerText();
    for (const part of ['Risc. 12 × 40 kg', 'Drop 10 × 40 kg · RPE 8,5', '8 × 40 kg', 'spalla fastidiosa', 'Giornata stanca ma buona']) ok(d.includes(part), part + ' <- ' + d);
    await closeSheet();
    await page.locator('.workout-exercise-more').first().click();
    await page.click('[data-workout-progress]');
    await page.waitForSelector('.wk-chart');
    const p = await page.locator('.workout-progress').innerText();
    ok(p.includes('1 sessione registrata') && p.includes('ultimo: 40 kg × 10'), p);
    await closeSheet();
  });
  await t('la scheda Costanza mostra la serie di settimane, la settimana in corso e il calendario', async () => {
    await toOverview();
    eq(await page.locator('[data-workout-streak]').getAttribute('data-workout-streak'), '1');
    ok((await page.locator('[data-workout-consistency]').innerText()).includes('1 settimana di fila'));
    eq(await page.locator('.workout-week-dot').count(), 7);
    eq(await page.locator('.workout-week-dot.today.done').count(), 1);
    const totale = await page.evaluate(() => window.N.workouts._state.program.sessions.length);
    await page.click('[data-workout-calendar]');
    await page.waitForSelector('[data-workout-calendar-sheet]');
    eq(await page.locator('.workout-cal-day.has').count(), 1, 'tutte le sessioni dei test sono di oggi');
    ok((await page.locator('[data-cal-summary]').innerText()).includes(totale + ' sessioni in questo mese'));
    await page.locator('.workout-cal-day.has').click();
    eq(await page.locator('[data-cal-session]').count(), totale);
    await page.locator('[data-cal-session]:has-text("Gambe")').click();
    await page.waitForSelector('.workout-session-details');
    ok((await page.locator('.workout-session-details').innerText()).includes('Squat'));
    await page.goBack(); await page.waitForSelector('.workout-session-details', { state: 'detached' });
    eq(await page.locator('[data-workout-calendar-sheet]').count(), 1, 'il calendario resta aperto sotto i dettagli');
    const titolo = await page.locator('[data-cal-title]').innerText();
    await page.click('[data-cal-next]');
    ok((await page.locator('[data-cal-title]').innerText()) !== titolo);
    eq(await page.locator('.workout-cal-day.has').count(), 0);
    eq(await page.locator('[data-cal-summary]').innerText(), 'Nessuna sessione in questo mese.');
    await page.click('[data-cal-prev]');
    eq(await page.locator('[data-cal-title]').innerText(), titolo);
    await closeSheet();
  });

  /* ---------- peso corporeo ---------- */
  await t('il peso corporeo si registra, ha una misura al giorno e mostra andamento e variazione', async () => {
    ok((await page.locator('[data-workout-weight]').innerText()).includes('Nessuna misura'));
    eq(await page.locator('[data-workout-weight-trend]').count(), 0);
    const ieri = await page.evaluate(() => window.N.workouts._logic.dayKey(Date.now() - 864e5));
    await page.click('[data-workout-weight-add]');
    await page.locator('[data-workout-weight-kg]').fill('5');
    await page.click('[data-workout-weight-save]');
    ok((await page.locator('.sheet .err').innerText()).includes('tra 20 e 400'));
    await page.locator('[data-workout-weight-kg]').fill('79.4');
    await page.locator('[data-workout-weight-date]').fill(ieri);
    await page.click('[data-workout-weight-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    eq(await page.evaluate(() => window.N.workouts._state.program.bodyWeights.length), 1);
    await page.click('[data-workout-weight-add]');
    eq(await page.locator('[data-workout-weight-kg]').inputValue(), '79.4', 'propone l’ultima misura');
    await page.locator('[data-workout-weight-kg]').fill('80');
    await page.click('[data-workout-weight-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    eq(await page.evaluate(() => window.N.workouts._state.program.bodyWeights.length), 2);
    await page.click('[data-workout-weight-add]');
    await page.locator('[data-workout-weight-kg]').fill('80.4');
    await page.click('[data-workout-weight-save]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    eq(await page.evaluate(() => window.N.workouts._state.program.bodyWeights.map((w) => w.kg).join(',')), '79.4,80.4', 'la seconda misura di oggi sostituisce la prima');
    const card = await page.locator('[data-workout-weight]').innerText();
    ok(card.includes('80,4 kg') && card.includes('+1 kg rispetto alla misura precedente'), card);
    await page.click('[data-workout-weight-trend]');
    await page.waitForSelector('[data-workout-weight-sheet] .wk-chart');
    eq(await page.locator('.workout-weight-row').count(), 2);
    ok((await page.locator('[data-workout-weight-sheet]').innerText()).includes('2 misure · da 79,4 a 80,4 kg (+1)'));
    await page.locator('.workout-weight-row').first().locator('.workout-weight-del').click();
    await page.waitForFunction(() => document.querySelectorAll('.workout-weight-row').length === 1);
    eq(await page.evaluate(() => window.N.workouts._state.program.bodyWeights.length), 1);
    ok((await page.locator('[data-workout-weight-sheet]').innerText()).includes('Registra un’altra misura'));
    await closeSheet();
    await page.waitForTimeout(350);
    await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list'); await openWorkouts();
    await page.waitForSelector('[data-workout-weight]');
    ok((await page.locator('[data-workout-weight]').innerText()).includes('79,4 kg'), 'la misura resta dopo il riavvio');
  });

  /* ---------- promemoria ---------- */
  await t('nel browser il promemoria non si può attivare e lo spiega', async () => {
    eq(await page.locator('[data-workout-reminder-toggle]').getAttribute('aria-checked'), 'false');
    ok((await page.locator('[data-workout-reminder-hint]').innerText()).includes('Ven'), 'indica i giorni assegnati');
    await page.click('[data-workout-reminder-toggle]');
    await page.waitForSelector('.toast');
    ok((await page.locator('.toast').innerText()).includes('app Android'));
    eq(await page.locator('[data-workout-reminder-toggle]').getAttribute('aria-checked'), 'false');
  });
  await t('nell’app Android il promemoria programma un avviso settimanale per ogni giorno assegnato', async () => {
    await page.addInitScript(() => {
      window.__ln = []; window.__lnPerm = 'granted';
      window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
        checkPermissions: async () => ({ display: window.__lnPerm }),
        requestPermissions: async () => ({ display: window.__lnPerm }),
        createChannel: async (c) => { window.__ln.push(['channel', c]); },
        cancel: async (c) => { window.__ln.push(['cancel', c]); },
        schedule: async (c) => { window.__ln.push(['schedule', c]); } } } };
    });
    await page.goto('about:blank'); await page.goto(base); await page.waitForSelector('#list'); await openWorkouts();
    await page.waitForSelector('[data-workout-reminder-toggle]');
    const calls = () => page.evaluate(() => window.__ln.map((c) => [c[0], c[1]]));
    // permesso negato: resta spento e lo dice
    await page.evaluate(() => { window.__lnPerm = 'denied'; });
    await page.click('[data-workout-reminder-toggle]');
    await page.waitForSelector('.toast');
    ok((await page.locator('.toast').innerText()).includes('negato'));
    eq(await page.locator('[data-workout-reminder-toggle]').getAttribute('aria-checked'), 'false');
    eq((await calls()).filter((c) => c[0] === 'schedule').length, 0);
    // permesso concesso
    await page.evaluate(() => { window.__lnPerm = 'granted'; window.__ln.length = 0; });
    await page.click('[data-workout-reminder-toggle]');
    await page.waitForFunction(() => window.__ln.some((c) => c[0] === 'schedule'));
    await page.waitForFunction(() => document.querySelector('[data-workout-reminder-hint]').textContent.includes('alle 18:00'));
    const sch = (await calls()).filter((c) => c[0] === 'schedule');
    eq(sch.length, 1);
    const n = sch[0][1].notifications.slice().sort((a, b) => a.id - b.id);
    eq(n.length, 2, 'lunedì (Petto e tricipiti) e venerdì (Gambe); Mobilità non ha un giorno');
    eq(JSON.stringify(n[0].schedule.on), '{"weekday":2,"hour":18,"minute":0}');
    eq(JSON.stringify(n[1].schedule.on), '{"weekday":6,"hour":18,"minute":0}');
    eq(n[0].id, 7200); eq(n[0].body, 'Petto e tricipiti'); eq(n[1].id, 7204); eq(n[1].body, 'Gambe');
    eq(n[1].schedule.allowWhileIdle, true); eq(n[1].title, 'È ora di allenarti');
    ok((await page.locator('[data-workout-reminder-hint]').innerText()).includes('Lun · Ven alle 18:00'));
    // cambio d'ora
    await page.evaluate(() => { window.__ln.length = 0; });
    await page.locator('[data-workout-reminder-time]').fill('07:30');
    await page.waitForFunction(() => window.__ln.some((c) => c[0] === 'schedule'));
    const dopo = (await calls()).filter((c) => c[0] === 'schedule').pop()[1].notifications.map((x) => x.schedule.on.weekday + '@' + x.schedule.on.hour + ':' + x.schedule.on.minute).sort().join(',');
    eq(dopo, '2@7:30,6@7:30');
    // un secondo giorno assegnato aggiunge il suo avviso
    await page.evaluate(() => { window.__ln.length = 0; });
    await page.locator('.workout-day-card:has-text("Mobilità") .workout-day-more').click();
    await page.getByText('Modifica giornata').click();
    await page.locator('[data-workout-day-weekday]').selectOption('Mercoledì');
    await page.click('[data-workout-save-day]');
    await page.waitForFunction(() => window.__ln.some((c) => c[0] === 'schedule'));
    const due = (await calls()).filter((c) => c[0] === 'schedule').pop()[1].notifications.map((x) => x.schedule.on.weekday + ':' + x.id).sort().join(',');
    eq(due, '2:7200,4:7202,6:7204');
    // spegnimento: cancella tutti gli avvisi e non ne programma altri
    await page.evaluate(() => { window.__ln.length = 0; });
    await page.click('[data-workout-reminder-toggle]');
    await page.waitForFunction(() => window.__ln.some((c) => c[0] === 'cancel'));
    await page.waitForFunction(() => document.querySelector('[data-workout-reminder-toggle]').getAttribute('aria-checked') === 'false');
    const fine = await calls();
    eq(fine.filter((c) => c[0] === 'schedule').length, 0);
    eq(fine.filter((c) => c[0] === 'cancel').pop()[1].notifications.length, 7);
    await page.waitForTimeout(350);
    eq(await page.evaluate(async () => JSON.stringify((await window.N.db.workouts.get('program')).reminder)), '{"enabled":false,"time":"07:30"}');
  });
  await t('nessun errore JavaScript durante il flusso', async () => eq(errors.join(' | '), ''));

  console.log('\n' + passed + ' superati, ' + failed + ' falliti');
  await browser.close(); server.close(); process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
