// Test della logica pura della gestione pagine PDF. Esecuzione: node tests/pdf_pages.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../pdf_pages.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const mk = (k) => Array.from({ length: k }, (_, i) => ({ key: 'k' + i, src: 0, idx: i, rot: 0 }));
const keys = (l) => l.map((e) => e.key).join(',');

t('normRot: porta ogni rotazione a 0/90/180/270', () => {
  assert.deepStrictEqual([0, 90, 180, 270, 360, 450, -90, -180].map(L.normRot), [0, 90, 180, 270, 0, 90, 270, 180]);
});
t('moveSel: una pagina si sposta avanti di un posto', () => assert.strictEqual(keys(L.moveSel(mk(4), new Set(['k1']), 1)), 'k0,k2,k1,k3'));
t('moveSel: una pagina si sposta indietro di un posto', () => assert.strictEqual(keys(L.moveSel(mk(4), new Set(['k2']), -1)), 'k0,k2,k1,k3'));
t('moveSel: un blocco di pagine si sposta insieme', () => assert.strictEqual(keys(L.moveSel(mk(5), new Set(['k1', 'k2']), 1)), 'k0,k3,k1,k2,k4'));
t('moveSel: pagine non contigue mantengono l’ordine reciproco', () => assert.strictEqual(keys(L.moveSel(mk(5), new Set(['k1', 'k3']), -1)), 'k1,k0,k3,k2,k4'));
t('moveSel: ai bordi non si muove', () => {
  assert.strictEqual(keys(L.moveSel(mk(3), new Set(['k0']), -1)), 'k0,k1,k2');
  assert.strictEqual(keys(L.moveSel(mk(3), new Set(['k2']), 1)), 'k0,k1,k2');
  assert.strictEqual(keys(L.moveSel(mk(3), new Set(['k1', 'k2']), 1)), 'k0,k1,k2');
});
t('moveSel: non modifica la lista originale', () => { const a = mk(3); L.moveSel(a, new Set(['k0']), 1); assert.strictEqual(keys(a), 'k0,k1,k2'); });
t('rotSel: ruota solo le selezionate e fa il giro completo', () => {
  let l = L.rotSel(mk(3), new Set(['k1']), 90);
  assert.deepStrictEqual(l.map((e) => e.rot), [0, 90, 0]);
  for (let i = 0; i < 3; i++) l = L.rotSel(l, new Set(['k1']), 90);
  assert.strictEqual(l[1].rot, 0);
  assert.strictEqual(L.rotSel(mk(2), new Set(['k0']), -90)[0].rot, 270);
});
t('delSel e pickSel sono complementari', () => {
  const s = new Set(['k0', 'k3']);
  assert.strictEqual(keys(L.delSel(mk(5), s)), 'k1,k2,k4');
  assert.strictEqual(keys(L.pickSel(mk(5), s)), 'k0,k3');
});
t('chunkRanges: pezzi da N pagine, l’ultimo può essere più corto', () => {
  assert.deepStrictEqual(L.chunkRanges(7, 3), [[0, 3], [3, 6], [6, 7]]);
  assert.deepStrictEqual(L.chunkRanges(4, 1), [[0, 1], [1, 2], [2, 3], [3, 4]]);
  assert.deepStrictEqual(L.chunkRanges(3, 10), [[0, 3]]);
  assert.deepStrictEqual(L.chunkRanges(3, 0), [[0, 1], [1, 2], [2, 3]]);
});
t('isChanged: riconosce eliminazioni, riordini, rotazioni e pagine unite', () => {
  assert.strictEqual(L.isChanged(mk(3), 3), false);
  assert.strictEqual(L.isChanged(mk(3).slice(1), 3), true);
  assert.strictEqual(L.isChanged(L.moveSel(mk(3), new Set(['k0']), 1), 3), true);
  assert.strictEqual(L.isChanged(L.rotSel(mk(3), new Set(['k0']), 90), 3), true);
  assert.strictEqual(L.isChanged(mk(3).concat([{ key: 'x', src: 1, idx: 0, rot: 0 }]), 3), true);
});
console.log('\n' + n + ' test unitari gestione pagine superati');
