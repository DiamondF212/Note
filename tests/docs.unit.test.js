// Test della logica pura di docs.js. Esecuzione: node tests/docs.unit.test.js
const assert = require('assert');
const { _logic: L } = require('../docs.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const bytes = (s) => Uint8Array.from(Array.from(s).map((c) => c.charCodeAt(0)));

t('riconosce un PDF dall’intestazione', () => assert.strictEqual(L.detectType('x.bin', bytes('%PDF-1.7\n...')), 'pdf'));
t('riconosce un PDF con byte iniziali di troppo', () => assert.strictEqual(L.detectType('x.pdf', bytes('\n\n  %PDF-1.4')), 'pdf'));
t('riconosce un .docx (zip + estensione)', () => assert.strictEqual(L.detectType('Relazione.DOCX', bytes('PK\x03\x04abc')), 'docx'));
t('riconosce un .xlsx (zip + estensione)', () => assert.strictEqual(L.detectType('conti.xlsx', bytes('PK\x03\x04abc')), 'xlsx'));
t('rifiuta uno zip qualsiasi', () => assert.strictEqual(L.detectType('foto.zip', bytes('PK\x03\x04abc')), null));
t('rifiuta un file di testo travestito da PDF', () => assert.strictEqual(L.detectType('finto.pdf', bytes('ciao, sono solo testo')), null));
t('rifiuta un file vuoto', () => assert.strictEqual(L.detectType('vuoto.pdf', new Uint8Array(0)), null));
t('toglie l’estensione dal nome', () => { assert.strictEqual(L.stripExt('Bilancio 2026.xlsx'), 'Bilancio 2026'); assert.strictEqual(L.stripExt('a.b.pdf'), 'a.b'); });
t('pulisce i caratteri vietati nei nomi', () => assert.strictEqual(L.cleanName('  a/b:c*d?  e  '), 'a b c d e'));
t('nome file con estensione giusta', () => assert.strictEqual(L.fileName({ name: 'Lettera', type: 'docx' }), 'Lettera.docx'));
t('nome file vuoto diventa «Documento»', () => assert.strictEqual(L.fileName({ name: '///', type: 'pdf' }), 'Documento.pdf'));
t('dimensioni leggibili', () => { assert.strictEqual(L.fmtSize(512), '512 B'); assert.strictEqual(L.fmtSize(2048), '2,0 KB'); assert.strictEqual(L.fmtSize(5 * 1048576), '5,0 MB'); });
t('nomi unici: libero, (2), (3)', () => {
  assert.strictEqual(L.uniqueName('Conti', []), 'Conti');
  assert.strictEqual(L.uniqueName('Conti', ['conti']), 'Conti (2)');
  assert.strictEqual(L.uniqueName('Conti', ['Conti', 'Conti (2)']), 'Conti (3)');
});
console.log('\n' + n + ' test unitari superati');
