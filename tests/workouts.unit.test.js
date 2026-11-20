// Test della logica pura di workouts.js. Esecuzione: node tests/workouts.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../workouts.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

t('nomi ripuliti e limitati', () => {
  assert.strictEqual(L.cleanName('  Petto   e tricipiti  '), 'Petto e tricipiti');
  assert.strictEqual(L.cleanName('   '), '');
  assert.strictEqual(L.cleanName('x'.repeat(80)).length, 60);
});
t('serie e ripetizioni rispettano i limiti', () => {
  assert.strictEqual(L.whole('4', null, 1, L.MAX_SETS), 4);
  assert.strictEqual(L.whole('0', null, 1, L.MAX_SETS), null);
  assert.strictEqual(L.whole('21', 3, 1, L.MAX_SETS), 3);
  assert.strictEqual(L.whole('2.5', 10, 1, L.MAX_REPS), 10);
});
t('il carico accetta la virgola decimale e rifiuta valori non validi', () => {
  assert.strictEqual(L.weight('12,5', 0), 12.5);
  assert.strictEqual(L.weight('0', 3), 0);
  assert.strictEqual(L.weight('-2', 7), 7);
  assert.strictEqual(L.weight('1001', 7), 7);
  assert.strictEqual(L.weight('abc', null), null);
});
t('la sessione parte dai valori-obiettivo di ogni esercizio', () => {
  const day = { id: 'lun', name: 'Petto', exercises: [
    { id: 'panca', name: 'Panca piana', setCount: 3, reps: 8, kg: 50 }
  ] };
  const s = L.makeSession(day, 'sessione-1', 1000);
  assert.deepStrictEqual([s.dayId, s.dayName, s.startedAt], ['lun', 'Petto', 1000]);
  assert.deepStrictEqual(s.exercises[0].sets, [
    { reps: 8, kg: 50, done: false }, { reps: 8, kg: 50, done: false }, { reps: 8, kg: 50, done: false }
  ]);
});
t('volume e serie completate contano solo quelle segnate', () => {
  const stats = L.sessionStats({ exercises: [
    { sets: [{ reps: 8, kg: 50, done: true }, { reps: 7, kg: 50, done: false }] },
    { sets: [{ reps: 10, kg: 20, done: true }] }
  ] });
  assert.deepStrictEqual(stats, { totalSets: 3, completedSets: 2, volume: 600 });
});
t('il riepilogo settimanale include solo le sessioni recenti', () => {
  const now = 10 * 864e5;
  assert.strictEqual(L.recentCount([{ completedAt: now }, { completedAt: now - 6 * 864e5 }, { completedAt: now - 8 * 864e5 }], now), 2);
});
t('la normalizzazione conserva le schede e crea raccolte vuote quando mancano', () => {
  const p = L.normalizeProgram({ days: [{ id: 'lun', name: 'Lunedì', weekday: 'Lunedì', exercises: [
    { id: 'squat', name: 'Squat', setCount: 4, reps: 6, kg: 70 }
  ] }] });
  assert.strictEqual(p.id, 'program');
  assert.strictEqual(p.days[0].exercises[0].kg, 70);
  assert.deepStrictEqual(p.sessions, []);
});

t('lo storico usa la serie più pesante completata di ogni sessione, in ordine di tempo', () => {
  const prog = { sessions: [
    { id: 'a', completedAt: 2000, exercises: [{ exerciseId: 'x', sets: [
      { reps: 8, kg: 50, done: true }, { reps: 6, kg: 60, done: true }, { reps: 10, kg: 99, done: false }] }] },
    { id: 'b', completedAt: 1000, exercises: [{ exerciseId: 'x', sets: [{ reps: 10, kg: 40, done: true }] }] },
    { id: 'c', completedAt: 3000, exercises: [{ exerciseId: 'y', sets: [{ reps: 5, kg: 20, done: true }] }] }
  ] };
  assert.deepStrictEqual(L.exerciseHistory(prog, 'x'), [
    { t: 1000, kg: 40, reps: 10 }, { t: 2000, kg: 60, reps: 6 }
  ]);
  assert.deepStrictEqual(L.exerciseHistory(prog, 'assente'), []);
  assert.deepStrictEqual(L.exerciseHistory({ sessions: [] }, 'x'), []);
});
t('a parità di carico vince la serie con più ripetizioni', () => {
  const prog = { sessions: [{ id: 'a', completedAt: 1, exercises: [{ exerciseId: 'x', sets: [
    { reps: 5, kg: 80, done: true }, { reps: 8, kg: 80, done: true }] }] }] };
  assert.strictEqual(L.exerciseHistory(prog, 'x')[0].reps, 8);
});
t('il grafico SVG è valido, escapa il titolo e gestisce un solo punto', () => {
  const pts = [{ label: '1 nov', kg: 40, reps: 10 }, { label: '2 nov', kg: 60, reps: 6 }];
  const svg = L.lineChartSvg(pts, 'kg', 'Panca <b>"x"</b>');
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('aria-label="Panca &lt;b&gt;&quot;x&quot;&lt;/b&gt;"'));
  assert.ok(svg.includes('<polyline'));
  assert.strictEqual((svg.match(/<circle/g) || []).length, 2);
  const one = L.lineChartSvg([pts[0]], 'reps', 'T');
  assert.ok(!one.includes('<polyline'));
  assert.strictEqual((one.match(/<circle/g) || []).length, 1);
});
t('il grafico con valori uguali non produce scale degeneri', () => {
  const svg = L.lineChartSvg([{ label: 'a', kg: 50, reps: 8 }, { label: 'b', kg: 50, reps: 8 }], 'kg', 'T');
  assert.ok(!/NaN|Infinity/.test(svg));
});

