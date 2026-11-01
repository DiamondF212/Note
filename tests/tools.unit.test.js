// Test della logica pura di tools.js. Esecuzione: node tests/tools.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../tools.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const close = (a, b, e) => assert.ok(Math.abs(a - b) <= (e || 1e-9) * Math.max(1, Math.abs(b)), a + ' !~ ' + b);

t('lunghezza m→ft', () => close(L.convert('length', 1, 'm', 'ft'), 3.280839895));
t('lunghezza ft→m', () => close(L.convert('length', 10, 'ft', 'm'), 3.048));
t('lunghezza mi→km', () => close(L.convert('length', 1, 'mi', 'km'), 1.609344));
t('lunghezza in→cm', () => close(L.convert('length', 1, 'in', 'cm'), 2.54));
t('peso kg→lb', () => close(L.convert('mass', 1, 'kg', 'lb'), 2.2046226218));
t('peso lb→kg', () => close(L.convert('mass', 150, 'lb', 'kg'), 68.0388555));
t('peso oz→g', () => close(L.convert('mass', 1, 'oz', 'g'), 28.349523125));
t('temp 0°C→°F', () => close(L.convert('temp', 0, 'C', 'F'), 32));
t('temp 100°C→°F', () => close(L.convert('temp', 100, 'C', 'F'), 212));
t('temp 98.6°F→°C', () => close(L.convert('temp', 98.6, 'F', 'C'), 37, 1e-6));
t('temp -40 uguale', () => close(L.convert('temp', -40, 'C', 'F'), -40));
t('temp 0°C→K', () => close(L.convert('temp', 0, 'C', 'K'), 273.15));
t('temp sotto zero assoluto → NaN', () => assert.ok(isNaN(L.convert('temp', -300, 'C', 'F'))));
t('volume gal→l', () => close(L.convert('volume', 1, 'gal', 'l'), 3.785411784));
t('area ha→m2', () => close(L.convert('area', 1, 'ha', 'm2'), 10000));
t('velocità km/h→mph', () => close(L.convert('speed', 100, 'kmh', 'mph'), 62.1371192, 1e-7));
t('velocità kn→km/h', () => close(L.convert('speed', 1, 'kn', 'kmh'), 1.852));
t('tempo h→min', () => close(L.convert('time', 2, 'h', 'min'), 120));
t('dati GB→MB', () => close(L.convert('data', 1, 'GB', 'MB'), 1000));
t('dati GiB→MiB', () => close(L.convert('data', 1, 'GiB', 'MiB'), 1024));
t('pressione bar→psi', () => close(L.convert('pressure', 1, 'bar', 'psi'), 14.5037738, 1e-6));
t('stessa unità = identità', () => { for (const [c, d] of Object.entries(L.UNITS)) for (const u of Object.keys(d.u)) close(L.convert(c, 12.5, u, u), 12.5); });
t('andata e ritorno per ogni coppia', () => { for (const [c, d] of Object.entries(L.UNITS)) for (const a of Object.keys(d.u)) for (const b of Object.keys(d.u)) close(L.convert(c, L.convert(c, 37.25, a, b), b, a), 37.25, 1e-9); });
t('input non validi → NaN', () => { assert.ok(isNaN(L.convert('length', NaN, 'm', 'ft'))); assert.ok(isNaN(L.convert('length', 1, 'm', 'zz'))); assert.ok(isNaN(L.convert('boh', 1, 'm', 'ft'))); assert.ok(isNaN(L.convert('length', '1', 'm', 'ft'))); });

