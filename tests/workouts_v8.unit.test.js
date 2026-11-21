// Test della logica pura di Allenamenti v8: recupero per gruppo, tabella dei massimali, badge di costanza.
// Esecuzione: node tests/workouts_v8.unit.test.js
const assert = require('assert');
const BM = require('../body_map.js');
const { _logic: L } = require('../workouts.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };

const HOUR = 36e5, DAY = 864e5;
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime(); // mercoledì 18 novembre 2026, mezzogiorno
const set = (reps, kg, extra) => Object.assign({ reps, kg, done: true }, extra);
const sets = (count, reps, kg) => Array.from({ length: count }, () => set(reps, kg));
const sess = (id, at, exercises) => ({ id, dayId: 'd1', dayName: 'Giorno', startedAt: at - 3600e3, completedAt: at, exercises });
const ex = (name, group, s, extra) => Object.assign({ exerciseId: 'id-' + name, name, group, sets: s }, extra);
const ago = (hours) => NOW - hours * HOUR;
const week = (k) => new Date(2026, 8, 7 + 7 * k, 12).getTime(); // lunedì 7 settembre 2026 + k settimane

/* ---------- recupero ---------- */
t('il recupero si allunga di 12 ore ogni 3 serie oltre le 6, fino a +48', () => {
  [[0, 0], [6, 0], [7, 12], [9, 12], [10, 24], [12, 24], [13, 36], [15, 36], [16, 48], [60, 48]].forEach(([s, e]) => assert.strictEqual(BM.recoveryExtra(s), e, s + ' serie'));
  assert.strictEqual(BM.recoveryExtra(-3), 0);
  assert.strictEqual(BM.recoveryExtra('boh'), 0);
});
t('il tempo base dipende dalla zona e ogni zona ne ha uno', () => {
  BM.ZONES.forEach((z) => assert.ok(BM.RECOVERY_BASE[z.id] >= 48, z.id));
  assert.strictEqual(BM.recoveryNeed('petto', 6), 72);
  assert.strictEqual(BM.recoveryNeed('bicipiti', 6), 48);
  assert.strictEqual(BM.recoveryNeed('petto', 12), 96);
  assert.strictEqual(BM.recoveryNeed('bicipiti', 30), 96);
  assert.strictEqual(BM.recoveryNeed('sconosciuta', 0), 48);
});
t('una zona allenata da poco è in recupero, con ore mancanti e avanzamento', () => {
  const r = L.zoneRecovery([sess('a', ago(24), [ex('Panca piana', 'Petto', sets(9, 8, 50)), ex('Curl con manubri', 'Bicipiti', sets(3, 10, 12))])], NOW);
  assert.strictEqual(r.petto.status, 'wait');
  assert.strictEqual(r.petto.needHours, 84);
  assert.strictEqual(r.petto.hoursLeft, 60);
  assert.strictEqual(r.petto.pct, 29);
  assert.strictEqual(r.petto.sets, 9);
  assert.strictEqual(r.petto.readyAt, ago(24) + 84 * HOUR);
  assert.deepStrictEqual([r.bicipiti.status, r.bicipiti.needHours, r.bicipiti.hoursLeft], ['wait', 48, 24]);
});
t('dopo il tempo stimato la zona è pronta; una mai allenata resta «none»', () => {
  const r = L.zoneRecovery([sess('a', ago(120), [ex('Squat', 'Gambe', sets(4, 5, 80))])], NOW);
  assert.deepStrictEqual([r.quadricipiti.status, r.quadricipiti.hoursLeft, r.quadricipiti.pct], ['ready', 0, 100]);
  assert.deepStrictEqual([r.addome.status, r.addome.lastAt, r.addome.sets], ['none', null, 0]);
  assert.strictEqual(Object.keys(r).length, BM.ZONES.length);
});
t('più esercizi della stessa zona nella sessione sommano le serie', () => {
  const r = L.zoneRecovery([sess('a', ago(2), [ex('Panca piana', 'Petto', sets(3, 8, 50)), ex('Croci ai cavi', 'Petto', sets(4, 12, 15))])], NOW);
  assert.strictEqual(r.petto.sets, 7);
  assert.strictEqual(r.petto.needHours, 84);
});
t('conta l’ultima sessione della zona, non la più pesante', () => {
  const r = L.zoneRecovery([
    sess('old', ago(240), [ex('Panca piana', 'Petto', sets(20, 8, 50))]),
    sess('new', ago(30), [ex('Panca piana', 'Petto', sets(3, 8, 50))])
  ], NOW);
  assert.deepStrictEqual([r.petto.sets, r.petto.needHours, r.petto.lastAt], [3, 72, ago(30)]);
});
t('riscaldamento, serie non fatte e sessioni nel futuro non contano', () => {
  const r = L.zoneRecovery([
    sess('a', ago(1), [ex('Rematore al cavo', 'Dorso', [set(10, 20, { type: 'warmup' }), { reps: 10, kg: 40, done: false }])]),
    sess('b', NOW + HOUR, [ex('Panca piana', 'Petto', sets(3, 8, 50))])
  ], NOW);
  assert.strictEqual(r.dorso.status, 'none');
  assert.strictEqual(r.petto.status, 'none');
});
t('l’elenco mette prima chi sta per essere pronto, poi i più riposati, infine i mai allenati', () => {
  const r = L.zoneRecovery([
    sess('a', ago(24), [ex('Panca piana', 'Petto', sets(3, 8, 50)), ex('Curl con manubri', 'Bicipiti', sets(3, 10, 12))]),
    sess('b', ago(100), [ex('Squat', 'Gambe', sets(4, 5, 80))]),
    sess('c', ago(200), [ex('Hip thrust', 'Glutei', sets(4, 8, 80))])
  ], NOW);
  const order = L.recoveryOrder(r).map((x) => x.zone);
  assert.deepStrictEqual(order.slice(0, 4), ['bicipiti', 'petto', 'glutei', 'quadricipiti']);
  assert.strictEqual(r[order[order.length - 1]].status, 'none');
  assert.strictEqual(order.length, BM.ZONES.length);
});
t('i testi su ore e giorni sono leggibili', () => {
  assert.strictEqual(L.hoursText(0), 'meno di un’ora');
  assert.strictEqual(L.hoursText(0.2), '1 ora');
  assert.strictEqual(L.hoursText(1), '1 ora');
  assert.strictEqual(L.hoursText(5), '5 ore');
  assert.strictEqual(L.hoursText(24), '1 giorno');
  assert.strictEqual(L.hoursText(49), '2 giorni e 1 ora');
  assert.strictEqual(L.hoursText(60), '2 giorni e 12 ore');
  assert.strictEqual(L.agoText(NOW - 2 * HOUR, NOW), 'oggi');
  assert.strictEqual(L.agoText(NOW - DAY, NOW), 'ieri');
  assert.strictEqual(L.agoText(NOW - 3 * DAY, NOW), '3 giorni fa');
  assert.ok(/^oggi alle \d{1,2}[:.]\d{2}$/.test(L.whenText(NOW + 3 * HOUR, NOW)), L.whenText(NOW + 3 * HOUR, NOW));
  assert.ok(L.whenText(NOW + DAY, NOW).startsWith('domani alle '));
  assert.ok(L.whenText(NOW + 3 * DAY, NOW).startsWith('sabato alle '), L.whenText(NOW + 3 * DAY, NOW));
});
t('il corpo si colora per stato di recupero con etichette dedicate', () => {
  const svg = BM.svg('front', {}, { states: { petto: 'ready', bicipiti: 'wait', addome: 'none' }, labels: { petto: 'Petto: pronto' }, selected: 'bicipiti' });
  assert.ok(/class="bm-zone lv0 st-ready" data-zone="petto"[^>]*aria-label="Petto: pronto"/.test(svg));
  assert.ok(/class="bm-zone lv0 st-wait sel" data-zone="bicipiti"/.test(svg));
  assert.ok(svg.includes('st-none'));
});

/* ---------- tabella dei massimali ---------- */
t('la tabella dà il carico per 1, 3, 5, 8, 10 e 12 ripetizioni, a passi di 2,5 kg', () => {
  const rows = L.repTable(100);
  assert.deepStrictEqual(rows.map((r) => r.reps), [1, 3, 5, 8, 10, 12]);
  assert.deepStrictEqual(rows.map((r) => r.kg), [100, 90, 85, 80, 75, 72.5]);
  assert.deepStrictEqual(rows.map((r) => r.pct), [100, 91, 86, 79, 75, 71]);
  rows.forEach((r) => assert.strictEqual(r.kg % 2.5, 0));
});
t('i carichi calano all’aumentare delle ripetizioni', () => {
  [37.3, 80, 142.5, 200].forEach((rm) => {
    const kg = L.repTable(rm).map((r) => r.kg);
    for (let i = 1; i < kg.length; i++) assert.ok(kg[i] <= kg[i - 1], rm + ': ' + kg.join(','));
  });
});
t('la tabella è coerente con la stima del massimale', () => {
  const rm = L.estimateOneRm(80, 5);
  assert.strictEqual(L.repTable(rm).find((r) => r.reps === 5).kg, 80);
  const rm2 = L.estimateOneRm(60, 10);
  assert.strictEqual(L.repTable(rm2).find((r) => r.reps === 10).kg, 60);
});
t('con massimali minuscoli il carico non scende sotto 2,5 kg e valori non validi non danno righe', () => {
  assert.strictEqual(L.repTable(2).find((r) => r.reps === 12).kg, 2.5);
  assert.deepStrictEqual(L.repTable(0), []);
  assert.deepStrictEqual(L.repTable(-5), []);
  assert.deepStrictEqual(L.repTable('boh'), []);
  assert.deepStrictEqual(L.repTable(null), []);
});

/* ---------- badge ---------- */
const get = (list, id) => list.find((b) => b.id === id);
t('senza sessioni nessun traguardo è ottenuto e i valori sono a zero', () => {
  const list = L.badges([], NOW);
  assert.strictEqual(list.length, L.BADGE_DEFS.length);
  list.forEach((b) => assert.deepStrictEqual([b.earned, b.value, b.earnedAt], [false, 0, null], b.id));
});
t('la prima sessione dà «Primo passo» e fa avanzare gli altri', () => {
  const list = L.badges([sess('a', ago(3), [ex('Panca piana', 'Petto', sets(3, 8, 50))])], NOW);
  assert.deepStrictEqual([get(list, 'sess-1').earned, get(list, 'sess-1').earnedAt, get(list, 'sess-1').isNew], [true, ago(3), true]);
  assert.deepStrictEqual([get(list, 'sess-10').earned, get(list, 'sess-10').value], [false, 1]);
  assert.deepStrictEqual([get(list, 'streak-2').earned, get(list, 'streak-2').value], [false, 1]);
});
t('dodici settimane di fila danno tutti i traguardi di costanza e di sessioni fino a 10', () => {
  const sessions = [];
  for (let k = -1; k <= 10; k++) sessions.push(sess('w' + k, week(k), [ex('Panca piana', 'Petto', sets(3, 8, 50))]));
  const list = L.badges(sessions, NOW);
  ['streak-2', 'streak-4', 'streak-8', 'streak-12', 'sess-1', 'sess-10'].forEach((id) => assert.ok(get(list, id).earned, id));
  assert.strictEqual(get(list, 'streak-4').earnedAt, week(2), 'ottenuto alla quarta settimana');
  assert.strictEqual(get(list, 'streak-12').earnedAt, week(10));
  assert.strictEqual(get(list, 'sess-10').earnedAt, week(8));
  assert.deepStrictEqual([get(list, 'sess-25').earned, get(list, 'sess-25').value], [false, 12]);
  assert.strictEqual(get(list, 'month-8').earned, false);
  assert.strictEqual(get(list, 'streak-12').isNew, true, 'ottenuto 2 giorni prima: è ancora nuovo');
  assert.strictEqual(get(list, 'streak-4').isNew, false, 'ottenuto da settimane: non è più nuovo');
});
t('una pausa spezza la serie ma i traguardi già ottenuti restano', () => {
  const ks = [0, 1, 2, 3, 5, 6];
  const list = L.badges(ks.map((k) => sess('w' + k, week(k), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.ok(get(list, 'streak-4').earned);
  assert.deepStrictEqual([get(list, 'streak-8').earned, get(list, 'streak-8').value], [false, 4]);
});
t('le settimane separate da un buco non si sommano', () => {
  const list = L.badges([0, 2, 4, 6].map((k) => sess('w' + k, week(k), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.deepStrictEqual([get(list, 'streak-2').earned, get(list, 'streak-2').value], [false, 1]);
});
t('più sessioni nella stessa settimana contano come una settimana', () => {
  const list = L.badges([0, 1, 2, 3].map((d) => sess('d' + d, week(0) + d * DAY, [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.strictEqual(get(list, 'streak-2').value, 1);
});
t('la serie continua anche oltre il cambio dell’ora legale', () => {
  const list = L.badges([-3, -2, -1, 0].map((k) => sess('w' + k, new Date(2026, 9, 26 + 7 * k, 12).getTime(), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.ok(get(list, 'streak-4').earned);
});
t('otto sessioni nello stesso mese danno «Mese pieno», dodici «Mese da campione»', () => {
  const day = (d) => new Date(2026, 2, d, 12).getTime();
  const eight = L.badges(Array.from({ length: 8 }, (_, i) => sess('m' + i, day(2 + i), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.deepStrictEqual([get(eight, 'month-8').earned, get(eight, 'month-8').earnedAt], [true, day(9)]);
  assert.deepStrictEqual([get(eight, 'month-12').earned, get(eight, 'month-12').value], [false, 8]);
  const twelve = L.badges(Array.from({ length: 12 }, (_, i) => sess('m' + i, day(1 + i), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.ok(get(twelve, 'month-12').earned);
});
t('le sessioni a cavallo di due mesi non si sommano', () => {
  const list = L.badges(Array.from({ length: 8 }, (_, i) => sess('m' + i, new Date(2026, 2, 28 + i, 12).getTime(), [ex('Panca piana', 'Petto', sets(3, 8, 50))])), NOW);
  assert.strictEqual(get(list, 'month-8').earned, false);
  assert.strictEqual(get(list, 'month-8').value, 4);
});
t('«Corpo intero» richiede le sei parti nella stessa settimana, anche in sessioni diverse', () => {
  const parts = [
    ex('Panca piana', 'Petto', sets(3, 8, 50)), ex('Rematore al cavo', 'Dorso', sets(3, 10, 40)), ex('Shoulder press manubri', 'Spalle', sets(3, 10, 15)),
    ex('Curl con bilanciere', 'Bicipiti', sets(3, 10, 20)), ex('Squat', 'Gambe', sets(3, 5, 80)), ex('Plank', 'Addome', sets(3, 1, 0))
  ];
  const full = L.badges([sess('a', week(0), parts.slice(0, 2)), sess('b', week(0) + DAY, parts.slice(2, 4)), sess('c', week(0) + 3 * DAY, parts.slice(4))], NOW);
  assert.deepStrictEqual([get(full, 'body').earned, get(full, 'body').earnedAt, get(full, 'body').value], [true, week(0) + 3 * DAY, 6]);
  const split = L.badges([sess('a', week(0), parts.slice(0, 3)), sess('b', week(1), parts.slice(3))], NOW);
  assert.deepStrictEqual([get(split, 'body').earned, get(split, 'body').value], [false, 3]);
});
t('bicipiti e tricipiti contano come «braccia», e il riscaldamento non conta', () => {
  const base = [ex('Panca piana', 'Petto', sets(3, 8, 50)), ex('Rematore al cavo', 'Dorso', sets(3, 10, 40)), ex('Shoulder press manubri', 'Spalle', sets(3, 10, 15)), ex('Squat', 'Gambe', sets(3, 5, 80)), ex('Plank', 'Addome', sets(3, 1, 0))];
  const withTri = L.badges([sess('a', week(0), base.concat([ex('French press', 'Tricipiti', sets(3, 10, 20))]))], NOW);
  assert.ok(get(withTri, 'body').earned);
  const warmOnly = L.badges([sess('a', week(0), base.concat([ex('French press', 'Tricipiti', [set(10, 10, { type: 'warmup' })])]))], NOW);
  assert.deepStrictEqual([get(warmOnly, 'body').earned, get(warmOnly, 'body').value], [false, 5]);
});
t('«Nuovo» vale solo per i traguardi di meno di 7 giorni', () => {
  const recent = L.badges([sess('a', NOW - 6 * DAY, [ex('Panca piana', 'Petto', sets(3, 8, 50))])], NOW);
  assert.strictEqual(get(recent, 'sess-1').isNew, true);
  const old = L.badges([sess('a', NOW - 8 * DAY, [ex('Panca piana', 'Petto', sets(3, 8, 50))])], NOW);
  assert.strictEqual(get(old, 'sess-1').isNew, false);
  assert.strictEqual(get(L.badges([], NOW), 'sess-1').isNew, false);
});
t('il valore mostrato non supera mai l’obiettivo e ogni traguardo ha testi e icona', () => {
  const sessions = Array.from({ length: 30 }, (_, i) => sess('x' + i, week(-20 + i), [ex('Panca piana', 'Petto', sets(3, 8, 50))]));
  L.badges(sessions, NOW).forEach((b) => { assert.ok(b.value <= b.goal, b.id); assert.ok(b.title && b.desc && b.icon, b.id); });
  assert.strictEqual(new Set(L.BADGE_DEFS.map((b) => b.id)).size, L.BADGE_DEFS.length);
});

console.log('\n' + n + ' test recupero, massimali e traguardi superati');
