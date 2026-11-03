/* Creazione di PDF nuovi (offline): «Pagine vuote» (formato, orientamento, numero di pagine) oppure
   «Da foto e immagini» (una immagine per pagina, nell'ordine scelto). Si apre da Documenti → + → Nuovo PDF.
   Il PDF nuovo finisce nell'archivio e si apre subito nel lettore, dove si può scrivere, firmare, annotare.
   Limiti onesti: le immagini vengono ricompresse in JPEG (qualità alta, lato massimo 2600 px) e le parti
   trasparenti diventano bianche; gli altri formati sono quelli che il telefono sa decodificare. */
(function (N) {
  'use strict';

  /* =====================================================================
     1) LOGICA PURA
     ===================================================================== */

  // Misure in punti (1 pt = 1/72 di pollice), verticali.
  const SIZES = {
    a4: { label: 'A4', w: 595.28, h: 841.89 },
    a5: { label: 'A5', w: 419.53, h: 595.28 },
    letter: { label: 'Letter', w: 612, h: 792 },
    legal: { label: 'Legal', w: 612, h: 1008 }
  };
  const MAX_PAGES = 100, MAX_SIDE = 2600, JPEG_Q = 0.9, MARGIN = 24, FIT_LONG = 842;

  function pageSize(fmt, landscape) {
    const s = SIZES[fmt] || SIZES.a4;
    return landscape ? [s.h, s.w] : [s.w, s.h];
  }

  function clampCount(n) {
    n = Math.round(Number(n));
    if (!isFinite(n) || n < 1) return 1;
    return Math.min(MAX_PAGES, n);
  }

  // Riduce (mai ingrandisce) le dimensioni in pixel in modo che il lato lungo non superi max.
  function downscale(w, h, max) {
    max = max || MAX_SIDE;
    const k = Math.min(1, max / Math.max(w, h));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }

  // Immagine centrata nella pagina, scalata per starci tutta dentro i margini (anche ingrandita).
  function fitImage(iw, ih, pw, ph, margin) {
    const m = margin || 0;
    const k = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih);
    const w = iw * k, h = ih * k;
    return { x: (pw - w) / 2, y: (ph - h) / 2, w, h };
  }

  // Pagina per una immagine. mode 'a4': A4 orientata come l'immagine, con margine. 'fit': pagina grande come l'immagine, senza margine.
  function imagePage(iw, ih, mode) {
    if (mode === 'fit') {
      const k = FIT_LONG / Math.max(iw, ih);
      const w = iw * k, h = ih * k;
      return { size: [w, h], box: { x: 0, y: 0, w, h } };
    }
    const size = pageSize('a4', iw > ih);
    return { size, box: fitImage(iw, ih, size[0], size[1], MARGIN) };
  }

  function defaultName(kind, files) {
    if (kind === 'img' && files && files.length === 1) return String(files[0].name || '').replace(/\.[^.]+$/, '') || 'Immagini';
    return kind === 'img' ? 'Immagini' : 'Nuovo PDF';
  }

  /* =====================================================================
     2) COSTRUZIONE DEL PDF
     ===================================================================== */

  const toBuffer = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

  async function buildBlank(A, fmt, landscape, count) {
    await A.lib('pdflib');
    const doc = await window.PDFLib.PDFDocument.create();
    const size = pageSize(fmt, landscape);
    for (let i = 0; i < clampCount(count); i++) doc.addPage(size);
    return toBuffer(await doc.save());
  }

  // Decodifica una immagine (rispettando l'orientamento EXIF) e la restituisce come JPEG su fondo bianco.
  async function toJpeg(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = await createImageBitmap(file); }
    try {
      const [w, h] = downscale(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', JPEG_Q));
      c.width = c.height = 0;
      if (!blob) throw new Error('conversione non riuscita');
      return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    } finally { if (bmp.close) bmp.close(); }
  }

  async function buildFromImages(A, files, mode) {
    await A.lib('pdflib');
    const doc = await window.PDFLib.PDFDocument.create();
    let bad = 0;
    for (const f of files) {
      let im;
      try { im = await toJpeg(f); } catch (e) { console.error(e); bad++; continue; }
      const img = await doc.embedJpg(im.bytes);
      const pg = imagePage(im.w, im.h, mode);
      const page = doc.addPage(pg.size);
      page.drawImage(img, { x: pg.box.x, y: pg.box.y, width: pg.box.w, height: pg.box.h });
    }
    if (!doc.getPageCount()) throw new Error('nessuna immagine leggibile');
    return { data: toBuffer(await doc.save()), bad };
  }

  /* =====================================================================
     3) INTERFACCIA
     ===================================================================== */

  async function finish(A, name, data, onCreated) {
    const d = await A.addDoc('pdf', name, data);
    A.toast('PDF creato');
    if (onCreated) await onCreated(d);
    return d;
  }

  function blankForm(A, onCreated) {
    const h = A.h;
    let fmt = 'a4', land = false, count = 1;
    const name = h('input', { class: 'field', 'data-new-name': '1', value: 'Nuovo PDF', maxlength: 120, 'aria-label': 'Nome del documento' });
    const segOf = (items, get, set) => {
      const seg = h('div', { class: 'seg' });
      const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(get())));
      items.forEach(([v, l]) => seg.append(h('button', { type: 'button', 'data-v': v, onclick: () => { set(v); paint(); } }, l)));
      paint();
      return seg;
    };
    const fmtSeg = segOf(Object.keys(SIZES).map((k) => [k, SIZES[k].label]), () => fmt, (v) => { fmt = v; });
    fmtSeg.dataset.seg = 'fmt';
    const orSeg = segOf([['false', 'Verticale'], ['true', 'Orizzontale']], () => land, (v) => { land = v === 'true'; });
    orSeg.dataset.seg = 'orient';
    const num = h('span', { 'data-count': '1', style: { flex: '1', textAlign: 'center', alignSelf: 'center', fontWeight: '650' } }, '1');
    const setCount = (n) => { count = clampCount(n); num.textContent = String(count); };
    const stepper = h('div', { class: 'seg' },
      h('button', { type: 'button', 'data-step': '-1', 'aria-label': 'Meno pagine', onclick: () => setCount(count - 1) }, '−'),
      num,
      h('button', { type: 'button', 'data-step': '1', 'aria-label': 'Più pagine', onclick: () => setCount(count + 1) }, '+'));
    const lab = (t) => h('p', { class: 'sub', style: { margin: '14px 2px 6px' } }, t);
    const go = h('button', { class: 'btn pri', 'data-create': '1', style: { width: '100%', marginTop: '18px' }, onclick: async () => {
      go.disabled = true;
      try {
        const data = await buildBlank(A, fmt, land, count);
        const nm = name.value;
        await A.back();
        await finish(A, nm, data, onCreated);
      } catch (e) { console.error(e); go.disabled = false; A.toast('Impossibile creare il PDF: ' + (e.message || e), 4500); }
    } }, 'Crea PDF');
    A.openSheet('Pagine vuote', h('div', null, lab('Nome'), name, lab('Formato'), fmtSeg, lab('Orientamento'), orSeg, lab('Numero di pagine'), stepper, go));
  }

  function imagesForm(A, onCreated) {
    const h = A.h;
    let files = [], mode = 'a4';
    const name = h('input', { class: 'field', 'data-new-name': '1', value: 'Immagini', maxlength: 120, 'aria-label': 'Nome del documento' });
    const list = h('div', { 'data-img-list': '1' });
    const go = h('button', { class: 'btn pri', 'data-create': '1', disabled: true, style: { width: '100%', marginTop: '18px' }, onclick: async () => {
      go.disabled = true; go.textContent = 'Creazione in corso…';
      try {
        const r = await buildFromImages(A, files, mode);
        const nm = name.value;
        await A.back();
        await finish(A, nm, r.data, onCreated);
        if (r.bad) A.toast(r.bad === 1 ? 'Un’immagine non è stata letta ed è stata saltata' : r.bad + ' immagini non sono state lette e sono state saltate', 4500);
      } catch (e) { console.error(e); go.disabled = false; go.textContent = 'Crea PDF'; A.toast('Impossibile creare il PDF: ' + (e.message || e), 4500); }
    } }, 'Crea PDF');
    const redraw = () => {
      list.replaceChildren();
      files.forEach((f, i) => list.append(h('div', { class: 'docrow', 'data-img': String(i), style: { padding: '6px 2px' } },
        h('span', { class: 'dtxt', style: { flex: '1', minWidth: '0' } }, h('b', null, (i + 1) + '. ' + f.name), h('small', null, A.fmtSize(f.size))),
        h('button', { class: 'ibtn', 'aria-label': 'Sposta su', disabled: i === 0, onclick: () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; redraw(); }, html: '▲' }),
        h('button', { class: 'ibtn', 'aria-label': 'Sposta giù', disabled: i === files.length - 1, onclick: () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; redraw(); }, html: '▼' }),
        h('button', { class: 'ibtn', 'aria-label': 'Togli', onclick: () => { files.splice(i, 1); redraw(); }, html: A.I('trash', 20) }))));
      go.disabled = !files.length;
      if (files.length === 1 && name.value === 'Immagini') name.value = defaultName('img', files);
    };
    const input = h('input', { type: 'file', multiple: true, accept: 'image/*', class: 'hidden', 'data-img-input': '1', onchange: () => { files = files.concat(Array.from(input.files || [])); input.value = ''; redraw(); } });
    const add = h('button', { class: 'btn', 'data-img-add': '1', style: { width: '100%' }, onclick: () => input.click() }, 'Scegli foto e immagini');
    const seg = h('div', { class: 'seg', 'data-seg': 'mode' },
      h('button', { type: 'button', 'data-v': 'a4', class: 'on', onclick: () => { mode = 'a4'; paint(); } }, 'Pagina A4'),
      h('button', { type: 'button', 'data-v': 'fit', onclick: () => { mode = 'fit'; paint(); } }, 'Come l’immagine'));
    const paint = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    const lab = (t) => h('p', { class: 'sub', style: { margin: '14px 2px 6px' } }, t);
    A.openSheet('Da foto e immagini', h('div', null, add, input, list, lab('Nome'), name, lab('Pagina'), seg, go));
  }

  function create(A, onCreated) {
    const h = A.h;
    A.openSheet('Nuovo PDF', h('div', null,
      h('button', { class: 'item', 'data-pdfnew': 'blank', onclick: async () => { await A.back(); blankForm(A, onCreated); } }, h('span', { html: A.I('file', 22) }), h('span', null, 'Pagine vuote', h('small', null, 'Scegli formato e numero di pagine'))),
      h('button', { class: 'item', 'data-pdfnew': 'images', onclick: async () => { await A.back(); imagesForm(A, onCreated); } }, h('span', { html: A.I('image', 22) }), h('span', null, 'Da foto e immagini', h('small', null, 'Una immagine per pagina')))));
  }

  N.pdfNew = { create, _logic: { SIZES, MAX_PAGES, pageSize, clampCount, downscale, fitImage, imagePage, defaultName } };
  if (typeof module !== 'undefined' && module.exports) module.exports = N.pdfNew;
})((typeof window !== 'undefined' ? (window.N = window.N || {}) : {}));
