/* Excel — editor di fogli .xlsx (offline). Si apre da Documenti (tocca un file Excel o + → Nuovo Excel).
   Lettura/scrittura con ExcelJS (vendor/exceljs.min.js), logica in xlsx_core.js (N.xlsxCore).
   Griglia a celle disegnata solo per la parte visibile, più fogli, barra della formula, formule di base
   (SOMMA, MEDIA, MIN, MAX, CONTA.NUMERI, CONTA.VALORI, SE, E, O, NON, ARROTONDA, ASS, RADQ, POTENZA, RESTO, INT, PRODOTTO,
   CONCATENA, LUNGHEZZA, MAIUSC, MINUSC, SOMMA.SE, CONTA.SE, SE.ERRORE, OGGI), formati (grassetto, corsivo, allineamento,
   numero/percentuale/euro/data), righe e colonne, annulla/ripeti.
   Limiti onesti: un .xlsx importato NON viene sovrascritto — le modifiche vanno in una copia «Nome (modificato)»;
   del file originale si conservano valori, formule, nomi dei fogli, larghezze, grassetto/corsivo/allineamento/formato numero;
   si perdono colori, bordi, celle unite (separate), grafici, immagini, macro, formattazione condizionale e convalide;
   le funzioni non elencate mostrano l'ultimo risultato salvato nel file finché la cella non si modifica. */
