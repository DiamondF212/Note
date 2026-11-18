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

console.log('\n' + n + ' test Allenamenti superati');
