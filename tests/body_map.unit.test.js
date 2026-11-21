// Test della logica pura di body_map.js e della mappa/equilibrio in workouts.js. Esecuzione: node tests/body_map.unit.test.js
const assert = require('assert');
const BM = require('../body_map.js');
const { _logic: L } = require('../workouts.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const DAY = 864e5, NOW = 1800000000000;

const set = (reps, kg, extra) => Object.assign({ reps, kg, done: true }, extra);
const sess = (id, ago, exercises) => ({ id, dayId: 'd1', dayName: 'Giorno', startedAt: NOW - ago * DAY - 3600e3, completedAt: NOW - ago * DAY, exercises });
const ex = (name, group, sets, extra) => Object.assign({ exerciseId: 'id-' + name, name, group, sets }, extra);

t('ogni gruppo della scheda ha una zona di partenza', () => {
  L.GROUPS.filter((g) => g !== 'Altro').forEach((g) => assert.ok(BM.isZone(BM.zoneFor(g, null).zone), g));
  assert.strictEqual(BM.zoneFor('Altro', null).zone, null);
  assert.strictEqual(BM.zoneFor('Gruppo inventato', null).zone, null);
});
t('il movimento precisa la zona dove il gruppo è largo', () => {
  assert.deepStrictEqual(BM.zoneFor('Gambe', 'femorali'), { zone: 'femorali', exact: true });
  assert.deepStrictEqual(BM.zoneFor('Gambe', 'polpacci'), { zone: 'polpacci', exact: true });
  assert.deepStrictEqual(BM.zoneFor('Gambe', 'adduttori'), { zone: 'adduttori', exact: true });
  assert.deepStrictEqual(BM.zoneFor('Gambe', 'squat'), { zone: 'quadricipiti', exact: true });
  assert.strictEqual(BM.zoneFor('Dorso', 'lombari').zone, 'lombari');
  assert.strictEqual(BM.zoneFor('Dorso', 'rematore').zone, 'dorso');
  assert.strictEqual(BM.zoneFor('Spalle', 'trapezi').zone, 'trapezi');
  assert.strictEqual(BM.zoneFor('Spalle', 'laterali').zone, 'spalle');
});
t('un esercizio di Gambe scritto a mano finisce sui quadricipiti ma non è «esatto»', () => {
  assert.deepStrictEqual(BM.zoneFor('Gambe', null), { zone: 'quadricipiti', exact: false });
  assert.strictEqual(BM.zoneFor('Petto', null).exact, true);
});
t('il colore va da 0 a 4 in proporzione al massimo', () => {
  assert.strictEqual(BM.level(0, 10), 0);
  assert.strictEqual(BM.level(1, 10), 1);
  assert.strictEqual(BM.level(5, 10), 2);
  assert.strictEqual(BM.level(7, 10), 3);
  assert.strictEqual(BM.level(10, 10), 4);
  assert.strictEqual(BM.level(3, 0), 0);
  assert.strictEqual(BM.level(99, 10), 4);
});
t('il corpo da davanti e da dietro mostra le zone giuste', () => {
  const front = BM.svg('front', { petto: 4 }, { sets: { petto: 12 } });
  const back = BM.svg('back', { dorso: 2 }, { sets: { dorso: 5 } });
  ['petto', 'bicipiti', 'addome', 'quadricipiti', 'adduttori', 'spalle', 'polpacci'].forEach((z) => assert.ok(front.includes('data-zone="' + z + '"'), 'davanti: ' + z));
  ['trapezi', 'dorso', 'lombari', 'tricipiti', 'glutei', 'femorali', 'spalle', 'polpacci'].forEach((z) => assert.ok(back.includes('data-zone="' + z + '"'), 'dietro: ' + z));
  assert.ok(!front.includes('data-zone="dorso"') && !back.includes('data-zone="petto"'));
  assert.ok(front.includes('bm-zone lv4') && front.includes('aria-label="Petto: 12 serie"'));
  assert.ok(back.includes('data-bm-view="back"'));
});
t('la zona selezionata è segnata e i livelli fuori scala si limitano', () => {
  const s = BM.svg('front', { petto: 9, addome: -3 }, { selected: 'petto' });
  assert.ok(/class="bm-zone lv4 sel" data-zone="petto"[^>]*aria-pressed="true"/.test(s));
  assert.ok(/class="bm-zone lv0" data-zone="addome"/.test(s));
  assert.ok(BM.svg('boh', {}).includes('data-bm-view="front"'));
});
t('equilibrio: sotto 6 serie totali i dati non bastano', () => {
  const r = BM.judge(BM.PAIRS[0], 5, 0);
  assert.strictEqual(r.status, 'few'); assert.strictEqual(r.advice, '');
});
t('equilibrio: spinta e trazione, soglia al 70%', () => {
  assert.strictEqual(BM.judge(BM.PAIRS[0], 10, 7).status, 'ok');
  const low = BM.judge(BM.PAIRS[0], 10, 6);
  assert.strictEqual(low.status, 'low-b'); assert.ok(/aggiungi rematori/.test(low.advice));
  const other = BM.judge(BM.PAIRS[0], 6, 10);
  assert.strictEqual(other.status, 'low-a'); assert.ok(/petto, spalle o tricipiti/.test(other.advice));
});
t('equilibrio: quadricipiti e femorali tollerano metà serie sui femorali', () => {
  assert.strictEqual(BM.judge(BM.PAIRS[1], 12, 6).status, 'ok');
  const low = BM.judge(BM.PAIRS[1], 12, 5);
  assert.strictEqual(low.status, 'low-b'); assert.ok(/leg curl/.test(low.advice));
});
t('equilibrio: le quote sommano 100 e senza serie sono 0', () => {
  const r = BM.judge(BM.PAIRS[2], 10, 5);
  assert.strictEqual(r.shareA + r.shareB, 100); assert.strictEqual(r.shareA, 67);
  const z = BM.judge(BM.PAIRS[2], 0, 0);
  assert.deepStrictEqual([z.shareA, z.shareB, z.status], [0, 0, 'few']);
  assert.strictEqual(BM.balance({}).length, 3);
});

t('la zona di un esercizio viene dal catalogo anche senza gruppo', () => {
  assert.strictEqual(L.exerciseZone({ name: 'Panca piana' }).zone, 'petto');
  assert.strictEqual(L.exerciseZone({ name: 'Leg curl seduto', group: 'Gambe' }).zone, 'femorali');
  assert.strictEqual(L.exerciseZone({ name: 'Calf in piedi' }).zone, 'polpacci');
  assert.strictEqual(L.exerciseZone({ name: 'Scrollate', group: 'Spalle' }).zone, 'trapezi');
  assert.strictEqual(L.exerciseZone({ name: 'Hyperextension' }).zone, 'lombari');
  assert.deepStrictEqual([L.exerciseZone({ name: 'Sled push', group: 'Gambe' }).zone, L.exerciseZone({ name: 'Sled push', group: 'Gambe' }).exact], ['quadricipiti', false]);
  assert.strictEqual(L.exerciseZone({ name: 'Esercizio misterioso' }).zone, null);
  assert.strictEqual(L.exerciseZone({ name: 'Esercizio misterioso', group: 'Altro' }).zone, null);
});
t('le serie per zona escludono riscaldamento, non completate e fuori periodo', () => {
  const sessions = [
    sess('a', 2, [ex('Panca piana', 'Petto', [set(5, 20, { type: 'warmup' }), set(8, 50), set(8, 50), { reps: 8, kg: 50, done: false }, set(6, 52.5)])]),
    sess('b', 20, [ex('Panca piana', 'Petto', [set(10, 45)])])
  ];
  const d = L.zoneBreakdown(sessions, NOW - 7 * DAY, Infinity);
  assert.strictEqual(d.totalSets, 3); assert.strictEqual(d.zones.petto.sets, 3); assert.strictEqual(d.max, 3);
  const row = d.zones.petto.exercises[0];
  assert.deepStrictEqual([row.name, row.sets, row.sessions, row.repsMin, row.repsMax, row.kgMin, row.kgMax], ['Panca piana', 3, 1, 6, 8, 50, 52.5]);
  assert.deepStrictEqual(row.best, { kg: 52.5, reps: 6 });
  assert.strictEqual(d.zones.petto.volume, 8 * 50 * 2 + 6 * 52.5);
  const wide = L.zoneBreakdown(sessions, NOW - 30 * DAY, Infinity);
  assert.strictEqual(wide.zones.petto.sets, 4); assert.strictEqual(wide.zones.petto.exercises[0].sessions, 2);
  assert.strictEqual(wide.zones.petto.exercises[0].kgMin, 45);
});
t('lo stesso esercizio in più sessioni si somma in una riga; gli esercizi sono ordinati per serie', () => {
  const sessions = [
    sess('a', 1, [ex('Panca piana', 'Petto', [set(8, 50), set(8, 50)]), ex('Croci ai cavi', 'Petto', [set(12, 15)])]),
    sess('b', 3, [ex('Panca piana', 'Petto', [set(8, 47.5)])])
  ];
  const rows = L.zoneBreakdown(sessions, 0, Infinity).zones.petto.exercises;
  assert.deepStrictEqual(rows.map((r) => [r.name, r.sets, r.sessions]), [['Panca piana', 3, 2], ['Croci ai cavi', 1, 1]]);
});
t('gli esercizi a tempo mostrano i secondi e non fanno volume; a corpo libero niente kg', () => {
  const sessions = [sess('a', 1, [
    ex('Dead hang', 'Dorso', [set(30, 0), set(45, 0)], { unit: 'time' }),
    ex('Trazioni alla sbarra', 'Dorso', [set(8, 0), set(10, 0)])
  ])];
  const d = L.zoneBreakdown(sessions, 0, Infinity);
  const hang = d.zones.dorso.exercises.find((e) => e.name === 'Dead hang');
  assert.strictEqual(hang.timed, true); assert.deepStrictEqual(hang.best, { kg: 0, reps: 45 });
  assert.strictEqual(L.exerciseDetailText(hang), 'Tempo 30 s – 45 s · migliore 45 s');
  const pull = d.zones.dorso.exercises.find((e) => e.name === 'Trazioni alla sbarra');
  assert.strictEqual(L.exerciseDetailText(pull), 'Rip 8–10 · corpo libero · migliore 10 rip');
  assert.strictEqual(d.zones.dorso.volume, 0);
});
t('il testo di un esercizio con carichi mostra intervalli e il migliore', () => {
  const e = { name: 'Squat', timed: false, sets: 4, sessions: 2, repsMin: 5, repsMax: 5, kgMin: 80, kgMax: 82.5, best: { kg: 82.5, reps: 5 } };
  assert.strictEqual(L.exerciseDetailText(e), 'Rip 5 · 80–82,5 kg · migliore 82,5 kg × 5');
});
t('le serie senza gruppo conosciuto sono contate a parte', () => {
  const d = L.zoneBreakdown([sess('a', 1, [ex('Esercizio misterioso', '', [set(10, 10), set(10, 10)]), ex('Panca piana', 'Petto', [set(8, 40)])])], 0, Infinity);
  assert.strictEqual(d.unmapped, 2); assert.strictEqual(d.totalSets, 3);
  assert.deepStrictEqual(Object.keys(d.zones), ['petto']);
});
t('un periodo senza sessioni dà una mappa vuota', () => {
  const d = L.zoneBreakdown([], 0, Infinity);
  assert.deepStrictEqual([d.totalSets, d.max, Object.keys(d.zones).length], [0, 0, 0]);
});
t('spinta, trazione, quadricipiti, femorali, alto e basso: ogni esercizio va dove deve', () => {
  const kinds = (name, group) => L.balanceKinds({ name, group }).sort().join(',');
  assert.strictEqual(kinds('Panca piana'), 'push,upper');
  assert.strictEqual(kinds('French press'), 'push,upper');
  assert.strictEqual(kinds('Shoulder press manubri'), 'push,upper');
  assert.strictEqual(kinds('Rematore al cavo'), 'pull,upper');
  assert.strictEqual(kinds('Curl con bilanciere'), 'pull,upper');
  assert.strictEqual(kinds('Alzate posteriori manubri'), 'pull,upper');
  assert.strictEqual(kinds('Face pull'), 'pull,upper');
  assert.strictEqual(kinds('Squat'), 'lower,quad');
  assert.strictEqual(kinds('Affondi'), 'lower,quad');
  assert.strictEqual(kinds('Leg extension'), 'lower,quad');
  assert.strictEqual(kinds('Leg curl seduto'), 'ham,lower');
  assert.strictEqual(kinds('Stacchi rumeni'), 'ham,lower');
  assert.strictEqual(kinds('Hip thrust'), 'lower');
  assert.strictEqual(kinds('Stacco da terra'), 'lower');
  assert.strictEqual(kinds('Hyperextension'), '');
  assert.strictEqual(kinds('Plank'), '');
  assert.strictEqual(kinds('Sled push', 'Gambe'), 'lower');
  assert.strictEqual(kinds('Esercizio misterioso'), '');
});
t('le serie dell’equilibrio si sommano sul periodo e senza riscaldamento', () => {
  const sessions = [
    sess('a', 2, [ex('Panca piana', 'Petto', [set(8, 50), set(8, 50), set(5, 20, { type: 'warmup' })]), ex('Rematore al cavo', 'Dorso', [set(10, 40)]), ex('Squat', 'Gambe', [set(5, 80), set(5, 80)]), ex('Leg curl seduto', 'Gambe', [set(10, 30)])]),
    sess('b', 40, [ex('Panca piana', 'Petto', [set(8, 45)])])
  ];
  const w = L.lastDays(30, NOW);
  assert.deepStrictEqual(L.balanceSets(sessions, w.from, w.to), { push: 2, pull: 1, quad: 2, ham: 1, upper: 3, lower: 3 });
  const all = L.lastDays(90, NOW);
  assert.strictEqual(L.balanceSets(sessions, all.from, all.to).push, 3);
});
t('gli ultimi N giorni partono da N giorni fa e non hanno fine', () => {
  const r = L.lastDays(7, NOW);
  assert.deepStrictEqual([r.from, r.to], [NOW - 7 * DAY, Infinity]);
});

console.log('\n' + n + ' test mappa muscoli superati');
