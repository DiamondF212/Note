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

/* ---------- riscaldamento articolare, confronto tra periodi, tabella delle serie ---------- */
const dayWith = (...exs) => ({ id: 'd', name: 'G', exercises: exs.map((e, i) => Object.assign({ id: 'e' + i, setCount: 3, reps: 8, kg: 20 }, e)) });
t('il riscaldamento articolare sceglie i movimenti per i gruppi della giornata, dall’alto in basso', () => {
  const legs = L.mobilityPlan(dayWith({ name: 'Squat', group: 'Gambe' }));
  assert.ok(legs.length >= 4 && legs.length <= 6);
  const ids = legs.map((m) => m.id);
  ['anche', 'squat-libero', 'caviglie'].forEach((id) => assert.ok(ids.includes(id), id));
  assert.ok(!ids.includes('collo') && !ids.includes('polsi'));
  const order = L.MOBILITY.map((m) => m.id);
  assert.deepStrictEqual(ids, order.filter((id) => ids.includes(id)), 'ordine del catalogo');
  const upper = L.mobilityPlan(dayWith({ name: 'Panca', group: 'Petto' }, { name: 'Curl', group: 'Bicipiti' })).map((m) => m.id);
  assert.ok(upper.includes('cerchi-braccia') && upper.includes('polsi'));
});
t('il riscaldamento articolare usa il catalogo se manca il gruppo e una sequenza generale se non c’è nulla da riconoscere', () => {
  const byName = L.mobilityPlan(dayWith({ name: 'Leg press' })).map((m) => m.id);
  assert.ok(byName.includes('anche'));
  assert.deepStrictEqual(L.mobilityPlan(dayWith({ name: 'Esercizio inventato' })).map((m) => m.id), ['cerchi-braccia', 'gatto-cammello', 'busto', 'anche', 'squat-libero']);
  assert.strictEqual(L.mobilityPlan({ exercises: [] }).length, 5);
});
t('le spunte del riscaldamento articolare valgono un giorno solo', () => {
  const day = dayWith({ name: 'Squat', group: 'Gambe' });
  const mon = new Date(2026, 10, 16, 10).getTime(), tue = new Date(2026, 10, 17, 10).getTime();
  assert.deepStrictEqual(L.mobilityDone(day, mon), []);
  assert.strictEqual(L.toggleMobility(day, 'anche', mon), true);
  L.toggleMobility(day, 'caviglie', mon);
  assert.deepStrictEqual(L.mobilityDone(day, mon).sort(), ['anche', 'caviglie']);
  assert.deepStrictEqual(day.mobility.date, '2026-11-16');
  assert.strictEqual(L.toggleMobility(day, 'anche', mon), false);
  assert.deepStrictEqual(L.mobilityDone(day, mon), ['caviglie']);
  assert.deepStrictEqual(L.mobilityDone(day, tue), [], 'il giorno dopo riparte vuoto');
  assert.deepStrictEqual(L.mobilityProgress(day, mon), { done: 1, total: L.mobilityPlan(day).length });
  L.setAllMobility(day, L.mobilityPlan(day).map((m) => m.id), true, mon);
  assert.strictEqual(L.mobilityProgress(day, mon).done, L.mobilityProgress(day, mon).total);
  L.setAllMobility(day, [], false, mon);
  assert.deepStrictEqual(L.mobilityDone(day, mon), []);
});
t('il riscaldamento articolare si conserva nella scheda e nel backup, scartando i dati non validi', () => {
  const prog = { days: [
    { id: 'a', name: 'A', exercises: [], mobility: { date: '2026-11-16', done: ['anche', 'anche', 'inventato', 5] } },
    { id: 'b', name: 'B', exercises: [] },
    { id: 'c', name: 'C', exercises: [], mobility: { date: 'ieri', done: ['anche'] } }] };
  const back = L.parseBackup(JSON.stringify(L.makeBackup(prog, 0)));
  assert.deepStrictEqual(back.days[0].mobility, { date: '2026-11-16', done: ['anche'] });
  assert.ok(!('mobility' in back.days[1]), 'senza spunte il campo non compare');
  assert.ok(!('mobility' in back.days[2]));
});
t('un periodo va da un giorno all’altro, compresi, e le date sbagliate si rifiutano', () => {
  const r = L.periodRange('2026-11-01', '2026-11-30');
  assert.strictEqual(r.days, 30);
  assert.strictEqual(r.from, new Date(2026, 10, 1).getTime());
  assert.strictEqual(r.to, new Date(2026, 11, 1).getTime());
  assert.strictEqual(L.periodRange('2026-11-05', '2026-11-05').days, 1);
  assert.strictEqual(L.periodRange('2026-11-10', '2026-11-09'), null);
  assert.strictEqual(L.periodRange('2026-02-30', '2026-03-05'), null);
  assert.strictEqual(L.periodRange('', '2026-03-05'), null);
});
const mkPeriodProgram = () => {
  const at = (m, d, h) => new Date(2026, m, d, h || 12).getTime();
  const s = (id, t, name, entries) => ({ id, dayId: 'd', dayName: name, completedAt: t, exercises: entries });
  const ex = (id, name, group, reps, kg, n) => ({ exerciseId: id, name, group, sets: Array.from({ length: n || 2 }, () => ({ reps, kg, done: true })) });
  return { sessions: [
    s('a1', at(9, 10), 'Petto', [ex('p', 'Panca', 'Petto', 10, 40), ex('c', 'Curl', 'Bicipiti', 10, 10)]),
    s('a2', at(9, 20), 'Gambe', [ex('q', 'Squat', 'Gambe', 8, 60)]),
    s('b1', at(10, 5), 'Petto', [ex('p', 'Panca', 'Petto', 10, 50, 3), ex('c', 'Curl', 'Bicipiti', 10, 10)]),
    s('b2', at(10, 12), 'Petto', [ex('p', 'Panca', 'Petto', 10, 55, 3)]),
    s('b3', at(10, 19, 23), 'Gambe', [ex('q', 'Squat', 'Gambe', 8, 60)])] };
};
t('le statistiche di un periodo contano sessioni, serie, volume, giorni e frequenza', () => {
  const r = L.periodRange('2026-11-01', '2026-11-28');
  const st = L.periodStats(mkPeriodProgram(), r);
  assert.deepStrictEqual([st.sessions, st.sets, st.volume, st.activeDays], [3, 10, 1700 + 1650 + 960, 3]);
  assert.deepStrictEqual([st.avgVolume, st.perWeek, st.days], [1437, 0.8, 28]);
  assert.deepStrictEqual(L.periodStats(mkPeriodProgram(), L.periodRange('2026-01-01', '2026-01-31')).sessions, 0);
});
t('il confronto tra due periodi mostra differenze, gruppi ed esercizi in comune', () => {
  const prog = mkPeriodProgram();
  const c = L.comparePeriods(prog, L.periodRange('2026-10-01', '2026-10-31'), L.periodRange('2026-11-01', '2026-11-30'));
  assert.deepStrictEqual([c.a.sessions, c.b.sessions], [2, 3]);
  assert.deepStrictEqual(c.deltas.sessions, { diff: 1, pct: 50 });
  assert.strictEqual(c.deltas.volume.diff, 4310 - (800 + 200 + 960));
  const petto = c.groups.find((g) => g.group === 'Petto');
  assert.deepStrictEqual([petto.a, petto.b], [2, 6]);
  assert.deepStrictEqual(c.groups.map((g) => g.group), ['Petto', 'Bicipiti', 'Gambe']);
  assert.deepStrictEqual(c.exercises.map((e) => e.name), ['Panca', 'Curl', 'Squat']);
  assert.deepStrictEqual([c.exercises[0].unit, c.exercises[0].pct, c.exercises[2].diff], ['kg', 38, 0]);
  const vuoto = L.comparePeriods(prog, L.periodRange('2026-01-01', '2026-01-31'), L.periodRange('2026-11-01', '2026-11-30'));
  assert.deepStrictEqual([vuoto.a.sessions, vuoto.deltas.sessions.pct, vuoto.exercises.length], [0, null, 0]);
});
t('la tabella delle serie elenca ogni serie completata e il riscaldamento solo se richiesto', () => {
  const prog = { sessions: [
    { id: 's1', completedAt: 100, exercises: [{ exerciseId: 'x', name: 'Panca', sets: [{ reps: 5, kg: 20, done: true, type: 'warmup' }, { reps: 8, kg: 50, done: true }, { reps: 7, kg: 50, done: false }] }] },
    { id: 's2', completedAt: 200, exercises: [{ exerciseId: 'x', name: 'Panca', sets: [{ reps: 8, kg: 52.5, done: true }, { reps: 6, kg: 52.5, done: true, type: 'drop' }] }, { exerciseId: 'y', sets: [{ reps: 1, kg: 1, done: true }] }] },
    { id: 's3', completedAt: 300, exercises: [{ exerciseId: 'x', name: 'Chest press', substitute: true, sets: [{ reps: 10, kg: 30, done: true }] }] }] };
  const rows = L.exerciseSets(prog, 'x', false);
  assert.deepStrictEqual(rows.map((r) => [r.t, r.n, r.kg, r.reps, r.volume, r.type]), [[100, 2, 50, 8, 400, 'normal'], [200, 1, 52.5, 8, 420, 'normal'], [200, 2, 52.5, 6, 315, 'drop']]);
  assert.strictEqual(L.exerciseSets(prog, 'x', true).length, 4);
});
t('la tabella delle serie si ordina per ogni colonna, con ordine stabile a parità', () => {
  const rows = [{ t: 100, n: 1, kg: 50, reps: 8, volume: 400 }, { t: 200, n: 1, kg: 52.5, reps: 8, volume: 420 }, { t: 200, n: 2, kg: 52.5, reps: 6, volume: 315 }, { t: 300, n: 1, kg: 50, reps: 10, volume: 500 }];
  const ts = (key, dir) => L.sortSets(rows, key, dir).map((r) => r.t + '.' + r.n).join(' ');
  assert.strictEqual(ts('t', 'desc'), '300.1 200.1 200.2 100.1');
  assert.strictEqual(ts('t', 'asc'), '100.1 200.1 200.2 300.1');
  assert.strictEqual(ts('kg', 'desc'), '200.1 200.2 300.1 100.1');
  assert.strictEqual(ts('reps', 'asc'), '200.2 200.1 100.1 300.1');
  assert.strictEqual(ts('volume', 'desc'), '300.1 200.1 100.1 200.2');
  assert.strictEqual(ts('n', 'asc'), '300.1 200.1 100.1 200.2');
  assert.strictEqual(ts('inventata', 'desc'), '300.1 200.1 200.2 100.1');
  assert.strictEqual(rows[0].t, 100, 'non modifica l’elenco originale');
});

