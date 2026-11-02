/* Gestione pagine PDF (offline): ruota, elimina, riordina, unisci con un altro PDF, estrai e dividi.
   Si apre dal menu «Altro» del lettore → «Gestisci pagine». Si lavora su miniature: tocca per selezionare,
   poi usa i pulsanti. Nulla cambia nel documento finché non premi «Salva».
   Limite onesto: il PDF viene ricostruito copiando le pagine, quindi moduli compilabili, segnalibri e
   firme digitali del file originale non vengono conservati (testo, immagini e annotazioni sì). */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA
     Una "voce" è { key, src, idx, rot }: src = da quale PDF viene la pagina (0 = questo), idx = numero
     della pagina in quel PDF (da 0), rot = rotazione aggiunta da te (0, 90, 180, 270).
     ===================================================================== */

  const normRot = (r) => ((Math.round(r / 90) * 90) % 360 + 360) % 360;

  // Sposta di un posto (dir −1 = prima, +1 = dopo) tutte le pagine selezionate, mantenendo il loro ordine.
  // Un blocco già arrivato al bordo resta fermo.
  function moveSel(list, sel, dir) {
    const a = list.slice(), n = a.length;
    if (dir < 0) {
      for (let i = 1; i < n; i++) if (sel.has(a[i].key) && !sel.has(a[i - 1].key)) { const t = a[i]; a[i] = a[i - 1]; a[i - 1] = t; }
    } else {
      for (let i = n - 2; i >= 0; i--) if (sel.has(a[i].key) && !sel.has(a[i + 1].key)) { const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; }
    }
    return a;
  }
  const rotSel = (list, sel, deg) => list.map((e) => (sel.has(e.key) ? Object.assign({}, e, { rot: normRot(e.rot + deg) }) : e));
  const delSel = (list, sel) => list.filter((e) => !sel.has(e.key));
  const pickSel = (list, sel) => list.filter((e) => sel.has(e.key));
  // Pezzi da n pagine: (7, 3) → [[0,3],[3,6],[6,7]] (inizio incluso, fine esclusa)
  function chunkRanges(count, n) {
    const k = Math.max(1, Math.floor(n) || 1), out = [];
    for (let i = 0; i < count; i += k) out.push([i, Math.min(count, i + k)]);
    return out;
  }
  // Il documento è cambiato rispetto all'originale?
  const isChanged = (list, origCount) => list.length !== origCount || list.some((e, i) => e.src !== 0 || e.idx !== i || e.rot !== 0);

  /* =====================================================================
     2) COSTRUZIONE DEL NUOVO PDF
     ===================================================================== */

  // sources: [{ bytes }] — la posizione nell'elenco è il numero "src" delle voci.
  async function buildPdf(list, sources) {
    const { PDFDocument, degrees } = window.PDFLib;
    const out = await PDFDocument.create();
    const docs = {};
    const bySrc = new Map();
    for (const e of list) { if (!bySrc.has(e.src)) bySrc.set(e.src, new Set()); bySrc.get(e.src).add(e.idx); }
    const copied = new Map(); // "src:idx" → pagina copiata
    for (const [src, set] of bySrc) {
      // una sola copia per ogni PDF di origine, così font e immagini condivisi non si duplicano
      docs[src] = await PDFDocument.load(sources[src].bytes.slice(0), { ignoreEncryption: true });
      const idxs = Array.from(set).sort((a, b) => a - b);
      const pgs = await out.copyPages(docs[src], idxs);
      idxs.forEach((ix, k) => copied.set(src + ':' + ix, pgs[k]));
    }
    for (const e of list) {
      const p = copied.get(e.src + ':' + e.idx);
      if (e.rot) p.setRotation(degrees(normRot(p.getRotation().angle + e.rot)));
      out.addPage(p);
    }
    const bytes = await out.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  /* =====================================================================
     3) SCHERMATA
     ===================================================================== */

  const SV = {
    rot: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M20 12a8 8 0 11-2.6-5.9M20 4v5h-5"/></svg>',
    del: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
    left: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg class="i" viewBox="0 0 24 24" width="20" height="20"><path d="M9 6l6 6-6 6"/></svg>',
    check: '<svg class="i" viewBox="0 0 24 24" width="16" height="16"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
  };

  async function open(d, A, onDone) {
    const h = A.h;
    await A.lib('pdfjs');
    await A.lib('pdflib');
    const pdfjs = window.pdfjsLib;
    let dead = false, saved = false, busy = false, seq = 0;

    const sources = [{ bytes: d.data, pdf: null, name: d.name }];
    async function loadSource(bytes) {
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes.slice(0)), cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
        standardFontDataUrl: 'vendor/pdfjs/standard_fonts/', isEvalSupported: false
      });
      task.onPassword = (update, reason) => {
        const pw = prompt(reason === (pdfjs.PasswordResponses || {}).INCORRECT_PASSWORD ? 'Password errata. Riprova:' : 'Questo PDF è protetto da password. Inseriscila:');
        if (pw === null) task.destroy(); else update(pw);
      };
      return task.promise;
    }
    // legge numero e misure di tutte le pagine di un PDF e crea le voci
    async function entriesOf(src) {
      const pdf = sources[src].pdf, out = [];
      for (let s = 0; s < pdf.numPages; s += 40) {
        const part = await Promise.all(Array.from({ length: Math.min(40, pdf.numPages - s) }, async (_, k) => {
          const p = await pdf.getPage(s + k + 1), v = p.getViewport({ scale: 1 });
          return { key: 'p' + (++seq), src, idx: s + k, rot: 0, w: v.width, h: v.height, nat: p.rotate || 0 };
        }));
        out.push(...part);
      }
      return out;
    }

    sources[0].pdf = await loadSource(d.data);
    let list = await entriesOf(0);
    const orig = list.length;
    const sel = new Set();

    /* ---------- schermata ---------- */
    const scr = A.screen('Pagine', { onClose: () => cleanup() });
    const grid = h('div', { class: 'pgm-grid' });
    const info = h('span', { class: 'pgm-info', 'data-pgm-info': '1' }, '');
    const bt = (attr, label, fn, svg) => h('button', Object.assign({ class: 'pdf-hlbtn', 'aria-label': label, onclick: fn }, attr), svg ? h('span', { html: svg }) : label);
    const bRot = bt({ 'data-pgm-rot': '1' }, 'Ruota di 90°', () => act('rot'), SV.rot);
    const bDel = bt({ 'data-pgm-del': '1' }, 'Elimina le selezionate', () => act('del'), SV.del);
    const bL = bt({ 'data-pgm-left': '1' }, 'Sposta prima', () => act('left'), SV.left);
    const bR = bt({ 'data-pgm-right': '1' }, 'Sposta dopo', () => act('right'), SV.right);
    const bAll = bt({ 'data-pgm-all': '1' }, 'Seleziona tutte / nessuna', () => act('all'));
    bAll.textContent = 'Tutte';
    const bSplit = bt({ 'data-pgm-split': '1' }, 'Estrai o dividi', () => splitMenu());
    bSplit.textContent = 'Estrai';
    const bAdd = bt({ 'data-pgm-add': '1' }, 'Unisci con un altro PDF', () => addMenu());
    bAdd.textContent = 'Unisci';
    const bSave = h('button', { class: 'pdf-savebtn', 'data-pgm-save': '1', onclick: () => save() }, 'Salva');
    const bar = h('div', { class: 'pdf-tools on pgm-bar' }, bAll, bRot, bL, bR, bDel, bSplit, bAdd, bSave);
    scr.el.insertBefore(bar, scr.body);
    scr.body.classList.add('pgm-body');
    scr.body.append(info, grid);

    /* ---------- miniature (disegnate solo quando servono) ---------- */
    const cells = new Map();
    const want = new Set();
    let pumping = false;
    async function renderThumb(e) {
      const c = cells.get(e.key);
      if (!c) return;
      const rk = e.rot + '';
      if (c.rk === rk) return;
      try {
        const page = await sources[e.src].pdf.getPage(e.idx + 1);
        const vp0 = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
        const out = Math.min(window.devicePixelRatio || 1, 2);
        const vp = page.getViewport({ scale: (110 * out) / vp0.width, rotation: (page.rotate + e.rot) % 360 });
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.floor(vp.width)); cv.height = Math.max(1, Math.floor(vp.height));
        await page.render({ canvasContext: cv.getContext('2d', { alpha: false }), viewport: vp, background: 'rgb(255,255,255)' }).promise;
        if (dead || !cells.has(e.key)) return;
        c.thumb.replaceChildren(cv);
        c.rk = rk;
        c.el.dataset.done = '1';
      } catch (x) { console.error(x); }
    }
    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        while (!dead) {
          const e = list.find((x) => want.has(x.key) && cells.get(x.key) && cells.get(x.key).rk !== x.rot + '');
          if (!e) break;
          await renderThumb(e);
        }
      } finally { pumping = false; }
    }
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
      for (const en of es) { const k = en.target.dataset.key; if (en.isIntersecting) want.add(k); else want.delete(k); }
      pump();
    }, { root: scr.body, rootMargin: '300px' }) : null;

    function makeCell(e) {
      const num = h('span', { class: 'pgm-num' }, '');
      const chk = h('span', { class: 'pgm-chk', html: SV.check });
      const thumb = h('div', { class: 'pgm-thumb' });
      const badge = e.src ? h('span', { class: 'pgm-src', title: sources[e.src].name }, 'Unita') : null;
      const el = h('button', { class: 'pgm-cell', 'data-key': e.key, onclick: () => { toggle(e.key); } }, thumb, num, chk, badge);
      const c = { el, thumb, num, rk: null };
      cells.set(e.key, c);
      if (io) io.observe(el); else want.add(e.key);
      return c;
    }

    function toggle(key) { if (sel.has(key)) sel.delete(key); else sel.add(key); paint(); }

    function paint() {
      // ricostruisce la griglia nell'ordine attuale (le celle già disegnate si riusano)
      const keys = new Set(list.map((e) => e.key));
      for (const [k, c] of cells) if (!keys.has(k)) { if (io) io.unobserve(c.el); c.el.remove(); cells.delete(k); want.delete(k); sel.delete(k); }
      list.forEach((e, i) => {
        const c = cells.get(e.key) || makeCell(e);
        grid.append(c.el);                         // append sposta l'elemento già presente: ordine garantito
        c.num.textContent = String(i + 1);
        c.el.classList.toggle('sel', sel.has(e.key));
        c.el.setAttribute('aria-pressed', sel.has(e.key) ? 'true' : 'false');
        c.el.setAttribute('aria-label', 'Pagina ' + (i + 1) + (sel.has(e.key) ? ', selezionata' : ''));
        const sw = (e.rot % 180) ? e.h : e.w, sh = (e.rot % 180) ? e.w : e.h;   // e.w / e.h includono già la rotazione propria della pagina
        c.thumb.style.aspectRatio = String(sw / sh);
      });
      const n = sel.size, ch = isChanged(list, orig);
      info.textContent = list.length + (list.length === 1 ? ' pagina' : ' pagine') + (n ? ' · ' + n + (n === 1 ? ' selezionata' : ' selezionate') : ' · tocca le pagine per selezionarle');
      bRot.disabled = bDel.disabled = bSplit.disabled = bL.disabled = bR.disabled = !n;
      bSplit.disabled = false;
      bSave.disabled = !ch || busy;
      bAll.textContent = n === list.length ? 'Nessuna' : 'Tutte';
      scr.setTitle('Pagine (' + list.length + ')');
      pump();
    }

    function act(what) {
      if (what === 'all') { if (sel.size === list.length) sel.clear(); else list.forEach((e) => sel.add(e.key)); return paint(); }
      if (!sel.size) return A.toast('Seleziona prima almeno una pagina');
      if (what === 'rot') list = rotSel(list, sel, 90);
      else if (what === 'left') list = moveSel(list, sel, -1);
      else if (what === 'right') list = moveSel(list, sel, 1);
      else if (what === 'del') {
        if (sel.size >= list.length) return A.toast('Non puoi eliminare tutte le pagine');
        if (!confirm('Eliminare ' + sel.size + (sel.size === 1 ? ' pagina' : ' pagine') + '? Il documento cambia solo quando premi «Salva».')) return;
        list = delSel(list, sel); sel.clear();
      }
      paint();
    }

    /* ---------- estrai / dividi ---------- */
    async function newDocFrom(sub, suffix) {
      const bytes = await buildPdf(sub, sources);
      return A.addDoc('pdf', d.name + ' (' + suffix + ')', bytes);
    }
    function splitMenu() {
      A.openSheet('Estrai o dividi', h('div', null,
        h('p', { class: 'pdf-hint' }, 'Crea nuovi PDF nell’archivio. Questo documento non viene modificato.'),
        h('button', { class: 'item', 'data-pgm-extract': '1', onclick: async () => {
          await A.back();
          if (!sel.size) return A.toast('Seleziona prima le pagine da estrarre');
          busy = true;
          try { const nd = await newDocFrom(pickSel(list, sel), 'estratto'); A.toast('Creato «' + nd.name + '» in Documenti', 3500); }
          catch (e) { console.error(e); A.toast('Impossibile estrarre: ' + (e.message || e), 4500); }
          busy = false; paint();
        } }, h('span', { html: A.I('file', 22) }), 'Estrai le pagine selezionate'),
        h('button', { class: 'item', 'data-pgm-chunk': '1', onclick: async () => {
          await A.back();
          const v = parseInt(prompt('Dividi in PDF da quante pagine ciascuno?', '1'), 10);
          if (!(v >= 1)) return;
          const parts = chunkRanges(list.length, v);
          if (parts.length > 60) return A.toast('Troppi file (' + parts.length + '): scegli un numero di pagine maggiore', 4200);
          if (parts.length < 2) return A.toast('Il documento ha meno pagine di quelle indicate: nulla da dividere', 4200);
          busy = true;
          try {
            for (let k = 0; k < parts.length; k++) await newDocFrom(list.slice(parts[k][0], parts[k][1]), 'parte ' + (k + 1));
            A.toast('Creati ' + parts.length + ' PDF in Documenti', 3500);
          } catch (e) { console.error(e); A.toast('Impossibile dividere: ' + (e.message || e), 4500); }
          busy = false; paint();
        } }, h('span', { html: A.I('copy', 22) }), 'Dividi in PDF da N pagine')));
    }

    /* ---------- unisci ---------- */
    function addMenu() {
      const others = A.listDocs('pdf').filter((x) => x.id !== d.id);
      if (!others.length) return A.toast('Importa prima un altro PDF in Documenti: poi potrai unirlo qui', 4200);
      A.openSheet('Unisci con…', h('div', null,
        h('p', { class: 'pdf-hint' }, 'Le pagine del PDF scelto vengono aggiunte in fondo.'),
        ...others.map((o) => h('button', { class: 'item', 'data-pgm-merge': o.id, onclick: async () => {
          await A.back();
          busy = true; paint();
          try {
            const full = await A.getDoc(o.id);
            if (!full) throw new Error('documento non trovato');
            sources.push({ bytes: full.data, pdf: null, name: full.name });
            const k = sources.length - 1;
            sources[k].pdf = await loadSource(full.data);
            const add = await entriesOf(k);
            list = list.concat(add);
            A.toast(add.length + (add.length === 1 ? ' pagina aggiunta' : ' pagine aggiunte') + ' in fondo');
          } catch (e) { console.error(e); if (sources.length > 1 && !sources[sources.length - 1].pdf) sources.pop(); A.toast('Impossibile unire: ' + (e.message || e), 4500); }
          busy = false; paint();
          grid.lastElementChild && grid.lastElementChild.scrollIntoView({ block: 'nearest' });
        } }, h('span', { html: A.I('file', 22) }), h('span', null, o.name, h('small', null, A.fmtSize(o.size)))))));
    }

    /* ---------- salva ---------- */
    async function save() {
      if (busy || !isChanged(list, orig)) return;
      busy = true; paint();
      try {
        d.data = await buildPdf(list, sources);
        await A.save(d);
        saved = true;
        A.toast('Pagine salvate nel PDF');
        await A.back();
        if (onDone) onDone();
      } catch (e) {
        console.error(e);
        A.toast('Impossibile salvare: ' + (e.message || e), 5000);
        busy = false; paint();
      }
    }

    function cleanup() {
      if (dead) return;
      dead = true;
      if (io) io.disconnect();
      if (!saved && isChanged(list, orig)) A.toast('Modifiche alle pagine non salvate: scartate', 3500);
      for (const s of sources) { try { if (s.pdf) s.pdf.destroy(); } catch (e) { /* già chiuso */ } }
    }

    paint();
    return { get list() { return list; } };
  }

  N.pdfPages = { open, _logic: { normRot, moveSel, rotSel, delSel, pickSel, chunkRanges, isChanged, buildPdf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.pdfPages;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
