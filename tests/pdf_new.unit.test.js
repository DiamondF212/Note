// Test della logica pura della creazione di PDF nuovi. Esecuzione: node tests/pdf_new.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../pdf_new.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.01, (m || '') + ' atteso ' + b + ' ottenuto ' + a);

t('pageSize: A4 verticale e orizzontale', () => {
  assert.deepStrictEqual(L.pageSize('a4', false), [595.28, 841.89]);
  assert.deepStrictEqual(L.pageSize('a4', true), [841.89, 595.28]);
});
t('pageSize: Letter, Legal, A5 e formato sconosciuto (ripiega su A4)', () => {
  assert.deepStrictEqual(L.pageSize('letter', false), [612, 792]);
  assert.deepStrictEqual(L.pageSize('legal', true), [1008, 612]);
  assert.deepStrictEqual(L.pageSize('a5', false), [419.53, 595.28]);
  assert.deepStrictEqual(L.pageSize('xyz', false), [595.28, 841.89]);
});
t('clampCount: limiti 1–100 e valori non validi', () => {
  assert.deepStrictEqual([0, -5, 1, 7, 100, 101, 9999, NaN, undefined, '12', 2.6].map(L.clampCount), [1, 1, 1, 7, 100, 100, 100, 1, 1, 12, 3]);
});
t('downscale: riduce il lato lungo, non ingrandisce, mantiene le proporzioni', () => {
  assert.deepStrictEqual(L.downscale(5200, 2600), [2600, 1300]);
  assert.deepStrictEqual(L.downscale(1000, 500), [1000, 500]);
  assert.deepStrictEqual(L.downscale(1000, 4000, 2000), [500, 2000]);
  assert.deepStrictEqual(L.downscale(1, 100000), [1, 2600]);
});
t('fitImage: centra e sta dentro i margini', () => {
  const b = L.fitImage(400, 200, 600, 800, 20);
  near(b.w, 560); near(b.h, 280); near(b.x, 20); near(b.y, 260);
});
t('fitImage: immagine alta in pagina larga', () => {
  const b = L.fitImage(100, 400, 800, 600, 0);
  near(b.h, 600); near(b.w, 150); near(b.x, 325); near(b.y, 0);
});
t('imagePage a4: orientamento segue l’immagine', () => {
  assert.deepStrictEqual(L.imagePage(400, 200, 'a4').size, [841.89, 595.28]);
  assert.deepStrictEqual(L.imagePage(200, 400, 'a4').size, [595.28, 841.89]);
  assert.deepStrictEqual(L.imagePage(300, 300, 'a4').size, [595.28, 841.89]);
});
t('imagePage a4: l’immagine non esce dai margini', () => {
  const p = L.imagePage(400, 200, 'a4'), b = p.box;
  assert.ok(b.x >= 24 - 0.01 && b.y >= 24 - 0.01 && b.x + b.w <= p.size[0] - 24 + 0.01 && b.y + b.h <= p.size[1] - 24 + 0.01);
});
t('imagePage fit: pagina con le proporzioni dell’immagine, senza margine', () => {
  const p = L.imagePage(400, 200, 'fit');
  near(p.size[0] / p.size[1], 2); near(Math.max(...p.size), 842);
  assert.deepStrictEqual(p.box, { x: 0, y: 0, w: p.size[0], h: p.size[1] });
});
t('defaultName: da un solo file, più file, vuoto', () => {
  assert.strictEqual(L.defaultName('img', [{ name: 'Scontrino.jpg' }]), 'Scontrino');
  assert.strictEqual(L.defaultName('img', [{ name: 'a.jpg' }, { name: 'b.jpg' }]), 'Immagini');
  assert.strictEqual(L.defaultName('blank'), 'Nuovo PDF');
});
console.log(n + ' test unitari superati');
