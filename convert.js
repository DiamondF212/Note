/* Conversioni note ↔ documenti — logica pura (nessun DOM), si prova da sola in Node.
   Nota → Word: titolo (T1) + testo a paragrafi, o elenco puntato (voci spuntate barrate).
   Nota → Excel: un foglio per nota; liste = colonne «Fatto» / «Voce», testo = una riga per paragrafo.
   Excel → nota lista: da una colonna (o dalla selezione) a una lista di voci; con 2 colonne, la prima può essere «Fatto». */
(function (N) {
  'use strict';

  const DONE_RE = /^(s[iì]|vero|true|x|✓|✔|1)$/i, NOT_RE = /^(no|falso|false|0)?$/i;
  const text = (s) => String(s === null || s === undefined ? '' : s);
  const items = (n) => (n.items || []).filter((i) => text(i.t).trim());
  const title = (n, k) => text(n.title).trim() || 'Nota ' + (k + 1);

  function noteToWord(notes) {
    const out = [];
    notes.forEach((n, k) => {
      out.push({ t: 'p', style: 'h1', align: 'left', runs: [{ text: title(n, k) }] });
      if (n.kind === 'list') {
        items(n).forEach((i) => out.push({ t: 'li', ord: false, list: 1, level: 0, align: 'left', runs: [i.done ? { text: text(i.t), s: true } : { text: text(i.t) }] }));
      } else {
        const lines = text(n.body).replace(/\r/g, '').split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        lines.forEach((l) => out.push({ t: 'p', style: 'n', align: 'left', runs: l ? [{ text: l }] : [] }));
      }
    });
    return out.length ? out : [{ t: 'p', style: 'n', align: 'left', runs: [] }];
  }

  // X = N.xlsxCore
  function noteToSheets(notes, X) {
    const model = { sheets: [], warnings: [] };
    notes.forEach((n, k) => {
      const sh = X.newSheet(X.cleanSheetName(title(n, k), model.sheets.map((s) => s.name)));
      const put = (r, c, cell) => sh.cells.set(X.key(r, c), cell);
      if (n.kind === 'list') {
        put(0, 0, { v: 'Fatto', b: true }); put(0, 1, { v: 'Voce', b: true });
        items(n).forEach((i, r) => { put(r + 1, 0, { v: i.done ? 'Sì' : 'No', al: 'center' }); put(r + 1, 1, { v: text(i.t) }); });
        sh.colW = { 0: 70, 1: 320 };
      } else {
        let r = 0;
        if (text(n.title).trim()) put(r++, 0, { v: text(n.title).trim(), b: true });
        const lines = text(n.body).replace(/\r/g, '').split('\n');
        while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
        lines.forEach((l) => { if (l) put(r, 0, { v: l }); r++; });
        sh.colW = { 0: 420 };
      }
      const u = X.usedRange(sh);
      sh.rows = Math.max(40, u.rows + 20);
      model.sheets.push(sh);
    });
    if (!model.sheets.length) model.sheets.push(X.newSheet('Foglio 1'));
    return model;
  }

  // sel = { r1, r2, c1, c2 } oppure null (= tutta la colonna c1 del foglio)
  function itemsFromCells(model, si, sel, X) {
    const sh = model.sheets[si], calc = X.createCalc(model), u = X.usedRange(sh);
    const g = sel || { r1: 0, r2: Math.max(0, u.rows - 1), c1: 0, c2: 0 };
    const r2 = Math.min(g.r2, Math.max(0, u.rows - 1));
    const show = (r, c) => { const cell = sh.cells.get(X.key(r, c)); return cell ? X.formatValue(calc.get(si, r, c), cell.nf).trim() : ''; };
    const two = g.c2 > g.c1;
    let flagCol = -1, textCol = g.c1;
    if (two) {
      const vals = [];
      for (let r = g.r1; r <= r2; r++) { const v = show(r, g.c1); if (v) vals.push(v); }
      const body = vals.filter((v) => !/^(fatto|done)$/i.test(v));
      if (body.length && body.every((v) => DONE_RE.test(v) || NOT_RE.test(v))) { flagCol = g.c1; textCol = g.c1 + 1; }
    }
    const out = [];
    for (let r = g.r1; r <= r2; r++) {
      const t = show(r, textCol);
      if (!t) continue;
      if (flagCol >= 0 && r === g.r1 && /^(fatto|done)$/i.test(show(r, flagCol)) && /^(voce|item|attivit[àa])$/i.test(t)) continue; // riga di intestazione
      out.push({ t: t.slice(0, 500), done: flagCol >= 0 ? DONE_RE.test(show(r, flagCol)) : false });
    }
    return out;
  }

  N.convert = { noteToWord, noteToSheets, itemsFromCells, _logic: { DONE_RE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.convert;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