t('reorderById riordina secondo gli id senza modificare la lista originale', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = L.reorderById(list, ['c', 'a', 'b'], (x) => x.id);
  assert.deepStrictEqual(out.map((x) => x.id), ['c', 'a', 'b']);
  assert.deepStrictEqual(list.map((x) => x.id), ['a', 'b', 'c']);
  assert.strictEqual(out[0], list[2]);
});
t('reorderById non perde elementi: id sconosciuti ignorati, mancanti in coda, duplicati preservati', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepStrictEqual(L.reorderById(list, ['zzz', 'c'], (x) => x.id).map((x) => x.id), ['c', 'a', 'b']);
  assert.deepStrictEqual(L.reorderById(list, [], (x) => x.id).map((x) => x.id), ['a', 'b', 'c']);
  assert.deepStrictEqual(L.reorderById(list, ['b', 'b', 'a'], (x) => x.id).map((x) => x.id), ['b', 'a', 'c']);
  const dup = [{ id: 'a', n: 1 }, { id: 'a', n: 2 }, { id: 'b', n: 3 }];
  const out = L.reorderById(dup, ['b'], (x) => x.id);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((x) => x.n), [3, 1, 2]);
  assert.deepStrictEqual(L.reorderById(null, ['a'], (x) => x.id), []);
});