t('parseNum formati', () => {
  assert.strictEqual(L.parseNum('12'), 12); assert.strictEqual(L.parseNum('12,5'), 12.5); assert.strictEqual(L.parseNum('12.5'), 12.5);
  assert.strictEqual(L.parseNum('1.234,5'), 1234.5); assert.strictEqual(L.parseNum('1,234.5'), 1234.5); assert.strictEqual(L.parseNum('-3,2'), -3.2);
  assert.strictEqual(L.parseNum(' 7 '), 7); assert.strictEqual(L.parseNum('.5'), 0.5); assert.strictEqual(L.parseNum('1e3'), 1000);
  for (const bad of ['', '  ', 'abc', '1,2,3x', '--1', '1..2', null, undefined, '€5']) assert.strictEqual(L.parseNum(bad), null, String(bad));
});
t('fmtNum', () => {
  assert.strictEqual(L.fmtNum(0), '0'); assert.strictEqual(L.fmtNum(NaN), '—'); assert.strictEqual(L.fmtNum(Infinity), '—');
  assert.strictEqual(L.fmtNum(212), '212'); assert.strictEqual(L.fmtNum(0.1 + 0.2), '0,3'); assert.strictEqual(L.fmtNum(3.280839895013123), '3,280839895');
  assert.strictEqual(L.fmtNum(1234567.5), '1.234.567,5'); assert.strictEqual(L.fmtNum(-40), '-40'); assert.strictEqual(L.fmtNum(1e20), '1e+20');
});

t('sconto 20% su 100', () => { const r = L.discount(100, 20); assert.deepStrictEqual([r.final, r.saved], [80, 20]); });
t('sconto 15% su 59,90', () => { const r = L.discount(59.9, 15); assert.deepStrictEqual([r.final, r.saved], [50.92, 8.98]); close(r.price, 59.9); });
t('sconto 0% e 100%', () => { assert.strictEqual(L.discount(50, 0).final, 50); const r = L.discount(50, 100); assert.deepStrictEqual([r.final, r.saved], [0, 50]); });
t('due sconti a cascata 20%+10% su 100', () => { const r = L.discount(100, 20, 10); assert.deepStrictEqual([r.final, r.saved], [72, 28]); close(r.effective, 28); });
t('prezzo zero', () => { const r = L.discount(0, 30); assert.deepStrictEqual([r.final, r.saved, r.effective], [0, 0, 0]); });
t('risparmio + finale = iniziale (centesimi)', () => { for (let p = 0.01; p < 300; p += 7.37) for (const d of [3.3, 12.5, 33, 99.9]) { const r = L.discount(p, d, 7); assert.strictEqual(Math.round((r.final + r.saved) * 100), Math.round(r.price * 100)); } });
t('errori sconto', () => {
  assert.ok(L.discount(-5, 10).error); assert.ok(L.discount(10, -1).error); assert.ok(L.discount(10, 101).error);
  assert.ok(L.discount(10, 10, 150).error); assert.ok(L.discount(NaN, 10).error); assert.ok(L.discount(10, NaN).error);
});
t('eur formato', () => assert.ok(/80,00\s*€/.test(L.eur(80))));

t('fmtClock', () => {
  assert.strictEqual(L.fmtClock(0, true), '00:00,00'); assert.strictEqual(L.fmtClock(61234, true), '01:01,23');
  assert.strictEqual(L.fmtClock(3600000), '1:00:00'); assert.strictEqual(L.fmtClock(3723450, true), '1:02:03,45');
  assert.strictEqual(L.fmtClock(-50), '00:00'); assert.strictEqual(L.fmtClock(59999), '00:59');
});
t('toSeconds', () => {
  assert.strictEqual(L.toSeconds(5, 0), 300); assert.strictEqual(L.toSeconds(0, 90), 90); assert.strictEqual(L.toSeconds(1, 30), 90);
  assert.strictEqual(L.toSeconds(0, 0), null); assert.strictEqual(L.toSeconds(-1, 0), null); assert.strictEqual(L.toSeconds(NaN, 1), null); assert.strictEqual(L.toSeconds(6000, 0), null);
});