(function (N) {
  'use strict';

  const C = () => N.xlsxCore;
  const ROW_H = 36, HEAD_H = 30, ROWHEAD_W = 46, DEF_W = 96, MIN_W = 40, MAX_W = 400, UNDO_MAX = 60, MAX_RANGE = 20000;

  async function openXlsx(d, A) {
    const h = A.h, X = C();
    await A.lib('exceljs');
    let model;
    try { model = await X.readXlsx(window.ExcelJS, d.data.slice(0)); } catch (e) { console.error(e); throw new Error('file Excel non leggibile'); }
    return start(d, A, model);
  }

  function start(d, A, model) {
    const h = A.h, X = C(), K = X.K;
    let target = d, dirty = false, dead = false, chain = Promise.resolve();
    let si = 0, calc = X.createCalc(model);
    let sel = { r: 0, c: 0, r2: 0, c2: 0 }, extend = false, inpDirty = false, raf = 0;
    const undo = [], redo = [];
    let colX = [0];
    const sh = () => model.sheets[si];

    /* ----- misure ----- */
    function measure() {
      const S = sh(); colX = [0];
      for (let c = 0; c < S.cols; c++) colX.push(colX[c] + (S.colW[c] || DEF_W));
      sizer.style.width = colX[S.cols] + 'px';
      sizer.style.height = S.rows * ROW_H + 'px';
      colIn.style.width = colX[S.cols] + 'px';
      rowIn.style.height = S.rows * ROW_H + 'px';
    }
    function colAt(x) {
      let lo = 0, hi = colX.length - 2;
      if (x <= 0) return 0;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (colX[mid] <= x) lo = mid; else hi = mid - 1; }
      return lo;
    }
    const range = () => ({ r1: Math.min(sel.r, sel.r2), r2: Math.max(sel.r, sel.r2), c1: Math.min(sel.c, sel.c2), c2: Math.max(sel.c, sel.c2) });
    const single = () => sel.r === sel.r2 && sel.c === sel.c2;
    const cellAt = (r, c) => sh().cells.get(r * K + c) || null;

    /* ----- modifiche con annulla/ripeti ----- */
    function snapshot() { return { si, sel: Object.assign({}, sel), sheets: model.sheets.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, cells: new Map(s.cells), colW: Object.assign({}, s.colW) })) }; }
    function restoreSnap(sn) {
      model.sheets = sn.sheets.map((s) => ({ name: s.name, rows: s.rows, cols: s.cols, cells: new Map(s.cells), colW: Object.assign({}, s.colW) }));
      si = Math.min(sn.si, model.sheets.length - 1);
      sel = Object.assign({}, sn.sel);
    }
    function pushUndo(e) { undo.push(e); if (undo.length > UNDO_MAX) undo.shift(); redo.length = 0; paintBar(); }
    function applyChanges(sIdx, changes, useAfter) {
      const cells = model.sheets[sIdx].cells;
      for (const ch of changes) { const v = useAfter ? ch.after : ch.before; if (v) cells.set(ch.k, v); else cells.delete(ch.k); }
    }
    // changes: [{k, after}] — registra «prima» e applica
    function change(list) {
      const changes = [];
      for (const { k, after } of list) {
        const before = sh().cells.get(k) || null;
        if (before === after) continue;
        changes.push({ k, before, after });
      }
      if (!changes.length) return false;
      applyChanges(si, changes, true);
      pushUndo({ kind: 'cells', si, changes });
      touched();
      return true;
    }
    // operazione che cambia la struttura (righe, colonne, fogli): si salva la situazione intera prima e dopo
    function structural(fn) {
      const before = snapshot();
      fn();
      pushUndo({ kind: 'snap', before, after: snapshot() });
      touched(true);
      fillInput();
    }
    function touched(struct) { dirty = true; calc = X.createCalc(model); if (struct) { measure(); drawTabs(); } paint(); }
    function doUndo(from, to, useAfter) {
      flushEdit();
      const e = from.pop();
      if (!e) return;
      if (e.kind === 'cells') {
        applyChanges(e.si, e.changes, useAfter);
        si = e.si; const k = e.changes[0].k; sel = { r: X.rowOf(k), c: X.colOf(k), r2: X.rowOf(k), c2: X.colOf(k) };
      } else restoreSnap(useAfter ? e.after : e.before);
      to.push(e); dirty = true; calc = X.createCalc(model);
      measure(); drawTabs(); fillInput(); reveal(sel.r, sel.c); paint();
    }

    /* ----- scrittura di una cella ----- */
    function styleOf(cell) { const st = {}; if (cell) for (const k of ['b', 'i', 'al', 'nf']) if (cell[k] !== undefined) st[k] = cell[k]; return st; }
    function commit(r, c, text) {
      const old = cellAt(r, c);
      if (text === X.editText(old)) return true;
      let p;
      try { p = X.parseInput(text); } catch (e) { A.toast(e.syntax ? (/^Formula/.test(e.message) ? e.message : 'Formula non valida: ' + e.message) : 'Formula non valida', 4200); return false; }
      const st = styleOf(old);
      let nc = null;
      if (p) { nc = Object.assign({}, st, p); if (p.nf && st.nf && !/^general$/i.test(st.nf)) nc.nf = st.nf; }
      else if (Object.keys(st).length) nc = st;
      change([{ k: r * K + c, after: nc }]);
      return true;
    }
    function flushEdit() {
      if (!inpDirty) return true;
      inpDirty = false;
      return commit(sel.r, sel.c, inp.value);
    }

    /* ----- formattazione su selezione ----- */
    function cellsInRange(create) {
      const g = range(), out = [];
      const n = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
      if (n > MAX_RANGE) { A.toast('Selezione troppo grande'); return null; }
      for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
        const k = r * K + c, cell = sh().cells.get(k) || null;
        if (cell || create) out.push([k, cell]);
      }
      return out;
    }
    function restyle(mut) {
      flushEdit();
      const list = cellsInRange(true);
      if (!list) return;
      change(list.map(([k, cell]) => {
        const nc = Object.assign({}, cell || {});
        mut(nc);
        const keep = Object.keys(nc).some((x) => nc[x] !== undefined);
        for (const x of Object.keys(nc)) if (nc[x] === undefined) delete nc[x];
        return { k, after: keep ? nc : null };
      }));
    }
    function toggle(prop) { const cur = cellAt(sel.r, sel.c); const on = !(cur && cur[prop]); restyle((x) => { x[prop] = on ? true : undefined; }); }
    function align(al) { const cur = cellAt(sel.r, sel.c); const same = cur && cur.al === al; restyle((x) => { x.al = same ? undefined : al; }); }
    function clearRange() {
      flushEdit();
      const list = cellsInRange(false);
      if (!list) return;
      inp.value = ''; inpDirty = false;
      change(list.map(([k, cell]) => ({ k, after: Object.keys(styleOf(cell)).length ? styleOf(cell) : null })));
      fillInput();
    }

    /* ----- selezione e spostamenti ----- */
    function grow(r, c) {
      const S = sh(); let ch = false;
      if (r >= S.rows - 2 && S.rows < X.MAXR) { S.rows = Math.min(X.MAXR, S.rows + 20); ch = true; }
      if (c >= S.cols - 1 && S.cols < X.MAXC) { S.cols = Math.min(X.MAXC, S.cols + 4); ch = true; }
      if (ch) measure();
    }
    function reveal(r, c) {
      const vw = scroll.clientWidth, vh = scroll.clientHeight, st = scroll.scrollTop, sl = scroll.scrollLeft;
      const top = r * ROW_H, bottom = top + ROW_H, left = colX[c], right = colX[c + 1];
      if (top < st) scroll.scrollTop = top; else if (bottom > st + vh) scroll.scrollTop = bottom - vh;
      if (left < sl) scroll.scrollLeft = left; else if (right > sl + vw) scroll.scrollLeft = right - vw;
    }
    function fillInput() { inp.value = X.editText(cellAt(sel.r, sel.c)); inpDirty = false; }
    function select(r, c, keepExt) {
      if (!flushEdit()) return;
      const S = sh();
      r = Math.max(0, Math.min(r, S.rows - 1)); c = Math.max(0, Math.min(c, S.cols - 1));
      grow(r, c);
      sel = { r, c, r2: r, c2: c };
      if (!keepExt) extend = false;
      fillInput(); reveal(r, c); paint();
    }
    function tap(r, c) {
      if (extend) { if (!flushEdit()) return; sel.r2 = r; sel.c2 = c; extend = false; paint(); return; }
      if (single() && sel.r === r && sel.c === c) { inp.focus(); return; }
      select(r, c);
    }

    /* ----- disegno ----- */
    const colAtScroll = (clientX) => colAt(clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft);
    function paint() { if (!raf) raf = requestAnimationFrame(render); }
    function render() {
      raf = 0;
      if (dead) return;
      const S = sh(), vw = scroll.clientWidth || 300, vh = scroll.clientHeight || 400, sl = scroll.scrollLeft, st = scroll.scrollTop;
      const r0 = Math.max(0, Math.floor(st / ROW_H) - 1), r1 = Math.min(S.rows - 1, Math.ceil((st + vh) / ROW_H) + 1);
      const c0 = Math.max(0, colAt(sl) - 1), c1 = Math.min(S.cols - 1, colAt(sl + vw) + 1);
      const g = range();
      const cf = document.createDocumentFragment(), hf = document.createDocumentFragment(), rf = document.createDocumentFragment();
      for (let c = c0; c <= c1; c++) hf.append(h('div', { class: 'xl-ch' + (c >= g.c1 && c <= g.c2 ? ' on' : ''), 'data-ch': String(c), style: { left: colX[c] + 'px', width: (colX[c + 1] - colX[c]) + 'px' } }, X.colName(c)));
      for (let r = r0; r <= r1; r++) {
        rf.append(h('div', { class: 'xl-rh' + (r >= g.r1 && r <= g.r2 ? ' on' : ''), 'data-rh': String(r), style: { top: r * ROW_H + 'px' } }, String(r + 1)));
        for (let c = c0; c <= c1; c++) {
          const cell = S.cells.get(r * K + c);
          let txt = '', cls = 'xl-c';
          if (cell) {
            const v = calc.get(si, r, c);
            txt = X.formatValue(v, cell.nf);
            const al = cell.al || (typeof v === 'number' ? 'right' : (typeof v === 'boolean' || X.isErr(v)) ? 'center' : 'left');
            cls += ' al-' + al + (cell.b ? ' b' : '') + (cell.i ? ' i' : '') + (X.isErr(v) ? ' err' : '');
          }
          cf.append(h('div', { class: cls, 'data-r': String(r), 'data-c': String(c), style: { left: colX[c] + 'px', top: r * ROW_H + 'px', width: (colX[c + 1] - colX[c]) + 'px' } }, txt));
        }
      }
      cellsEl.replaceChildren(cf); colIn.replaceChildren(hf); rowIn.replaceChildren(rf);
      colIn.style.transform = 'translateX(' + (-sl) + 'px)'; rowIn.style.transform = 'translateY(' + (-st) + 'px)';
      Object.assign(rangeEl.style, { left: colX[g.c1] + 'px', top: g.r1 * ROW_H + 'px', width: (colX[g.c2 + 1] - colX[g.c1]) + 'px', height: (g.r2 - g.r1 + 1) * ROW_H + 'px', display: single() ? 'none' : 'block' });
      Object.assign(curEl.style, { left: colX[sel.c] + 'px', top: sel.r * ROW_H + 'px', width: (colX[sel.c + 1] - colX[sel.c]) + 'px', height: ROW_H + 'px' });
      nameEl.textContent = single() ? X.refName(sel.r, sel.c) : X.refName(g.r1, g.c1) + ':' + X.refName(g.r2, g.c2);
      paintBar();
    }

    /* ----- barra degli strumenti ----- */
    const bar = h('div', { class: 'word-bar xl-bar', role: 'toolbar', 'aria-label': 'Formattazione' });
    const btns = [];
    const add = (key, label, fn, opts) => {
      opts = opts || {};
      const b = h('button', { type: 'button', class: 'wbtn' + (opts.cls ? ' ' + opts.cls : ''), 'data-x': key, 'aria-label': opts.aria || label, onpointerdown: (e) => e.preventDefault(), onmousedown: (e) => e.preventDefault(), onclick: () => { fn(); }, html: opts.html || null }, opts.html ? null : label);
      btns.push([key, b, opts.on, opts.off]); bar.append(b); return b;
    };
    const sep = () => bar.append(h('span', { class: 'wsep' }));
    const cur = () => cellAt(sel.r, sel.c) || {};
    add('b', 'B', () => toggle('b'), { aria: 'Grassetto', cls: 'wb', on: () => !!cur().b });
    add('i', 'I', () => toggle('i'), { aria: 'Corsivo', cls: 'wi', on: () => !!cur().i });
    sep();
    const SVG_AL = { left: [[4, 6, 16], [4, 11, 10], [4, 16, 16]], center: [[4, 6, 16], [7, 11, 10], [4, 16, 16]], right: [[4, 6, 16], [10, 11, 10], [4, 16, 16]] };
    const alignIcon = (k) => '<svg class="i" viewBox="0 0 24 24" width="22" height="22">' + SVG_AL[k].map(([x, y, w]) => '<path d="M' + x + ' ' + y + 'h' + w + '"/>').join('') + '</svg>';
    [['left', 'Allinea a sinistra'], ['center', 'Centra'], ['right', 'Allinea a destra']].forEach(([k, aria]) => add('al-' + k, '', () => align(k), { aria, html: alignIcon(k), on: () => cur().al === k }));
    sep();
    add('nf', '123', () => nfSheet(), { aria: 'Formato numero' });
    add('rc', '', () => rcSheet(), { aria: 'Righe e colonne', html: A.I('grid', 22) });
    add('ext', '▭', () => { flushEdit(); extend = !extend; if (!extend) { sel.r2 = sel.r; sel.c2 = sel.c; } paint(); if (extend) A.toast('Tocca un’altra cella per estendere la selezione', 2600); }, { aria: 'Estendi selezione', on: () => extend });
    add('clear', '', () => clearRange(), { aria: 'Cancella contenuto', html: A.I('trash', 22) });
    sep();
    add('undo', '↶', () => doUndo(undo, redo, false), { aria: 'Annulla', off: () => !undo.length });
    add('redo', '↷', () => doUndo(redo, undo, true), { aria: 'Ripeti', off: () => !redo.length });
    function paintBar() { for (const [, b, on, off] of btns) { if (on) b.classList.toggle('on', !!on()); if (off) b.disabled = !!off(); } }

    /* ----- barra della formula ----- */
    const nameEl = h('span', { class: 'xl-name', 'data-xl-name': '1' }, 'A1');
    const inp = h('input', { type: 'text', class: 'xl-in', 'data-xl-input': '1', inputmode: 'text', enterkeyhint: 'done', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'Contenuto della cella' });
    const okBtn = h('button', { type: 'button', class: 'wbtn xl-ok', 'data-xl-ok': '1', 'aria-label': 'Conferma', html: A.I('check', 22), onpointerdown: (e) => e.preventDefault(), onmousedown: (e) => e.preventDefault(), onclick: () => { if (flushEdit()) { inp.blur(); } } });
    inp.addEventListener('input', () => { inpDirty = true; });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!flushEdit()) return; const g = range(); select(e.shiftKey ? sel.r - 1 : sel.r + 1, sel.c); if (document.activeElement !== inp) inp.focus(); }
      else if (e.key === 'Tab') { e.preventDefault(); if (!flushEdit()) return; select(sel.r, e.shiftKey ? sel.c - 1 : sel.c + 1); inp.focus(); }
      else if (e.key === 'Escape') { fillInput(); inp.blur(); }
    });
    const fx = h('div', { class: 'xl-fx' }, nameEl, inp, okBtn);

    /* ----- griglia ----- */
    const cellsEl = h('div', { class: 'xl-cells' });
    const rangeEl = h('div', { class: 'xl-range' }), curEl = h('div', { class: 'xl-cur', 'data-xl-cur': '1' });
    const sizer = h('div', { class: 'xl-sizer' }, cellsEl, rangeEl, curEl);
    const scroll = h('div', { class: 'xl-scroll', 'data-xl-scroll': '1' }, sizer);
    const colIn = h('div', { class: 'xl-colhead-in' }), rowIn = h('div', { class: 'xl-rowhead-in' });
    const grid = h('div', { class: 'xl-grid' },
      h('div', { class: 'xl-corner' }),
      h('div', { class: 'xl-colhead' }, colIn),
      h('div', { class: 'xl-rowhead' }, rowIn),
      scroll);
    scroll.addEventListener('scroll', () => {
      colIn.style.transform = 'translateX(' + (-scroll.scrollLeft) + 'px)'; rowIn.style.transform = 'translateY(' + (-scroll.scrollTop) + 'px)';
      paint();
    }, { passive: true });
    scroll.addEventListener('click', (e) => {
      const rect = scroll.getBoundingClientRect();
      const y = e.clientY - rect.top + scroll.scrollTop, r = Math.floor(y / ROW_H), c = colAt(e.clientX - rect.left + scroll.scrollLeft);
      const S = sh();
      if (r < 0 || r >= S.rows || c < 0 || c >= S.cols) return;
      tap(r, c);
    });
    colIn.addEventListener('click', (e) => {
      const el = e.target.closest('[data-ch]'); if (!el) return;
      const c = +el.dataset.ch;
      if (!flushEdit()) return;
      if (extend) { sel.c2 = c; sel.r2 = sh().rows - 1; extend = false; paint(); return; }
      sel = { r: 0, c, r2: sh().rows - 1, c2: c }; fillInput(); paint();
    });
    rowIn.addEventListener('click', (e) => {
      const el = e.target.closest('[data-rh]'); if (!el) return;
      const r = +el.dataset.rh;
      if (!flushEdit()) return;
      sel = { r, c: 0, r2: r, c2: sh().cols - 1 }; fillInput(); paint();
    });

    /* ----- schede dei fogli ----- */
    const tabs = h('div', { class: 'xl-tabs', 'data-xl-tabs': '1' });
    function drawTabs() {
      tabs.replaceChildren(...model.sheets.map((s, i) => h('button', { type: 'button', class: 'xl-tab' + (i === si ? ' on' : ''), 'data-sheet': String(i), onclick: () => switchSheet(i) }, s.name)),
        h('button', { type: 'button', class: 'xl-tab xl-addtab', 'data-xl-addsheet': '1', 'aria-label': 'Nuovo foglio', onclick: () => addSheet(), html: A.I('plus', 20) }));
    }
    function switchSheet(i) {
      if (i === si) return;
      if (!flushEdit()) return;
      si = i; sel = { r: 0, c: 0, r2: 0, c2: 0 }; extend = false;
      measure(); drawTabs(); fillInput(); scroll.scrollTop = 0; scroll.scrollLeft = 0; paint();
    }
    function addSheet() {
      flushEdit();
      structural(() => { model.sheets.push(X.newSheet(X.cleanSheetName('Foglio ' + (model.sheets.length + 1), model.sheets.map((s) => s.name)))); si = model.sheets.length - 1; sel = { r: 0, c: 0, r2: 0, c2: 0 }; });
      fillInput(); scroll.scrollTop = 0; scroll.scrollLeft = 0;
    }

    /* ----- finestre ----- */
    const row = (act, icon, text, sub, fn, cls) => h('button', { class: 'item' + (cls ? ' ' + cls : ''), 'data-act': act, onclick: async () => { await A.back(); fn(); } }, h('span', { html: A.I(icon, 22) }), h('span', null, text, sub ? h('small', null, sub) : null));
    function nfSheet() {
      flushEdit();
      const cur0 = cur().nf || 'General';
      const L = [['general', 'Generale', '1234,5'], ['num', 'Numero, 2 decimali', '1234,50'], ['int', 'Numero con migliaia', '1.235'], ['eur', 'Euro', '1.234,50 €'], ['pct', 'Percentuale', '12,50%'], ['date', 'Data', '03/11/2026']];
      A.openSheet('Formato numero', h('div', null, ...L.map(([k, t, ex]) => h('button', { class: 'item' + (X.NF[k] === cur0 ? ' on' : ''), 'data-nf': k, onclick: async () => { await A.back(); restyle((x) => { x.nf = k === 'general' ? undefined : X.NF[k]; }); } }, h('span', null, t, h('small', null, 'Esempio: ' + ex))))));
    }
    function rcSheet() {
      flushEdit();
      const g = range(), nr = g.r2 - g.r1 + 1, nc = g.c2 - g.c1 + 1;
      const rows = (n) => n === 1 ? 'riga' : n + ' righe', cols = (n) => n === 1 ? 'colonna' : n + ' colonne';
      A.openSheet('Righe e colonne', h('div', null,
        row('row-above', 'plus', 'Inserisci ' + rows(nr) + ' sopra', null, () => structural(() => { X.insertRows(model, si, g.r1, nr); sel = { r: g.r1, c: sel.c, r2: g.r1, c2: sel.c }; })),
        row('row-below', 'plus', 'Inserisci ' + rows(nr) + ' sotto', null, () => structural(() => { X.insertRows(model, si, g.r2 + 1, nr); sel = { r: g.r2 + 1, c: sel.c, r2: g.r2 + 1, c2: sel.c }; })),
        row('row-del', 'trash', 'Elimina ' + rows(nr), null, () => { if (sh().rows - nr < 1) return; structural(() => { X.deleteRows(model, si, g.r1, nr); const r = Math.min(g.r1, sh().rows - 1); sel = { r, c: sel.c, r2: r, c2: sel.c }; }); }, 'danger'),
        row('col-left', 'plus', 'Inserisci ' + cols(nc) + ' a sinistra', null, () => structural(() => { X.insertCols(model, si, g.c1, nc); sel = { r: sel.r, c: g.c1, r2: sel.r, c2: g.c1 }; })),
        row('col-right', 'plus', 'Inserisci ' + cols(nc) + ' a destra', null, () => structural(() => { X.insertCols(model, si, g.c2 + 1, nc); sel = { r: sel.r, c: g.c2 + 1, r2: sel.r, c2: g.c2 + 1 }; })),
        row('col-del', 'trash', 'Elimina ' + cols(nc), null, () => { if (sh().cols - nc < 1) return; structural(() => { X.deleteCols(model, si, g.c1, nc); const c = Math.min(g.c1, sh().cols - 1); sel = { r: sel.r, c, r2: sel.r, c2: c }; }); }, 'danger'),
        row('col-wider', 'plus', 'Colonna più larga', null, () => resize(g, 28)),
        row('col-narrower', 'down', 'Colonna più stretta', null, () => resize(g, -28))));
    }
    function resize(g, delta) {
      structural(() => { for (let c = g.c1; c <= g.c2; c++) sh().colW[c] = Math.max(MIN_W, Math.min(MAX_W, (sh().colW[c] || DEF_W) + delta)); });
    }
    function renameSheet() {
      flushEdit();
      const input = h('input', { type: 'text', class: 'xl-rename', 'data-xl-rename': '1', value: sh().name, maxlength: '31', autocomplete: 'off', style: { width: '100%', boxSizing: 'border-box', padding: '12px', borderRadius: '10px', border: '1px solid var(--line)', background: 'var(--surface2)', color: 'var(--ink)', fontSize: '16px' } });
      const ok = async () => {
        const name = X.cleanSheetName(input.value, model.sheets.filter((_, i) => i !== si).map((s) => s.name));
        await A.back();
        if (name !== sh().name) structural(() => X.renameSheet(model, si, name));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      A.openSheet('Rinomina foglio', h('div', null, input, h('button', { class: 'btn pri', 'data-xl-rename-ok': '1', style: { width: '100%', marginTop: '16px' }, onclick: ok }, 'Rinomina')));
    }
    function deleteSheet() {
      if (model.sheets.length < 2) return A.toast('Deve restare almeno un foglio');
      if (!confirm('Eliminare il foglio «' + sh().name + '»? Le formule che lo usano diventeranno errori.')) return;
      flushEdit();
      structural(() => { X.removeSheet(model, si); si = Math.max(0, Math.min(si, model.sheets.length - 1)); sel = { r: 0, c: 0, r2: 0, c2: 0 }; });
      fillInput();
    }
    function moreSheet() {
      flushEdit();
      A.openSheet('Altro', h('div', null,
        row('xlsx', 'share', 'Esporta .xlsx', 'Salva e condividi il file Excel', async () => { await save(); A.exportFile(await A.getDoc(target.id)); }),
        row('note', 'notes', 'Salva il foglio come nota', 'Testo con le colonne separate da tabulazioni', () => { const t = X.sheetText(model, si, calc); if (!t) return A.toast('Il foglio è vuoto'); A.saveAsNote(target.name + ' — ' + sh().name, t); }),
        row('list', 'list', 'Crea una lista da colonna', 'Dalla selezione o dalla colonna della cella; con «Fatto» + voce spunta le fatte', () => {
          const g = range();
          const items = N.convert.itemsFromCells(model, si, single() ? { r1: 0, r2: sh().rows - 1, c1: sel.c, c2: sel.c } : { r1: g.r1, r2: g.r2, c1: g.c1, c2: g.c2 }, X);
          if (!items.length) return A.toast('Nessuna voce da trasformare in lista');
          A.saveAsNote(sh().name, '', items);
          A.toast('Lista creata con ' + items.length + (items.length === 1 ? ' voce' : ' voci'), 3200);
        }),
        row('newsheet', 'plus', 'Nuovo foglio', null, () => addSheet()),
        row('rename', 'edit', 'Rinomina foglio', sh().name, () => renameSheet()),
        row('delsheet', 'trash', 'Elimina foglio', null, () => deleteSheet(), 'danger')));
    }

    /* ----- salvataggio (un .xlsx importato non si sovrascrive: copia «Nome (modificato)») ----- */
    function save() {
      flushEdit();
      chain = chain.then(async () => {
        if (!dirty) return;
        dirty = false;
        try {
          const data = await X.buildXlsx(window.ExcelJS, model);
          if (target.origin !== 'note') {
            const c = await A.addDoc('xlsx', target.name + ' (modificato)', data);
            c.origin = 'note'; await A.save(c);
            target = c; if (!dead) scr.setTitle(c.name);
            A.toast('Copia creata: «' + c.name + '». L’originale non è stato toccato.', 4200);
          } else {
            target.data = data; await A.save(target);
            if (!dead) A.toast('Salvato');
          }
        } catch (e) { dirty = true; console.error(e); A.toast('Impossibile salvare: ' + (e.message || e), 4500); }
      });
      return chain;
    }

    const cleanup = () => { dead = true; if (raf) cancelAnimationFrame(raf); flushEdit(); if (dirty) save(); };
    const scr = A.screen(d.name, { onClose: cleanup });
    scr.actions.append(
      A.ibtn('check', () => { flushEdit(); if (!dirty) return A.toast('Nessuna modifica da salvare'); save(); }, 'Salva', 'xlsx-save'),
      A.ibtn('more', () => moreSheet(), 'Altro'));
    scr.body.classList.add('xl-body');
    scr.body.append(bar, fx, grid, tabs);
    measure(); drawTabs(); fillInput(); paint();
    if (model.warnings.length) A.toast(model.warnings.join(' · '), 5200);
    const api = { setSize(rows, cols) { sh().rows = rows; sh().cols = cols; measure(); paint(); }, model: () => model, sel: () => Object.assign({}, sel), sheetIndex: () => si, save, isDirty: () => dirty, calc: () => calc };
    N.xlsxView._cur = api;
    return api;
  }

  async function createXlsx(A) {
    await A.lib('exceljs');
    const data = await C().buildXlsx(window.ExcelJS, C().newModel());
    const d = await A.addDoc('xlsx', 'Nuovo foglio di calcolo', data);
    d.origin = 'note'; await A.save(d);
    await openXlsx(d, A);
  }

  N.xlsxView = { open: openXlsx, create: createXlsx, _cur: null };
  if (N.docs && N.docs.register) N.docs.register('xlsx', { open: (d, A) => openXlsx(d, A), create: (A) => createXlsx(A) });
  if (typeof module !== 'undefined' && module.exports) module.exports = N.xlsxView;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
