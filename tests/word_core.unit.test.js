// Test della logica pura di Word (modello, scrittura .docx, impaginazione). Esecuzione: node tests/word_core.unit.test.js
const assert = require('assert');
const C = require('../word_core.js');
const L = C._logic;
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok  ' + name); };
const P = (text, extra) => Object.assign({ t: 'p', style: 'n', runs: [{ text }] }, extra || {});
const files = (m) => Object.fromEntries(C.buildDocxFiles(m).map((f) => [f.name, f.data]));
const measure = (st, size, text) => text.length * size * 0.5; // ogni carattere = mezzo corpo
const texts = (page) => page.filter((i) => i.k === 't').map((i) => i.text);

t('xesc: caratteri speciali e di controllo', () => {
  assert.strictEqual(L.xesc('a & b <c> "d"\u0001'), 'a &amp; b &lt;c&gt; &quot;d&quot;');
});
t('runXml: grassetto, corsivo, sottolineato, barrato; run vuoto ignorato; a capo', () => {
  const x = L.runXml({ text: 'Ciao', b: true, i: true, u: true, s: true });
  ['<w:b/>', '<w:i/>', '<w:strike/>', '<w:u w:val="single"/>', 'xml:space="preserve">Ciao<'].forEach((k) => assert.ok(x.includes(k), k));
  assert.strictEqual(L.runXml({ text: '' }), '');
  assert.strictEqual(L.runXml({ br: true }), '<w:r><w:br/></w:r>');
  assert.ok(!L.runXml({ text: 'x' }).includes('<w:rPr>'));
});
t('buildDocxFiles: pacchetto completo e ordine corretto', () => {
  const names = C.buildDocxFiles([P('x')]).map((f) => f.name);
  assert.deepStrictEqual(names, ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']);
});
t('documento vuoto: contiene comunque un paragrafo', () => {
  assert.ok(files([])['word/document.xml'].includes('<w:p>'));
});
t('titoli e allineamento', () => {
  const d = files([P('T', { style: 'h2', align: 'center' }), P('d', { align: 'justify' }), P('r', { align: 'right' })])['word/document.xml'];
  assert.ok(d.includes('<w:pStyle w:val="Heading2"/><w:jc w:val="center"/>'));
  assert.ok(d.includes('<w:jc w:val="both"/>') && d.includes('<w:jc w:val="right"/>'));
  assert.ok(!files([P('x')])['word/document.xml'].includes('<w:jc'));
});
t('elenchi: puntati = numId 1; ogni elenco numerato ha il suo numId (riparte da 1)', () => {
  const li = (txt, ord, list, level) => ({ t: 'li', ord, list, level: level || 0, runs: [{ text: txt }] });
  const f = files([li('a', false, 1), li('b', true, 7), li('c', true, 7, 1), P('x'), li('d', true, 9)]);
  const d = f['word/document.xml'];
  assert.ok(d.includes('<w:ilvl w:val="0"/><w:numId w:val="1"/>'));
  assert.ok(d.includes('<w:ilvl w:val="1"/><w:numId w:val="2"/>'));
  assert.ok(d.includes('<w:numId w:val="3"/>'));
  const nb = f['word/numbering.xml'];
  assert.ok(nb.includes('<w:num w:numId="2">') && nb.includes('<w:num w:numId="3">') && !nb.includes('<w:num w:numId="4">'));
  assert.ok(nb.includes('startOverride'));
});
t('livello elenco fuori limite viene riportato a 0–8', () => {
  const d = files([{ t: 'li', ord: false, list: 1, level: 99, runs: [{ text: 'x' }] }])['word/document.xml'];
  assert.ok(d.includes('<w:ilvl w:val="8"/>'));
});
t('tabella: griglia, celle unite, righe corte riempite, paragrafo finale', () => {
  const cell = (s, span) => ({ blocks: [P(s)], span });
  const d = files([{ t: 'tbl', rows: [[cell('a'), cell('b'), cell('c')], [cell('d', 2)], [{ blocks: [] }]] }])['word/document.xml'];
  assert.strictEqual((d.match(/<w:gridCol /g) || []).length, 3);
  assert.strictEqual((d.match(/<w:tr>/g) || []).length, 3);
  assert.strictEqual((d.match(/<w:tc>/g) || []).length, 8);
  assert.ok(d.includes('<w:gridSpan w:val="2"/>'));
  assert.ok(/<\/w:tbl><w:p\/>/.test(d));
});
t('immagine: file in media/, relazione, tipo di contenuto, dimensioni limitate a 600 px', () => {
  const f = files([{ t: 'img', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), w: 1200, h: 600 }, { t: 'img', mime: 'image/jpeg', bytes: new Uint8Array([4]), w: 100, h: 50 }]);
  assert.ok(f['word/media/image1.png'] && f['word/media/image2.jpeg']);
  assert.ok(f['word/_rels/document.xml.rels'].includes('Target="media/image1.png"') && f['word/_rels/document.xml.rels'].includes('Target="media/image2.jpeg"'));
  assert.ok(f['[Content_Types].xml'].includes('Extension="png"') && f['[Content_Types].xml'].includes('Extension="jpeg"'));
  assert.ok(f['word/document.xml'].includes('cx="' + 600 * 9525 + '" cy="' + 300 * 9525 + '"'));
  assert.ok(f['word/document.xml'].includes('r:embed="rIdImg2"'));
  assert.deepStrictEqual(L.imgSize({ w: 100, h: 50 }), [100, 50]);
});
t('testo con caratteri XML pericolosi nel documento', () => {
  const d = files([P('<script>&"x"</script>')])['word/document.xml'];
  assert.ok(d.includes('&lt;script&gt;&amp;&quot;x&quot;&lt;/script&gt;'));
});
t('modelText: paragrafi, elenchi numerati, tabelle', () => {
  const li = (txt, ord, list) => ({ t: 'li', ord, list, level: 0, runs: [{ text: txt }] });
  const txt = C.modelText([P('Titolo', { style: 'h1' }), li('uno', true, 1), li('due', true, 1), li('x', false, 2), { t: 'tbl', rows: [[{ blocks: [P('a')] }, { blocks: [P('b')] }]] }]);
  assert.strictEqual(txt, 'Titolo\n1. uno\n2. due\n- x\na | b');
});
t('wrapRuns: va a capo alle parole e rispetta la larghezza', () => {
  const lines = L.wrapRuns([{ text: 'uno due tre quattro' }], 50, 10, false, measure, (s) => s); // 10 caratteri per riga
  assert.deepStrictEqual(lines.map((l) => l.segs.map((s) => s.text).join('')), ['uno due', 'tre', 'quattro']);
  lines.forEach((l) => assert.ok(l.w <= 50));
});
t('wrapRuns: parola più lunga della riga viene spezzata', () => {
  const lines = L.wrapRuns([{ text: 'abcdefghijklmnop' }], 50, 10, false, measure, (s) => s);
  assert.deepStrictEqual(lines.map((l) => l.segs[0].text), ['abcdefghij', 'klmnop']);
});
t('wrapRuns: stili diversi nella stessa riga e a capo forzato', () => {
  const lines = L.wrapRuns([{ text: 'a ' }, { text: 'b', b: true }, { br: true }, { text: 'c' }], 500, 10, false, measure, (s) => s);
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(lines[0].segs.map((s) => s.st), ['r', 'b']);
  assert.strictEqual(lines[0].segs.map((s) => s.text).join(''), 'a b');
});
t('wrapRuns: paragrafo vuoto = una riga vuota', () => assert.strictEqual(L.wrapRuns([], 100, 10, false, measure, (s) => s).length, 1));
t('layout: più pagine quando il testo non entra', () => {
  const m = Array.from({ length: 80 }, (_, i) => P('Riga ' + i));
  const r = C.layout(m, measure, null, { pw: 300, ph: 300, m: 20 });
  assert.ok(r.pages.length > 1);
  r.pages.forEach((pg) => pg.forEach((it) => { if (it.k === 't') assert.ok(it.y >= 20 - 0.01 && it.y + it.size * 1.3 <= 280 + 0.01, 'y ' + it.y); }));
  assert.strictEqual(r.pages.flatMap(texts).length, 80);
});
t('layout: allineamento al centro e a destra', () => {
  const r = C.layout([P('abcd', { align: 'center' }), P('abcd', { align: 'right' })], measure, null, { pw: 300, ph: 300, m: 20 });
  const [c, rt] = r.pages[0].filter((i) => i.k === 't'); // larghezza testo 22; area 260
  assert.ok(Math.abs(c.x - (20 + (260 - 22) / 2)) < 0.01);
  assert.ok(Math.abs(rt.x - (20 + 260 - 22)) < 0.01);
});
t('layout: titoli più grandi e numerazione elenco che riparte', () => {
  const li = (txt, list) => ({ t: 'li', ord: true, list, level: 0, runs: [{ text: txt }] });
  const r = C.layout([P('T', { style: 'h1' }), li('a', 1), li('b', 1), P('x'), li('c', 2)], measure, null, { pw: 400, ph: 600, m: 20 });
  const items = r.pages[0].filter((i) => i.k === 't');
  assert.strictEqual(items[0].size, 20); assert.strictEqual(items[0].st, 'b');
  assert.deepStrictEqual(items.filter((i) => /^\d\.$/.test(i.text)).map((i) => i.text), ['1.', '2.', '1.']);
});
t('layout: tabella = testo nelle celle + 4 linee per cella; riga che non entra va a pagina nuova', () => {
  const cell = (s) => ({ blocks: [P(s)] });
  const r = C.layout([{ t: 'tbl', rows: [[cell('uno'), cell('due')]] }], measure, null, { pw: 300, ph: 300, m: 20 });
  assert.strictEqual(r.pages[0].filter((i) => i.k === 'l').length, 8);
  assert.deepStrictEqual(texts(r.pages[0]), ['uno', 'due']);
  const rows = Array.from({ length: 40 }, (_, i) => [cell('r' + i)]);
  const big = C.layout([{ t: 'tbl', rows }], measure, null, { pw: 300, ph: 300, m: 20 });
  assert.ok(big.pages.length > 1);
  big.pages.forEach((pg) => pg.filter((i) => i.k === 'l').forEach((l) => assert.ok(l.y2 <= 280 + 0.01)));
});
t('layout: immagine ridotta alla pagina e spostata se non entra', () => {
  const img = { t: 'img', mime: 'image/png', bytes: new Uint8Array(1), w: 2000, h: 1000 };
  const r = C.layout([P('x'), img, img], measure, null, { pw: 300, ph: 300, m: 20 });
  const ims = r.pages.flatMap((p) => p.filter((i) => i.k === 'i'));
  assert.strictEqual(ims.length, 2);
  ims.forEach((i) => { assert.ok(i.w <= 260.01 && i.h <= 260.01); assert.ok(Math.abs(i.w / i.h - 2) < 0.01); });
  assert.ok(r.pages.length >= 2);
});
t('layout: documento vuoto = una pagina senza errori', () => assert.strictEqual(C.layout([], measure, null).pages.length, 1));
console.log(n + ' test unitari Word superati');