/* ---------- ripetizioni per serie, tipi di serie, RPE, note ---------- */
t('le schede vecchie restano identiche e i campi nuovi compaiono solo quando servono', () => {
  const day = { id: 'd', name: 'A', exercises: [
    { id: 'old', name: 'Panca', setCount: 3, reps: 8, kg: 50 },
    { id: 'uni', name: 'Curl', setCount: 3, reps: 8, kg: 10, setReps: [12, 12, 12], setTypes: ['normal', 'normal', 'normal'], note: '   ' },
    { id: 'var', name: 'Squat', setCount: 3, reps: 12, kg: 60, setReps: [12, 10, 8], setTypes: ['warmup', 'sbagliato'], note: '  sedile 4  ' }
  ] };
  const ex = L.normalizeProgram({ days: [day] }).days[0].exercises;
  assert.deepStrictEqual(ex[0], { id: 'old', name: 'Panca', setCount: 3, reps: 8, kg: 50 });
  assert.deepStrictEqual(ex[1], { id: 'uni', name: 'Curl', setCount: 3, reps: 12, kg: 10 });
  assert.deepStrictEqual(ex[2].setReps, [12, 10, 8]);
  assert.deepStrictEqual(ex[2].setTypes, ['warmup', 'normal', 'normal']);
  assert.strictEqual(ex[2].note, 'sedile 4');
});
t('repsFor e repsSummary: valore unico oppure una cifra per serie', () => {
  assert.strictEqual(L.repsSummary({ setCount: 3, reps: 10 }), '3 × 10');
  assert.strictEqual(L.repsSummary({ setCount: 3, reps: 12, setReps: [12, 10, 8] }), '12 · 10 · 8');
  assert.strictEqual(L.repsFor({ setCount: 3, reps: 9, setReps: [12, 'x'] }, 1), 9);
  assert.strictEqual(L.repsFor({ setCount: 3, reps: 9 }, 2), 9);
  assert.strictEqual(L.repsFor({ setCount: 3, reps: 9, setReps: [12, 500, 0] }, 1), 9);
});
t('la sessione parte con le ripetizioni e il tipo di ogni serie (le normali non hanno «type»)', () => {
  const day = { id: 'd', name: 'Gambe', exercises: [{ id: 'sq', name: 'Squat', setCount: 3, reps: 12, kg: 60, setReps: [12, 10, 8], setTypes: ['warmup', 'normal', 'drop'] }] };
  const sets = L.makeSession(day, 's', 1).exercises[0].sets;
  assert.deepStrictEqual(sets, [
    { reps: 12, kg: 60, done: false, type: 'warmup' },
    { reps: 10, kg: 60, done: false },
    { reps: 8, kg: 60, done: false, type: 'drop' }
  ]);
});
t('il riscaldamento si conta tra le serie fatte ma non nel volume né nello storico dell’esercizio', () => {
  const ses = { id: 'a', completedAt: 5, exercises: [{ exerciseId: 'x', sets: [
    { reps: 10, kg: 20, done: true, type: 'warmup' }, { reps: 8, kg: 60, done: true }, { reps: 6, kg: 55, done: true, type: 'drop' }] }] };
  assert.deepStrictEqual(L.sessionStats(ses), { totalSets: 3, completedSets: 3, volume: 8 * 60 + 6 * 55 });
  assert.deepStrictEqual(L.exerciseHistory({ sessions: [ses] }, 'x'), [{ t: 5, kg: 60, reps: 8 }]);
  const solo = { id: 'b', completedAt: 6, exercises: [{ exerciseId: 'x', sets: [{ reps: 10, kg: 20, done: true, type: 'warmup' }] }] };
  assert.deepStrictEqual(L.exerciseHistory({ sessions: [solo] }, 'x'), []);
});
t('RPE: da 1 a 10, passi di 0,5, vuoto o fuori scala = nessun valore', () => {
  assert.strictEqual(L.cleanRpe('8'), 8);
  assert.strictEqual(L.cleanRpe('8,5'), 8.5);
  assert.strictEqual(L.cleanRpe(8.3), 8.5);
  for (const bad of ['', null, undefined, '0', '11', 'abc', '-3']) assert.strictEqual(L.cleanRpe(bad), null, String(bad));
});
t('le note vengono ripulite e limitate in lunghezza', () => {
  assert.strictEqual(L.cleanNote('  ciao\r\n mondo  ', 300), 'ciao\n mondo');
  assert.strictEqual(L.cleanNote('x'.repeat(900), 500).length, 500);
  assert.strictEqual(L.cleanNote(null), '');
});

/* ---------- costanza: settimane di fila, giorni, calendario ---------- */
const at = (y, m, d, h) => new Date(y, m - 1, d, h == null ? 12 : h).getTime();
const done = (...times) => times.map((tm, i) => ({ id: 's' + i, completedAt: tm, exercises: [] }));
t('serie di settimane: conta quelle consecutive e la settimana in corso non la spezza', () => {
  const now = at(2026, 11, 19); // giovedì
  assert.strictEqual(L.weekStreak(done(at(2026, 11, 17), at(2026, 11, 10), at(2026, 11, 3), at(2026, 10, 20)), now), 3);
  assert.strictEqual(L.weekStreak(done(at(2026, 11, 10), at(2026, 11, 3)), now), 2, 'questa settimana è ancora vuota ma la serie vive');
  assert.strictEqual(L.weekStreak(done(at(2026, 11, 3)), now), 0, 'una settimana intera saltata spezza la serie');
  assert.strictEqual(L.weekStreak([], now), 0);
  assert.strictEqual(L.weekStreak(done(at(2026, 11, 16, 0), at(2026, 11, 15, 23)), now), 2, 'lunedì 00:00 è nella settimana in corso, domenica sera in quella prima');
  assert.strictEqual(L.weekStreak(done(at(2026, 11, 17), at(2026, 11, 18), at(2026, 11, 19)), now), 1, 'più sessioni nella stessa settimana valgono una settimana');
});
t('la serie di settimane regge il cambio ora legale', () => {
  const now = at(2026, 11, 2); // lunedì dopo il passaggio all’ora solare (25 ottobre)
  assert.strictEqual(L.weekStreak(done(at(2026, 10, 28), at(2026, 10, 21), at(2026, 10, 14), at(2026, 10, 7)), now), 4);
});
t('i sette giorni della settimana: allenati e oggi', () => {
  const dots = L.weekDots(done(at(2026, 11, 16), at(2026, 11, 18), at(2026, 11, 15)), at(2026, 11, 18));
  assert.deepStrictEqual(dots.map((d) => d.letter), ['L', 'M', 'M', 'G', 'V', 'S', 'D']);
  assert.deepStrictEqual(dots.map((d) => d.done), [true, false, true, false, false, false, false]);
  assert.deepStrictEqual(dots.map((d) => d.today), [false, false, true, false, false, false, false]);
  assert.strictEqual(dots[0].key, '2026-11-16');
});
t('calendario del mese: lunedì per primo, giorni vuoti iniziali e conteggio sessioni', () => {
  const cells = L.monthGrid(2026, 10, done(at(2026, 11, 3, 8), at(2026, 11, 3, 19), at(2026, 11, 30)));
  assert.strictEqual(cells.filter((c) => c === null).length, 6, '1 novembre 2026 è domenica');
  assert.strictEqual(cells.filter(Boolean).length, 30);
  assert.strictEqual(cells.find((c) => c && c.day === 3).count, 2);
  assert.strictEqual(cells.find((c) => c && c.day === 30).count, 1);
  assert.strictEqual(cells.find((c) => c && c.day === 4).count, 0);
  assert.strictEqual(L.monthGrid(2027, 1, []).filter(Boolean).length, 28);
});