/* ---------- esercizi a tempo (dead hang, plank…) ---------- */
t('un esercizio a tempo conserva l’unità e i secondi, e quelli a ripetizioni restano identici', () => {
  const a = L.normalizeProgram({ days: [{ id: 'd', name: 'G', exercises: [
    { id: 'h', name: 'Dead hang', setCount: 3, reps: 45, kg: 0, unit: 'time' },
    { id: 'p', name: 'Panca', setCount: 3, reps: 8, kg: 50 },
    { id: 'x', name: 'Altro', setCount: 3, reps: 8, kg: 0, unit: 'boh' }] }] }).days[0].exercises;
  assert.strictEqual(a[0].unit, 'time'); assert.strictEqual(a[0].reps, 45);
  assert.ok(!('unit' in a[1]) && !('unit' in a[2]), 'il campo compare solo se serve');
});
t('il tempo arriva a 3600 secondi, le ripetizioni a 100', () => {
  const time = L.normalizeProgram({ days: [{ id: 'd', name: 'G', exercises: [{ id: 'h', name: 'Plank', setCount: 2, reps: 3600, unit: 'time', setReps: [3600, 120] }] }] }).days[0].exercises[0];
  assert.deepStrictEqual(L.repsFor(time, 0), 3600); assert.strictEqual(L.repsFor(time, 1), 120);
  const reps = L.normalizeProgram({ days: [{ id: 'd', name: 'G', exercises: [{ id: 'h', name: 'X', setCount: 1, reps: 3600 }] }] }).days[0].exercises[0];
  assert.strictEqual(reps.reps, 10, 'oltre 100 ripetizioni si torna al valore predefinito');
});
t('formati del tempo: 45 s, 1 min 30 s, 1:30', () => {
  assert.strictEqual(L.fmtTime(45), '45 s'); assert.strictEqual(L.fmtTime(90), '1 min 30 s'); assert.strictEqual(L.fmtTime(120), '2 min');
  assert.strictEqual(L.fmtClock(90), '1:30'); assert.strictEqual(L.fmtClock(45), '0:45');
});
t('la sessione di un esercizio a tempo porta l’unità, il riepilogo mostra i secondi e non fa volume', () => {
  const day = { id: 'd', name: 'G', exercises: [
    { id: 'h', name: 'Dead hang', setCount: 3, reps: 40, kg: 10, unit: 'time', setReps: [40, 35, 30] },
    { id: 'p', name: 'Panca', setCount: 1, reps: 10, kg: 50 }] };
  assert.strictEqual(L.repsSummary(day.exercises[0]), '40 s · 35 s · 30 s');
  const s = L.makeSession(day, 's1', 1000);
  assert.strictEqual(s.exercises[0].unit, 'time'); assert.ok(!('unit' in s.exercises[1]));
  assert.deepStrictEqual(s.exercises[0].sets.map((x) => x.reps), [40, 35, 30]);
  s.exercises.forEach((e) => e.sets.forEach((x) => { x.done = true; }));
  assert.strictEqual(L.sessionStats(s).volume, 500, 'solo la panca: 10 × 50');
});
t('tabella e progressi di un esercizio a tempo: niente volume e niente massimale', () => {
  const prog = { days: [], sessions: [{ id: 's', dayId: 'd', completedAt: 100, exercises: [{ exerciseId: 'h', name: 'Dead hang', unit: 'time', sets: [{ reps: 40, kg: 0, done: true }, { reps: 55, kg: 0, done: true }] }] }] };
  const rows = L.exerciseSets(prog, 'h', false);
  assert.deepStrictEqual(rows.map((r) => r.volume), [0, 0]);
  assert.strictEqual(L.exerciseHistory(prog, 'h')[0].reps, 55, 'vince la serie più lunga');
  const best = L.bestByExercise(prog.sessions, 0, 1000).h;
  assert.strictEqual(best.unit, 'sec'); assert.strictEqual(best.value, 55);
  assert.strictEqual(L.groupVolumeBetween(prog.sessions, 0, 1000)[0].volume, 0);
});
t('la progressione a tempo aggiunge 5 secondi e non si mescola con le ripetizioni', () => {
  const ex = { id: 'h', name: 'Dead hang', setCount: 2, reps: 40, kg: 0, unit: 'time' };
  const mk = (id, unit, secs) => ({ id, dayId: 'd', completedAt: id === 'a' ? 1 : 2, exercises: [Object.assign({ exerciseId: 'h', name: 'x', sets: secs.map((r) => ({ reps: r, kg: 0, done: true })) }, unit ? { unit } : {})] });
  const ok = { sessions: [mk('a', 'time', [40, 42]), mk('b', 'time', [41, 40])] };
  const sug = L.progressionSuggestion(ok, ex);
  assert.deepStrictEqual(sug.setReps, [45, 45]); assert.strictEqual(sug.unit, 'time');
  const old = { sessions: [mk('a', null, [50, 50]), mk('b', null, [50, 50])] };
  assert.strictEqual(L.progressionSuggestion(old, ex), null, 'sessioni a ripetizioni non valgono per un esercizio a tempo');
  assert.strictEqual(L.nextTarget(Object.assign({}, ex, { reps: 300 })), null, 'tetto a 5 minuti');
});
t('sostituire un esercizio a tempo riparte da 10 ripetizioni', () => {
  const sub = L.makeSubstitute({ id: 'h', name: 'Dead hang', setCount: 2, reps: 45, kg: 0, unit: 'time', setReps: [45, 30] }, { name: 'Trazioni', group: 'Dorso', equipment: 'corpo libero' }, 'n1');
  assert.ok(!('unit' in sub) && sub.reps === 10 && !sub.setReps);
});
t('il backup conserva gli esercizi a tempo', () => {
  const prog = L.normalizeProgram({ days: [{ id: 'd', name: 'G', exercises: [{ id: 'h', name: 'Dead hang', setCount: 3, reps: 45, unit: 'time' }] }] });
  const back = L.parseBackup(JSON.stringify(L.makeBackup(prog, 0)));
  assert.strictEqual(back.days[0].exercises[0].unit, 'time');
});

console.log('\n' + n + ' test Allenamenti superati');