const B = (v, f, t, m) => L.convertBase(v, f, t, m);
t('basi: 255 dec → bin/oct/hex', () => { assert.strictEqual(B('255', 10, 2).text, '11111111'); assert.strictEqual(B('255', 10, 8).text, '377'); assert.strictEqual(B('255', 10, 16).text, 'FF'); });
t('basi: viceversa → decimale', () => { assert.strictEqual(B('11111111', 2, 10).text, '255'); assert.strictEqual(B('377', 8, 10).text, '255'); assert.strictEqual(B('ff', 16, 10).text, '255'); assert.strictEqual(B('FF', 16, 10).text, '255'); });
t('basi: bin ↔ hex ↔ oct direttamente', () => { assert.strictEqual(B('1010 1111', 2, 16).text, 'AF'); assert.strictEqual(B('AF', 16, 2).text, '10101111'); assert.strictEqual(B('777', 8, 2).text, '111111111'); assert.strictEqual(B('1F', 16, 8).text, '37'); });
t('basi: zero e segno', () => { assert.strictEqual(B('0', 10, 2).text, '0'); assert.strictEqual(B('-10', 10, 16).text, '-A'); assert.strictEqual(B('-0', 10, 2).text, '0'); assert.strictEqual(B('+7', 10, 2).text, '111'); });
t('basi: prefissi 0b 0o 0x solo se coerenti con la base', () => { assert.strictEqual(B('0xFF', 16, 10).text, '255'); assert.strictEqual(B('0b101', 2, 10).text, '5'); assert.strictEqual(B('0o17', 8, 10).text, '15'); assert.strictEqual(B('0b1', 16, 10).text, '177'); });
t('basi: parte frazionaria esatta e approssimata', () => {
  assert.strictEqual(B('0,5', 10, 2).text, '0,1'); assert.strictEqual(B('10.5', 10, 2).text, '1010,1'); assert.strictEqual(B('0.75', 10, 2).text, '0,11'); assert.strictEqual(B('1010,1', 2, 10).text, '10,5'); assert.strictEqual(B('A.8', 16, 10).text, '10,5');
  const r = B('0.1', 10, 2); assert.strictEqual(r.truncated, true); assert.strictEqual(r.text, '0,000110011001'); assert.strictEqual(B('0.5', 10, 2).truncated, false);
});
t('basi: numeri enormi senza perdita (BigInt)', () => { assert.strictEqual(B('1267650600228229401496703205376', 10, 2).text, '1' + '0'.repeat(100)); assert.strictEqual(B('FFFFFFFFFFFFFFFFFFFF', 16, 10).text, '1208925819614629174706175'); });
t('basi: da 2 a 36', () => { assert.strictEqual(B('zz', 36, 10).text, '1295'); assert.strictEqual(B('1295', 10, 36).text, 'ZZ'); assert.strictEqual(B('100', 3, 10).text, '9'); assert.strictEqual(B('10', 7, 2).text, '111'); });
t('basi: andata e ritorno per ogni coppia di basi', () => { for (let a = 2; a <= 36; a++) for (let b = 2; b <= 36; b++) { const x = B('987654321098765', 10, a).text; assert.strictEqual(B(x, a, b).text === undefined, false); assert.strictEqual(B(B(x, a, b).text, b, 10).text, '987654321098765', a + '→' + b); } });
t('basi: errori chiari', () => {
  assert.ok(/«2».*base 2/.test(B('1012', 2, 10).error)); assert.ok(/«G».*base 16/.test(B('FG', 16, 10).error)); assert.ok(/«9».*base 8/.test(B('9', 8, 10).error));
  assert.ok(B('1.2.3', 10, 2).error); assert.ok(B('12$', 10, 2).error); assert.ok(B('1', 1, 2).error); assert.ok(B('1', 10, 37).error); assert.ok(B('.', 10, 2).error); assert.ok(B('1'.repeat(2001), 10, 2).error);
  assert.strictEqual(B('', 10, 2).empty, true); assert.strictEqual(B('   ', 10, 2).empty, true);
});

console.log('\n' + n + ' test unitari superati');