/* ---------- peso corporeo ---------- */
t('peso corporeo: valori validi, una misura al giorno, ordinate nel tempo', () => {
  assert.strictEqual(L.bodyWeight('78,46'), 78.5);
  assert.strictEqual(L.bodyWeight(' 80 '), 80);
  for (const bad of ['', 'abc', '5', '19.9', '401', null]) assert.strictEqual(L.bodyWeight(bad), null, String(bad));
  let list = L.upsertBodyWeight([], at(2026, 11, 10), 80);
  list = L.upsertBodyWeight(list, at(2026, 11, 5), 81);
  list = L.upsertBodyWeight(list, at(2026, 11, 10, 20), 79.5);
  assert.deepStrictEqual(list.map((w) => w.kg), [81, 79.5]);
  assert.ok(list[0].t < list[1].t);
});
t('data scelta nel modulo: mezzogiorno locale, date impossibili rifiutate', () => {
  assert.strictEqual(L.dateInputToTime('2026-11-19'), at(2026, 11, 19, 12));
  assert.strictEqual(L.dateInputToTime('2026-02-31'), null);
  assert.strictEqual(L.dateInputToTime('19/11/2026'), null);
  assert.strictEqual(L.dateInputToTime(''), null);
});
t('i dati del peso e del promemoria sono ripuliti quando si carica la scheda', () => {
  const p = L.normalizeProgram({ bodyWeights: [{ t: 3, kg: 80 }, { t: 1, kg: 82 }, { t: 2, kg: 'x' }, null, { t: 0, kg: 70 }, { kg: 70 }], reminder: { enabled: true, time: '25:99' } });
  assert.deepStrictEqual(p.bodyWeights, [{ t: 1, kg: 82 }, { t: 3, kg: 80 }]);
  assert.deepStrictEqual(p.reminder, { enabled: true, time: '18:00' });
  assert.deepStrictEqual(L.normalizeProgram({ reminder: { enabled: 'sì', time: '07:30' } }).reminder, { enabled: false, time: '07:30' });
  assert.deepStrictEqual(L.normalizeProgram({}).bodyWeights, []);
});

/* ---------- promemoria ---------- */
t('promemoria: un avviso a settimana per ogni giorno assegnato, con la numerazione di Capacitor', () => {
  const plan = L.reminderPlan({ days: [
    { name: 'Petto', weekday: 'Lunedì' }, { name: 'Gambe', weekday: 'Mercoledì' }, { name: 'Spalle', weekday: 'Lunedì' },
    { name: 'Libera', weekday: '' }, { name: 'Corsa', weekday: 'Domenica' }, { name: 'Core', weekday: 'Sabato' }] });
  assert.deepStrictEqual(plan.map((x) => [x.weekday, x.id, x.names.join('+')]), [
    [2, 7200, 'Petto+Spalle'], [4, 7202, 'Gambe'], [7, 7205, 'Core'], [1, 7206, 'Corsa']]);
  assert.deepStrictEqual(L.reminderPlan({ days: [{ name: 'x', weekday: '' }] }), []);
  assert.deepStrictEqual(L.reminderPlan(null), []);
  assert.deepStrictEqual(L.parseTime('07:30'), { hour: 7, minute: 30 });
  for (const bad of ['7:30', '24:00', '12:60', '', null]) assert.strictEqual(L.parseTime(bad), null, String(bad));
});

