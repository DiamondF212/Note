/* Documenti — archivio locale di PDF, Word (.docx) ed Excel (.xlsx).
   Questo file contiene le fondamenta: elenco, importazione, rinomina, esportazione, eliminazione,
   il caricamento "su richiesta" delle librerie (cartella vendor/) e il registro degli editor.
   Gli editor veri (PDF, Word, Excel) si collegano qui con N.docs.register(tipo, {...}).
   Tutto resta sul dispositivo: nessun file lascia mai il telefono. */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA (testabile da sola)
     ===================================================================== */

  const TYPES = {
    pdf: { label: 'PDF', ext: '.pdf', mime: 'application/pdf', color: '#e5484d' },
    docx: { label: 'Word', ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', color: '#4f8cff' },
    xlsx: { label: 'Excel', ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', color: '#2fb26b' }
  };

  // Riconosce il tipo guardando i primi byte e l'estensione (non ci si può fidare solo del nome).
  function detectType(name, bytes) {
    const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
    const head = (i, s) => s.split('').every((c, k) => u[i + k] === c.charCodeAt(0));
    const lower = String(name || '').toLowerCase();
    // il PDF può avere qualche byte di troppo prima dell'intestazione
    for (let i = 0; i < Math.min(1024, u.length - 4); i++) if (head(i, '%PDF')) return 'pdf';
    if (head(0, 'PK')) {
      if (lower.endsWith('.docx') || lower.endsWith('.dotx')) return 'docx';
      if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return 'xlsx';
    }
    return null;
  }

  function stripExt(name) { return String(name || '').replace(/\.(pdf|docx|dotx|xlsx|xlsm)$/i, ''); }

  function cleanName(s) {
    return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function fileName(d) { return (cleanName(d.name) || 'Documento') + TYPES[d.type].ext; }

  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0).replace('.', ',') + ' KB';
    return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
  }

  // Nome libero: "Relazione", "Relazione (2)", "Relazione (3)"...
  function uniqueName(base, taken) {
    const set = new Set(taken.map((x) => x.toLowerCase()));
    const b = cleanName(base) || 'Documento';
    if (!set.has(b.toLowerCase())) return b;
    for (let i = 2; i < 10000; i++) if (!set.has((b + ' (' + i + ')').toLowerCase())) return b + ' (' + i + ')';
    return b + ' ' + Date.now();
  }

  /* =====================================================================
     2) CARICAMENTO LIBRERIE SU RICHIESTA
     ===================================================================== */

  const LIBS = {
    pdfjs: { files: ['vendor/pdfjs/pdf.min.js'], ready: () => window.pdfjsLib, after: () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; } },
    pdflib: { files: ['vendor/pdf-lib.min.js', 'vendor/fontkit.umd.min.js'], ready: () => window.PDFLib && window.fontkit },
    mammoth: { files: ['vendor/mammoth.browser.min.js'], ready: () => window.mammoth },
    exceljs: { files: ['vendor/exceljs.min.js'], ready: () => window.ExcelJS }
  };
  const loading = {};

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Impossibile caricare ' + src));
      document.head.append(s);
    });
  }

  function lib(name) {
    const L = LIBS[name];
    if (!L) return Promise.reject(new Error('Libreria sconosciuta: ' + name));
    if (L.ready()) return Promise.resolve();
    if (!loading[name]) {
      loading[name] = (async () => {
        for (const f of L.files) await loadScript(f);
        if (!L.ready()) throw new Error('Libreria non inizializzata: ' + name);
        if (L.after) L.after();
      })().catch((e) => { delete loading[name]; throw e; });
    }
    return loading[name];
  }

  /* =====================================================================
     3) INTERFACCIA
     ===================================================================== */

  let ctx = null;
  const editors = {}; // tipo -> { open(doc, api), create(api) }
  const state = { docs: [], filter: 'all', ui: null };

  const api = {
    lib, loadScript, detectType, fmtSize, fileName, uniqueName, TYPES,
    async save(d) { d.updated = Date.now(); d.size = d.data ? d.data.byteLength : d.size; await N.db.docs.put(d); const i = state.docs.findIndex((x) => x.id === d.id); if (i >= 0) state.docs[i] = d; else state.docs.push(d); redraw(); return d; },
    exportFile(d) {
      ctx.download(new Blob([d.data], { type: TYPES[d.type].mime }), fileName(d));
    },
    // Schermo intero con barra in alto; il tasto Indietro di Android lo chiude.
    screen(title, opts) {
      opts = opts || {};
      const h = ctx.h;
      const titleEl = h('h2', { class: 'ds-title' }, title);
      const actions = h('div', { class: 'ds-actions' });
      const body = h('div', { class: 'ds-body' });
      const el = h('section', { class: 'docs-screen', role: 'dialog', 'aria-label': title },
        h('header', { class: 'ds-bar' }, ctx.ibtn('back', () => ctx.back(), 'Indietro'), titleEl, actions), body);
      document.body.append(el);
      let closed = false;
      const close = () => { if (closed) return; closed = true; el.remove(); if (opts.onClose) opts.onClose(); };
      ctx.pushLayer(close);
      return { el, body, actions, setTitle: (t) => { titleEl.textContent = t; }, close: () => ctx.back() };
    },
    toast: (m, ms) => ctx.toast(m, ms),
    h: (...a) => ctx.h(...a), I: (...a) => ctx.I(...a), ibtn: (...a) => ctx.ibtn(...a),
    openSheet: (...a) => ctx.openSheet(...a),
    back: () => ctx.back(),
    saveAsNote: (...a) => ctx.saveAsNote(...a)
  };

  async function load() {
    try { state.docs = (await N.db.docs.all()).sort((a, b) => b.updated - a.updated); } catch (e) { console.error(e); state.docs = []; }
  }

  async function importFiles(files) {
    let ok = 0, bad = 0;
    for (const f of files) {
      try {
        const data = await f.arrayBuffer();
        const type = detectType(f.name, data);
        if (!type) { bad++; continue; }
        const name = uniqueName(stripExt(f.name), state.docs.filter((d) => d.type === type).map((d) => d.name));
        const now = Date.now();
        await api.save({ id: ctx.uid(), type, name, size: data.byteLength, created: now, updated: now, data });
        ok++;
      } catch (e) { console.error(e); bad++; }
    }
    if (ok) ctx.toast(ok === 1 ? 'Documento importato' : ok + ' documenti importati');
    if (bad) ctx.toast(bad === 1 ? 'File non riconosciuto: servono PDF, Word (.docx) o Excel (.xlsx)' : bad + ' file non riconosciuti', 4200);
  }

  function pickFiles() {
    const input = ctx.h('input', { type: 'file', multiple: true, accept: '.pdf,.docx,.xlsx,application/pdf,' + TYPES.docx.mime + ',' + TYPES.xlsx.mime, class: 'hidden', 'data-docs-input': '1' });
    input.addEventListener('change', async () => { const fs = Array.from(input.files || []); input.remove(); if (fs.length) await importFiles(fs); });
    document.body.append(input);
    input.click();
  }

  async function openDoc(d) {
    const ed = editors[d.type];
    if (!ed) return ctx.toast('L’editor ' + TYPES[d.type].label + ' non è ancora disponibile', 3200);
    try {
      const full = await N.db.docs.get(d.id);
      if (!full) return ctx.toast('Documento non trovato');
      await ed.open(full, api);
    } catch (e) { console.error(e); ctx.toast('Impossibile aprire il documento: ' + (e.message || e), 4500); }
  }

  async function createDoc(type) {
    const ed = editors[type];
    if (!ed || !ed.create) return ctx.toast('La creazione di documenti ' + TYPES[type].label + ' non è ancora disponibile', 3200);
    try { await ed.create(api); } catch (e) { console.error(e); ctx.toast('Impossibile creare il documento: ' + (e.message || e), 4500); }
  }

  function newSheet() {
    const h = ctx.h;
    const sh = ctx.openSheet('Nuovo documento', h('div', null,
      ...['pdf', 'docx', 'xlsx'].map((t) => h('button', { class: 'item', 'data-new': t, onclick: async () => { await ctx.back(); createDoc(t); } },
        h('span', { class: 'dtype', style: { background: TYPES[t].color } }, TYPES[t].label.slice(0, 1)), h('span', null, 'Nuovo ' + TYPES[t].label))),
      h('button', { class: 'item', 'data-import': '1', onclick: async () => { await ctx.back(); pickFiles(); } },
        h('span', { html: ctx.I('down', 22) }), h('span', null, 'Importa file dal telefono', h('small', null, 'PDF, Word o Excel')))));
    return sh;
  }

  function rowMenu(d) {
    const h = ctx.h;
    ctx.openSheet(d.name, h('div', null,
      h('button', { class: 'item', 'data-act': 'open', onclick: async () => { await ctx.back(); openDoc(d); } }, h('span', { html: ctx.I('eye', 22) }), 'Apri'),
      h('button', { class: 'item', 'data-act': 'rename', onclick: async () => {
        await ctx.back();
        const nm = cleanName(prompt('Nuovo nome del documento', d.name));
        if (!nm || nm === d.name) return;
        const full = await N.db.docs.get(d.id); if (!full) return;
        full.name = uniqueName(nm, state.docs.filter((x) => x.type === d.type && x.id !== d.id).map((x) => x.name));
        await api.save(full);
      } }, h('span', { html: ctx.I('edit', 22) }), 'Rinomina'),
      h('button', { class: 'item', 'data-act': 'export', onclick: async () => { await ctx.back(); const full = await N.db.docs.get(d.id); if (full) api.exportFile(full); } }, h('span', { html: ctx.I('share', 22) }), 'Esporta / condividi'),
      h('button', { class: 'item danger', 'data-act': 'delete', onclick: async () => {
        await ctx.back();
        if (!confirm('Eliminare «' + d.name + '» per sempre? Non si può annullare.')) return;
        await N.db.docs.del(d.id);
        state.docs = state.docs.filter((x) => x.id !== d.id);
        redraw();
        ctx.toast('Documento eliminato');
      } }, h('span', { html: ctx.I('trash', 22) }), 'Elimina')));
  }

  function redraw() {
    const ui = state.ui;
    if (!ui || !ui.el.isConnected) return;
    const h = ctx.h;
    ui.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
    const list = state.docs.filter((d) => state.filter === 'all' || d.type === state.filter);
    ui.list.replaceChildren();
    if (!list.length) {
      ui.list.append(h('div', { class: 'docs-empty' },
        h('div', { html: ctx.I('file', 46) }),
        h('p', null, state.docs.length ? 'Nessun documento di questo tipo.' : 'Nessun documento ancora.'),
        h('p', { class: 'sub' }, 'Premi + per crearne uno nuovo o importare un file dal telefono.')));
      return;
    }
    list.forEach((d) => ui.list.append(h('div', { class: 'docrow', 'data-id': d.id },
      h('button', { class: 'docmain', onclick: () => openDoc(d), 'aria-label': 'Apri ' + d.name },
        h('span', { class: 'dtype', style: { background: TYPES[d.type].color } }, TYPES[d.type].label.slice(0, 1)),
        h('span', { class: 'dtxt' }, h('b', null, d.name), h('small', null, TYPES[d.type].label + ' · ' + fmtSize(d.size || 0) + ' · ' + ctx.fmtDate(d.updated)))),
      h('button', { class: 'ibtn', 'aria-label': 'Opzioni di ' + d.name, onclick: () => rowMenu(d), html: ctx.I('more', 22) }))));
  }

  async function open() {
    if (!ctx) throw new Error('Documenti non inizializzati');
    await load();
    const h = ctx.h;
    const scr = api.screen('Documenti', { onClose: () => { state.ui = null; } });
    const seg = h('div', { class: 'seg docs-seg' },
      ...[['all', 'Tutti'], ['pdf', 'PDF'], ['docx', 'Word'], ['xlsx', 'Excel']].map(([f, l]) => h('button', { 'data-f': f, onclick: () => { state.filter = f; redraw(); } }, l)));
    const list = h('div', { class: 'docs-list' });
    scr.body.append(seg, list);
    scr.actions.append(ctx.ibtn('plus', () => newSheet(), 'Nuovo documento', 'docs-plus'));
    state.ui = { el: scr.el, seg, list };
    redraw();
    return scr;
  }

  function init(c) { ctx = c; }
  function register(type, editor) { editors[type] = editor; }

  N.docs = { init, open, register, api, _state: state, _logic: { detectType, stripExt, cleanName, fileName, fmtSize, uniqueName, TYPES } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.docs;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