/* ---------- gruppi, massimale, riscaldamento, confronto, backup ---------- */
t('il gruppo muscolare accetta solo valori noti e senza gruppo cade in Altro', () => {
  assert.strictEqual(L.cleanGroup('Dorso'), 'Dorso');
  assert.strictEqual(L.cleanGroup('Braccia'), null);
  assert.strictEqual(L.groupOf({ group: 'Gambe' }), 'Gambe');
  assert.strictEqual(L.groupOf({}), 'Altro');
  const p = L.normalizeProgram({ days: [{ id: 'a', exercises: [{ id: 'x', name: 'Curl', group: 'Bicipiti' }, { id: 'y', name: 'Vago', group: 'Boh' }] }] });
  assert.strictEqual(p.days[0].exercises[0].group, 'Bicipiti');
  assert.strictEqual(p.days[0].exercises[1].group, undefined);
});
t('il volume settimanale conta le serie di lavoro per gruppo, senza riscaldamento né sessioni vecchie', () => {
  const now = 20 * 864e5;
  const sessions = [
    { id: 'a', completedAt: now - 1000, exercises: [
      { exerciseId: 'p', group: 'Petto', sets: [{ reps: 8, kg: 50, done: true }, { reps: 8, kg: 20, done: true, type: 'warmup' }, { reps: 8, kg: 50, done: false }] },
      { exerciseId: 'q', sets: [{ reps: 10, kg: 10, done: true }] }] },
    { id: 'b', completedAt: now - 9 * 864e5, exercises: [{ exerciseId: 'p', group: 'Petto', sets: [{ reps: 5, kg: 100, done: true }] }] }
  ];
  assert.deepStrictEqual(L.weeklyGroupVolume(sessions, now), [
    { group: 'Petto', sets: 1, volume: 400 }, { group: 'Altro', sets: 1, volume: 100 }
  ]);
});
t('la stima del massimale usa Epley e non stima oltre 12 ripetizioni', () => {
  assert.strictEqual(L.estimateOneRm(100, 1), 100);
  assert.strictEqual(L.estimateOneRm(100, 10), 133.3);
  assert.strictEqual(L.estimateOneRm(100, 13), null);
  assert.strictEqual(L.estimateOneRm(0, 5), null);
  assert.deepStrictEqual(L.bestOneRm([{ t: 1, kg: 80, reps: 5 }, { t: 2, kg: 90, reps: 3 }, { t: 3, kg: 60, reps: 20 }]),
    { value: 99, t: 2, kg: 90, reps: 3 });
  assert.strictEqual(L.bestOneRm([]), null);
});
t('il riscaldamento suggerito parte da 20 kg, arrotonda a 2,5 kg e non supera il carico', () => {
  assert.deepStrictEqual(L.warmupPlan(100, 6), [{ kg: 50, reps: 6 }, { kg: 70, reps: 5 }, { kg: 85, reps: 3 }]);
  assert.deepStrictEqual(L.warmupPlan(20, 10), [{ kg: 10, reps: 8 }, { kg: 15, reps: 5 }, { kg: 17.5, reps: 3 }]);
  assert.deepStrictEqual(L.warmupPlan(15, 10), []);
  assert.deepStrictEqual(L.warmupPlan(null, 10), []);
});
t('il confronto tra sessioni mostra la differenza di volume e del carico massimo per esercizio', () => {
  const prev = { id: 'p', dayId: 'd', completedAt: 1000, exercises: [
    { exerciseId: 'x', name: 'Panca', sets: [{ reps: 8, kg: 60, done: true }, { reps: 8, kg: 60, done: true }] }] };
  const curr = { id: 'c', dayId: 'd', completedAt: 2000, exercises: [
    { exerciseId: 'x', name: 'Panca', sets: [{ reps: 8, kg: 65, done: true }, { reps: 6, kg: 65, done: true }] },
    { exerciseId: 'y', name: 'Croci', sets: [{ reps: 10, kg: 10, done: true }] }] };
  const c = L.compareSessions(prev, curr);
  assert.strictEqual(c.delta, 50);
  assert.strictEqual(c.pct, 5);
  assert.deepStrictEqual(c.exercises, [{ name: 'Panca', kg: 65, prevKg: 60, delta: 5 }]);
});
t('la sessione precedente è la più recente dello stesso giorno', () => {
  const list = [
    { id: 'a', dayId: 'd', completedAt: 100 }, { id: 'b', dayId: 'd', completedAt: 300 },
    { id: 'c', dayId: 'altro', completedAt: 250 }, { id: 'e', dayId: 'd', completedAt: 500 }];
  assert.strictEqual(L.previousSession(list, list[3]).id, 'b');
  assert.strictEqual(L.previousSession(list, list[0]), null);
});
t('il backup esportato si legge di nuovo e rifiuta i file non validi', () => {
  const prog = { days: [{ id: 'd', name: 'Petto', exercises: [{ id: 'x', name: 'Panca', setCount: 3, reps: 8, kg: 50, group: 'Petto' }] }],
    sessions: [{ id: 's', dayId: 'd', completedAt: 5, exercises: [] }] };
  const text = JSON.stringify(L.makeBackup(prog, 0));
  const back = L.parseBackup(text);
  assert.strictEqual(back.days[0].exercises[0].group, 'Petto');
  assert.strictEqual(back.sessions.length, 1);
  assert.throws(() => L.parseBackup('non json'), /non è un backup valido/);
  assert.throws(() => L.parseBackup(JSON.stringify({ app: 'altra', version: 1, program: {} })), /non è un backup di Allenamenti/);
  assert.throws(() => L.parseBackup(JSON.stringify({ app: 'mie-note-allenamenti', version: 9, program: {} })), /Versione/);
  assert.throws(() => L.parseBackup(JSON.stringify({ app: 'mie-note-allenamenti', version: 1, program: {} })), /vuoto/);
});

/* ---------- progressione, sostituzioni, volume settimanale, riepilogo mensile ---------- */
const ex8 = (extra) => Object.assign({ id: 'x', name: 'Panca', setCount: 3, reps: 8, kg: 50 }, extra || {});
const entryOf = (reps, kg, extra) => ({ exerciseId: 'x', name: 'Panca', sets: reps.map((r) => Object.assign({ reps: r, kg, done: true }, extra || {})) });
const prog = (entries) => ({ sessions: entries.map((e, i) => ({ id: 's' + i, dayId: 'd', completedAt: 1000 * (i + 1), exercises: [e] })) });
t('progressione: 7–11 rip. propone una ripetizione in più per serie, solo dopo due sessioni riuscite', () => {
  const ok = entryOf([8, 8, 8], 50);
  assert.strictEqual(L.progressionSuggestion(prog([ok]), ex8()), null);
  const sug = L.progressionSuggestion(prog([ok, entryOf([9, 8, 8], 50)]), ex8());
  assert.strictEqual(sug.mode, 'reps');
  assert.deepStrictEqual(sug.setReps, [9, 9, 9]);
  assert.strictEqual(sug.kg, 50);
});
t('progressione: nessun suggerimento se manca una serie, un carico o l’RPE è troppo alto', () => {
  const ok = entryOf([8, 8, 8], 50);
  assert.strictEqual(L.progressionSuggestion(prog([ok, entryOf([8, 8, 7], 50)]), ex8()), null);
  assert.strictEqual(L.progressionSuggestion(prog([ok, entryOf([8, 8, 8], 47.5)]), ex8()), null);
  assert.strictEqual(L.progressionSuggestion(prog([ok, entryOf([8, 8, 8], 50, { rpe: 9.5 })]), ex8()), null);
  const undone = entryOf([8, 8, 8], 50); undone.sets[2].done = false;
  assert.strictEqual(L.progressionSuggestion(prog([ok, undone]), ex8()), null);
});
t('progressione: con tutte le serie a 12 si sale di carico e le ripetizioni scendono', () => {
  const t12 = L.nextTarget(ex8({ reps: 12 }));
  assert.deepStrictEqual([t12.mode, t12.kg, t12.setReps], ['weight', 52.5, [8, 8, 8]]);
  assert.strictEqual(L.nextTarget(ex8({ reps: 12, kg: 10 })).kg, 11);
});
t('progressione: fino a 6 ripetizioni si aumenta solo il carico', () => {
  const t5 = L.nextTarget(ex8({ reps: 5 }));
  assert.deepStrictEqual([t5.mode, t5.kg, t5.setReps], ['weight', 52.5, [5, 5, 5]]);
});
t('progressione: serie diverse crescono solo sotto il tetto; a corpo libero si aggiungono ripetizioni', () => {
  assert.deepStrictEqual(L.nextTarget(ex8({ setReps: [12, 10, 8], reps: 12 })).setReps, [12, 11, 9]);
  const body = L.nextTarget(ex8({ kg: 0, reps: 15 }));
  assert.deepStrictEqual([body.mode, body.kg, body.setReps], ['reps', 0, [16, 16, 16]]);
  assert.strictEqual(L.nextTarget(ex8({ kg: 0, reps: 30 })), null);
});
t('progressione: riscaldamento e cedimenti non contano, e le sostituzioni di un giorno vengono ignorate', () => {
  const e = ex8({ setTypes: ['warmup', 'normal', 'normal'], setReps: [10, 8, 8] });
  const sess = { exerciseId: 'x', name: 'Panca', sets: [{ reps: 5, kg: 20, done: true, type: 'warmup' }, { reps: 8, kg: 50, done: true }, { reps: 8, kg: 50, done: true }] };
  assert.strictEqual(L.sessionMeetsTarget(sess, e), true);
  assert.deepStrictEqual(L.nextTarget(e).setReps, [10, 9, 9]);
  const swapped = Object.assign(entryOf([8, 8, 8], 50), { substitute: true });
  assert.strictEqual(L.progressionSuggestion(prog([entryOf([8, 8, 8], 50), swapped]), ex8()), null);
});
t('applyTarget e retargetSession aggiornano obiettivo e solo le serie normali non ancora fatte', () => {
  const e = ex8({ setReps: [8, 8, 6] });
  L.applyTarget(e, 52.5, [9, 9, 9]);
  assert.deepStrictEqual([e.kg, e.reps, e.setReps], [52.5, 9, undefined]);
  const entry = { sets: [{ reps: 5, kg: 20, done: false, type: 'warmup' }, { reps: 8, kg: 50, done: true }, { reps: 8, kg: 50, done: false }, { reps: 8, kg: 50, done: false }] };
  L.retargetSession(entry, e);
  assert.deepStrictEqual(entry.sets.map((x) => [x.reps, x.kg]), [[5, 20], [8, 50], [9, 52.5], [9, 52.5]]);
});
t('il catalogo riconosce gli esercizi anche con nomi diversi', () => {
  assert.strictEqual(L.findCatalog('Panca Piana').name, 'Panca piana');
  assert.strictEqual(L.findCatalog('lento avanti').name, 'Military press');
  assert.strictEqual(L.findCatalog('Panca piana manubri 30°').name, 'Panca piana manubri');
  assert.strictEqual(L.findCatalog('Esercizio inventato'), null);
  assert.strictEqual(L.CATALOG.length, new Set(L.CATALOG.map((c) => c.name)).size);
});
t('le sostituzioni propongono prima lo stesso movimento con un altro attrezzo e saltano quelli già nella giornata', () => {
  const day = [{ name: 'Panca piana' }, { name: 'Croci ai cavi' }];
  const r = L.substituteSuggestions({ name: 'Panca piana' }, day, '');
  assert.strictEqual(r.group, 'Petto');
  assert.strictEqual(r.items[0].samePattern, true);
  assert.notStrictEqual(r.items[0].equipment, 'bilanciere');
  assert.ok(!r.items.some((i) => i.name === 'Panca piana' || i.name === 'Croci ai cavi'));
  assert.ok(r.items.length <= 6);
  const noGroup = L.substituteSuggestions({ name: 'Esercizio inventato' }, [], '');
  assert.deepStrictEqual(noGroup, { group: null, items: [] });
  assert.ok(L.substituteSuggestions({ name: 'Esercizio inventato' }, [], 'Spalle').items.length > 0);
});
t('il carico di partenza della sostituzione è prudente', () => {
  assert.strictEqual(L.substituteKg(60, 'bilanciere', 'manubri'), 25);
  assert.strictEqual(L.substituteKg(20, 'manubri', 'bilanciere'), 40);
  assert.strictEqual(L.substituteKg(50, 'macchina', 'macchina'), 35);
  assert.strictEqual(L.substituteKg(50, 'bilanciere', 'corpo libero'), 0);
  assert.strictEqual(L.substituteKg(0, 'bilanciere', 'manubri'), 0);
  const sub = L.makeSubstitute({ id: 'a', name: 'Panca piana', setCount: 4, reps: 8, kg: 60, note: 'vecchia', setReps: [10, 8, 8, 6] }, { name: 'Chest press', group: 'Petto', equipment: 'macchina' }, 'nuovo');
  assert.deepStrictEqual([sub.id, sub.name, sub.group, sub.setCount, sub.kg, sub.note], ['nuovo', 'Chest press', 'Petto', 4, 42.5, undefined]);
  assert.deepStrictEqual(sub.setReps, [10, 8, 8, 6]);
});
t('lo storico, i progressi e il confronto ignorano le sostituzioni «solo oggi»', () => {
  const real = { id: 's1', dayId: 'd', completedAt: 100, exercises: [{ exerciseId: 'x', name: 'Panca', sets: [{ reps: 8, kg: 50, done: true }] }] };
  const swapped = { id: 's2', dayId: 'd', completedAt: 200, exercises: [{ exerciseId: 'x', name: 'Chest press', substitute: true, sets: [{ reps: 8, kg: 30, done: true }] }] };
  assert.strictEqual(L.exerciseHistory({ sessions: [real, swapped] }, 'x').length, 1);
  assert.deepStrictEqual(L.compareSessions(real, swapped).exercises, []);
});
t('il volume settimanale è una serie di settimane da lunedì, con quella in corso per ultima', () => {
  const mon = (y, m, d, h) => new Date(y, m, d, h || 12).getTime();
  const now = mon(2026, 10, 20);                       // venerdì 20 novembre 2026
  const mk = (id, t, kg) => ({ id, dayId: 'd', completedAt: t, exercises: [{ exerciseId: 'x', sets: [{ reps: 10, kg, done: true }] }] });
  const series = L.weeklyVolumeSeries([mk('a', mon(2026, 10, 16), 50), mk('b', mon(2026, 10, 15, 23), 10), mk('c', mon(2026, 10, 2), 20), mk('d', mon(2026, 8, 1), 99), mk('e', now + 9 * 864e5, 70)], now, 8);
  assert.strictEqual(series.length, 8);
  assert.strictEqual(new Date(series[7].start).getDay(), 1);
  assert.deepStrictEqual([series[7].volume, series[7].sessions], [500, 1]);   // lunedì 16
  assert.deepStrictEqual([series[6].volume, series[6].sessions], [100, 1]);   // domenica 15 sera
  assert.deepStrictEqual([series[5].volume, series[5].sessions], [200, 1]);   // 2 novembre
  assert.strictEqual(series.reduce((n, w) => n + w.sessions, 0), 3);          // fuori finestra e futuro esclusi
});
t('il riepilogo mensile somma sessioni, volume, giorni, gruppi e confronta con il mese prima', () => {
  const at = (m, d) => new Date(2026, m, d, 12).getTime();
  const sess = (id, t, name, kg, group, exId) => ({ id, dayId: name, dayName: name, completedAt: t, exercises: [{ exerciseId: exId || 'x', name: 'Panca', group, sets: [{ reps: 10, kg, done: true }, { reps: 10, kg, done: true }] }] });
  const program = { sessions: [sess('o', at(9, 20), 'Petto', 40, 'Petto'), sess('a', at(10, 3), 'Petto', 50, 'Petto'), sess('b', at(10, 10), 'Petto', 55, 'Petto'), sess('c', at(10, 12), 'Gambe', 80, 'Gambe', 'y')] };
  const m = L.monthlySummary(program, 2026, 10);
  assert.deepStrictEqual([m.sessions, m.sets, m.volume, m.activeDays], [3, 6, 3700, 3]);
  assert.deepStrictEqual(m.topDays, [{ name: 'Petto', count: 2 }, { name: 'Gambe', count: 1 }]);
  assert.deepStrictEqual(m.groups.map((g) => [g.group, g.sets]), [['Petto', 4], ['Gambe', 2]]);
  assert.deepStrictEqual([m.prevSessions, m.prevVolume, m.volumePct], [1, 800, 363]);
  assert.strictEqual(L.monthlySummary(program, 2026, 5).sessions, 0);
});
t('il miglior progresso del mese confronta con il valore migliore precedente, o con la prima sessione del mese', () => {
  const at = (m, d) => new Date(2026, m, d, 12).getTime();
  const sess = (id, t, exId, name, reps, kg) => ({ id, completedAt: t, exercises: [{ exerciseId: exId, name, sets: [{ reps, kg, done: true }] }] });
  const sessions = [sess('1', at(9, 5), 'p', 'Panca', 5, 80), sess('2', at(10, 4), 'p', 'Panca', 5, 90), sess('3', at(10, 6), 's', 'Squat', 5, 100), sess('4', at(10, 20), 's', 'Squat', 5, 105), sess('5', at(10, 9), 'z', 'Curl', 10, 20)];
  const best = L.bestProgress(sessions, new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime());
  assert.strictEqual(best.name, 'Panca');
  assert.deepStrictEqual([best.from, best.to, best.pct, best.unit], [93.3, 105, 13, 'kg']);
  assert.strictEqual(L.bestProgress([sess('5', at(10, 9), 'z', 'Curl', 10, 20)], new Date(2026, 10, 1).getTime(), new Date(2026, 11, 1).getTime()), null);
});

console.log('\n' + n + ' test Allenamenti superati');
